import { EventEmitter } from "node:events";
import net from "node:net";
import tls from "node:tls";

import { redactSecrets, safeJson } from "../common/redaction.js";

export const SOH = "\x01";
const FIX_BEGIN_STRING = "FIX.4.4";
const ORDER_MESSAGE_TYPE = "D";

export type FixField = [tag: string, value: string | number | boolean];

export interface FixSessionConfig {
  host: string;
  port: number;
  ssl: boolean;
  username: string;
  password: string;
  senderCompId: string;
  targetCompId: string;
  senderSubId: string;
  targetSubId: string;
  heartbeatSec: number;
  resetSeqNum: boolean;
}

export interface CTraderQuote {
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  timestampMs: number;
}

export interface FixMessage {
  raw: string;
  fields: FixField[];
  get(tag: string): string | undefined;
  getAll(tag: string): string[];
}

interface MarketDataEntry {
  type?: string;
  price?: number;
  size?: number;
}

type SocketLike = net.Socket | tls.TLSSocket;

export class CTraderFixClient extends EventEmitter {
  private socket: SocketLike | null = null;
  private buffer = "";
  private msgSeqNum = 1;
  private latestBid: number | undefined;
  private latestAsk: number | undefined;
  private latestBidSize: number | undefined;
  private latestAskSize: number | undefined;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: FixSessionConfig) {
    super();
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onConnect = (): void => {
        this.attachSocketHandlers(socket);
        resolve();
      };
      const socket = this.config.ssl
        ? tls.connect({ host: this.config.host, port: this.config.port, servername: this.config.host }, onConnect)
        : net.createConnection({ host: this.config.host, port: this.config.port }, onConnect);
      socket.once("error", reject);
      this.socket = socket;
    });
  }

  logon(): void {
    this.send("A", [
      ["98", "0"],
      ["108", this.config.heartbeatSec],
      ...(this.config.resetSeqNum ? ([["141", "Y"]] as FixField[]) : []),
      ["553", this.config.username],
      ["554", this.config.password],
    ]);
  }

  subscribeMarketData(symbolId: string, mdReqId = `xau-${Date.now()}`): void {
    this.send("V", [
      ["262", mdReqId],
      ["263", "1"],
      ["264", "1"],
      ["265", "1"],
      ["267", "2"],
      ["269", "0"],
      ["269", "1"],
      ["146", "1"],
      ["55", symbolId],
    ]);
  }

  sendHeartbeat(testReqId?: string): void {
    this.send("0", testReqId ? [["112", testReqId]] : []);
  }

  logout(text = "client shutdown"): void {
    if (this.socket?.destroyed === false) {
      this.send("5", [["58", text]]);
      this.socket.end();
    }
  }

  close(): void {
    this.stopActiveHeartbeat();
    this.socket?.destroy();
    this.socket = null;
  }

  private attachSocketHandlers(socket: SocketLike): void {
    socket.on("data", (chunk) => this.handleData(chunk.toString("utf8")));
    socket.on("close", () => {
      this.stopActiveHeartbeat();
      this.emit("close");
    });
    socket.on("error", (error) => {
      this.stopActiveHeartbeat();
      this.emit("error", error);
    });
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const frameEnd = this.findFrameEnd();
      if (frameEnd === -1) {
        break;
      }
      const raw = this.buffer.slice(0, frameEnd);
      this.buffer = this.buffer.slice(frameEnd);
      this.handleMessage(parseFixMessage(raw));
    }
  }

  private findFrameEnd(): number {
    const checksumStart = this.buffer.indexOf(`${SOH}10=`);
    if (checksumStart === -1) {
      return -1;
    }
    const end = checksumStart + 8;
    return this.buffer.length >= end ? end : -1;
  }

  private handleMessage(message: FixMessage): void {
    const msgType = message.get("35");
    if (msgType === "0") {
      return;
    }
    if (msgType === "1") {
      const testReqId = message.get("112");
      this.sendHeartbeat(testReqId);
      return;
    }
    if (msgType === "A") {
      this.startActiveHeartbeat();
      this.emit("logon", message);
      return;
    }
    if (msgType === "W" || msgType === "X") {
      this.updateQuoteFromMarketData(message);
      return;
    }
    if (msgType === "5" || msgType === "3" || msgType === "Y" || msgType === "j") {
      console.error(safeJson({ event: "ctrader_fix_error", msgType, text: message.get("58"), raw: toLoggableFix(rawWithoutChecksum(message.raw)) }));
      this.emit("reject", message);
      if (msgType === "5") {
        this.stopActiveHeartbeat();
        this.close();
      }
      return;
    }
    this.emit("message", message);
  }

  private updateQuoteFromMarketData(message: FixMessage): void {
    for (const entry of extractMarketDataEntries(message)) {
      if (entry.type === "0" && entry.price !== undefined) {
        this.latestBid = entry.price;
        this.latestBidSize = entry.size;
      }
      if (entry.type === "1" && entry.price !== undefined) {
        this.latestAsk = entry.price;
        this.latestAskSize = entry.size;
      }
    }
    if (this.latestBid !== undefined || this.latestAsk !== undefined) {
      this.emit("quote", {
        bid: this.latestBid,
        ask: this.latestAsk,
        bidSize: this.latestBidSize,
        askSize: this.latestAskSize,
        timestampMs: Date.now(),
      } satisfies CTraderQuote);
    }
  }

  private send(msgType: string, bodyFields: FixField[]): void {
    if (msgType === ORDER_MESSAGE_TYPE) {
      throw new Error("New Order Single (35=D) is not allowed in this market-data sidecar");
    }
    if (!this.socket || this.socket.destroyed) {
      throw new Error("FIX socket is not connected");
    }
    const message = buildSessionMessage(this.config, this.msgSeqNum, msgType, bodyFields);
    this.msgSeqNum += 1;
    this.socket.write(message, "utf8");
  }

  private startActiveHeartbeat(): void {
    if (this.config.heartbeatSec <= 0 || this.heartbeatTimer) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      try {
        this.sendHeartbeat();
      } catch (error) {
        this.emit("error", error);
      }
    }, this.config.heartbeatSec * 1_000);
    this.heartbeatTimer.unref();
  }

  private stopActiveHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export function buildSessionMessage(
  config: FixSessionConfig,
  msgSeqNum: number,
  msgType: string,
  bodyFields: FixField[],
): string {
  if (msgType === ORDER_MESSAGE_TYPE) {
    throw new Error("New Order Single (35=D) is not allowed");
  }
  return buildFixMessage([
    ["35", msgType],
    ["34", msgSeqNum],
    ["49", config.senderCompId],
    ["50", config.senderSubId],
    ["52", formatUtcTimestamp(new Date())],
    ["56", config.targetCompId],
    ["57", config.targetSubId],
    ...bodyFields,
  ]);
}

export function buildHeartbeatMessage(config: FixSessionConfig, msgSeqNum: number, testReqId?: string): string {
  return buildSessionMessage(config, msgSeqNum, "0", testReqId ? [["112", testReqId]] : []);
}

export function buildFixMessage(fields: FixField[]): string {
  const body = fields.map(([tag, value]) => `${tag}=${fixValue(value)}`).join(SOH) + SOH;
  const header = `8=${FIX_BEGIN_STRING}${SOH}9=${Buffer.byteLength(body, "utf8")}${SOH}`;
  const messageWithoutChecksum = `${header}${body}`;
  return `${messageWithoutChecksum}10=${calculateCheckSum(messageWithoutChecksum)}${SOH}`;
}

export function calculateCheckSum(messageWithoutChecksum: string): string {
  const sum = Buffer.from(messageWithoutChecksum, "utf8").reduce((acc, byte) => acc + byte, 0);
  return String(sum % 256).padStart(3, "0");
}

export function parseFixMessage(raw: string): FixMessage {
  const normalized = raw.endsWith(SOH) ? raw : `${raw}${SOH}`;
  const fields = normalized
    .split(SOH)
    .filter((part) => part.length > 0)
    .map((part): FixField => {
      const idx = part.indexOf("=");
      if (idx === -1) {
        throw new Error(`Invalid FIX field: ${part}`);
      }
      return [part.slice(0, idx), part.slice(idx + 1)];
    });
  return {
    raw: normalized,
    fields,
    get: (tag: string) => fields.find(([fieldTag]) => fieldTag === tag)?.[1].toString(),
    getAll: (tag: string) => fields.filter(([fieldTag]) => fieldTag === tag).map(([, value]) => value.toString()),
  };
}

export function extractBidAsk(message: FixMessage): { bid?: number; ask?: number } {
  let bid: number | undefined;
  let ask: number | undefined;
  for (const entry of extractMarketDataEntries(message)) {
    if (entry.type === "0") {
      bid = entry.price;
    }
    if (entry.type === "1") {
      ask = entry.price;
    }
  }
  return { bid, ask };
}

export function extractMarketDataEntries(message: FixMessage): MarketDataEntry[] {
  const entries: MarketDataEntry[] = [];
  let current: MarketDataEntry | null = null;

  const finish = (): void => {
    if (current?.type !== undefined && current.price !== undefined) {
      entries.push(current);
    }
    current = null;
  };

  for (const [tag, value] of message.fields) {
    if (tag === "279") {
      finish();
      current = {};
      continue;
    }
    if (tag === "269") {
      if (current?.type !== undefined) {
        finish();
      }
      current ??= {};
      current.type = String(value);
      continue;
    }
    if (tag === "270") {
      current ??= {};
      current.price = Number(value);
      continue;
    }
    if (tag === "271") {
      current ??= {};
      current.size = Number(value);
    }
  }
  finish();
  return entries.filter((entry) => Number.isFinite(entry.price));
}

export function formatUtcTimestamp(date: Date): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

export function toLoggableFix(raw: string): string {
  return String(redactSecrets(raw.replaceAll(SOH, "|")));
}

function rawWithoutChecksum(raw: string): string {
  return raw.replace(/\x0110=\d{3}\x01$/, SOH);
}

function fixValue(value: string | number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "Y" : "N";
  }
  return String(value);
}
