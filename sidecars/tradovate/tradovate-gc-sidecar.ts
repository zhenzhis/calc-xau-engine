import { getEnv, getNumberEnv, requireEnv } from "../common/env.js";
import { startHeartbeat } from "../common/heartbeat.js";
import { appendJsonl } from "../common/jsonl-writer.js";

interface TradovateConfig {
  envName: "demo" | "live";
  restUrl: string;
  mdWsUrl: string;
  username: string;
  password: string;
  appId: string;
  appVersion: string;
  cid: string;
  sec: string;
  contract: string;
  outputPath: string;
  maxReconnectMs: number;
}

interface TradovateState {
  lastMessageMs: number | null;
  lastWriteMs: number | null;
  lastError: string | null;
  reconnects: number;
  writeCount: number;
}

interface ContractRef {
  id: number;
  symbol: string;
}

interface LatestGcQuote {
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
}

type WsEvent = { data?: unknown; code?: number; reason?: unknown; message?: unknown };
type WsListener = (event: WsEvent) => void;
type WebSocketLike = {
  addEventListener(type: string, listener: WsListener): void;
  send(data: string): void;
  close(): void;
};
type WebSocketConstructor = new (url: string) => WebSocketLike;

const DEFAULT_OUTPUT_PATH = "/quant/calc/data/xau-state-discord/rithmic-gc.jsonl";
const DEFAULT_MD_WS_URL = "wss://md.tradovateapi.com/v1/websocket";
const AUTH_REQUEST_ID = 1;
const SUBSCRIBE_REQUEST_ID = 2;

async function runTradovateSidecar(): Promise<void> {
  const config = readConfig();
  const state: TradovateState = {
    lastMessageMs: null,
    lastWriteMs: null,
    lastError: null,
    reconnects: 0,
    writeCount: 0,
  };

  startHeartbeat("tradovate-gc", () => ({
    lastMessageMs: state.lastMessageMs,
    lastWriteMs: state.lastWriteMs,
    lastError: state.lastError,
    reconnects: state.reconnects,
    writeCount: state.writeCount,
  }));

  console.log(
    JSON.stringify({
      event: "sidecar_started",
      sidecar: "tradovate-gc",
      env: config.envName,
      contract: config.contract,
      restUrl: config.restUrl,
      mdWsUrl: config.mdWsUrl,
      outputPath: config.outputPath,
    }),
  );

  let reconnectDelayMs = 1_000;
  while (true) {
    try {
      const accessToken = await requestAccessToken(config);
      const contract = await resolveContract(config, accessToken);
      await runMarketDataSession(config, accessToken, contract, state);
      reconnectDelayMs = 1_000;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          event: "tradovate_sidecar_retry",
          error: state.lastError,
          reconnectDelayMs,
        }),
      );
      await sleep(reconnectDelayMs);
      state.reconnects += 1;
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, config.maxReconnectMs);
    }
  }
}

function readConfig(): TradovateConfig {
  const envName = readTradovateEnv();
  const defaultRestUrl =
    envName === "live" ? "https://live.tradovateapi.com/v1" : "https://demo.tradovateapi.com/v1";

  return {
    envName,
    restUrl: getEnv("TRADOVATE_REST_URL", defaultRestUrl)!,
    mdWsUrl: getEnv("TRADOVATE_MD_WS_URL", DEFAULT_MD_WS_URL)!,
    username: requireEnv("TRADOVATE_USERNAME"),
    password: requireEnv("TRADOVATE_PASSWORD"),
    appId: requireEnv("TRADOVATE_APP_ID"),
    appVersion: requireEnv("TRADOVATE_APP_VERSION"),
    cid: requireEnv("TRADOVATE_CID"),
    sec: requireEnv("TRADOVATE_SEC"),
    contract: getEnv("TRADOVATE_GC_CONTRACT", "GCM6")!,
    outputPath: getEnv("RITHMIC_GC_JSONL_PATH", DEFAULT_OUTPUT_PATH)!,
    maxReconnectMs: Math.trunc(getNumberEnv("TRADOVATE_MAX_RECONNECT_MS", 60_000, { min: 1_000 })),
  };
}

function readTradovateEnv(): "demo" | "live" {
  const value = getEnv("TRADOVATE_ENV", "demo")!.toLowerCase();
  if (value !== "demo" && value !== "live") {
    throw new Error("TRADOVATE_ENV must be demo or live");
  }
  return value;
}

async function requestAccessToken(config: TradovateConfig): Promise<string> {
  const response = await fetchJson(`${config.restUrl}/auth/accesstokenrequest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: config.username,
      password: config.password,
      appId: config.appId,
      appVersion: config.appVersion,
      cid: config.cid,
      sec: config.sec,
    }),
  });

  const accessToken = response.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Tradovate auth response did not include accessToken");
  }
  return accessToken;
}

async function resolveContract(config: TradovateConfig, accessToken: string): Promise<ContractRef> {
  const response = await fetchJson(`${config.restUrl}/contract/find?name=${encodeURIComponent(config.contract)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const id = extractContractId(response);
  if (id === undefined) {
    throw new Error(`Tradovate contract lookup did not return an id for ${config.contract}`);
  }
  return { id, symbol: config.contract };
}

async function runMarketDataSession(
  config: TradovateConfig,
  accessToken: string,
  contract: ContractRef,
  state: TradovateState,
): Promise<void> {
  const ws = createWebSocket(config.mdWsUrl);
  const latest: LatestGcQuote = {};

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscribed = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // Closing an already failed socket has no useful recovery path.
      }
      reject(error);
    };

    ws.addEventListener("message", (event) => {
      void handleWebSocketFrame(String(event.data ?? ""), {
        ws,
        accessToken,
        contract,
        outputPath: config.outputPath,
        latest,
        state,
        onSubscribed: () => {
          subscribed = true;
        },
      }).catch(fail);
    });

    ws.addEventListener("error", (event) => {
      fail(new Error(`Tradovate websocket error: ${String(event.message ?? "unknown error")}`));
    });

    ws.addEventListener("close", (event) => {
      if (settled) {
        return;
      }
      settled = true;
      const suffix = subscribed ? "" : " before subscription completed";
      reject(new Error(`Tradovate websocket closed${suffix}: code=${String(event.code ?? "unknown")}`));
    });
  });
}

async function handleWebSocketFrame(
  frame: string,
  context: {
    ws: WebSocketLike;
    accessToken: string;
    contract: ContractRef;
    outputPath: string;
    latest: LatestGcQuote;
    state: TradovateState;
    onSubscribed: () => void;
  },
): Promise<void> {
  context.state.lastMessageMs = Date.now();
  if (frame === "o") {
    sendWsRequest(context.ws, "authorize", AUTH_REQUEST_ID, context.accessToken);
    return;
  }
  if (frame === "h") {
    context.ws.send("");
    return;
  }
  if (!frame.startsWith("a")) {
    console.warn(JSON.stringify({ event: "tradovate_ws_unhandled_frame", frame: frame.slice(0, 80) }));
    return;
  }

  const messages = JSON.parse(frame.slice(1)) as unknown[];
  for (const message of messages) {
    const record = asRecord(message);
    if (!record) {
      continue;
    }
    throwOnTradovateError(record);
    if (isResponseTo(record, AUTH_REQUEST_ID)) {
      sendWsRequest(context.ws, "md/subscribeQuote", SUBSCRIBE_REQUEST_ID, { symbol: context.contract.symbol });
      continue;
    }
    if (isResponseTo(record, SUBSCRIBE_REQUEST_ID)) {
      context.onSubscribed();
      console.log(JSON.stringify({ event: "tradovate_subscribed", contract: context.contract.symbol }));
      continue;
    }
    await writeMarketDataRows(record, context.contract, context.outputPath, context.latest, context.state);
  }
}

async function writeMarketDataRows(
  message: Record<string, unknown>,
  contract: ContractRef,
  outputPath: string,
  latest: LatestGcQuote,
  state: TradovateState,
): Promise<void> {
  const quotes = extractQuotes(message);
  for (const quote of quotes) {
    const row = buildGcRow(quote, contract, latest);
    if (!row) {
      continue;
    }
    await appendJsonl(outputPath, row);
    state.lastWriteMs = Date.now();
    state.lastError = null;
    state.writeCount += 1;
  }
}

function buildGcRow(
  rawQuote: Record<string, unknown>,
  contract: ContractRef,
  latest: LatestGcQuote,
): Record<string, unknown> | undefined {
  const quoteContractId = asFiniteNumber(rawQuote.contractId);
  if (quoteContractId !== undefined && quoteContractId !== contract.id) {
    return undefined;
  }
  const entries = asRecord(rawQuote.entries);
  if (!entries) {
    return undefined;
  }

  const timestamps: number[] = [];
  updateLatestPrice(latest, "bid", entries.Bid, timestamps);
  updateLatestPrice(latest, "ask", entries.Offer ?? entries.Ask, timestamps);
  updateLatestPrice(latest, "last", entries.Trade, timestamps);

  const volume = entrySize(entries.TotalTradeVolume);
  if (volume !== undefined) {
    latest.volume = volume;
    const timestamp = entryTimestampMs(entries.TotalTradeVolume);
    if (timestamp !== undefined) {
      timestamps.push(timestamp);
    }
  }

  const hasBidAsk = latest.bid !== undefined && latest.ask !== undefined && latest.ask > latest.bid;
  const hasLast = latest.last !== undefined;
  if (!hasBidAsk && !hasLast) {
    return undefined;
  }

  const row: Record<string, unknown> = {
    timestampMs: timestamps.length > 0 ? Math.max(...timestamps) : Date.now(),
    symbol: "GC",
    contract: contract.symbol,
  };
  if (hasBidAsk) {
    row.bid = latest.bid;
    row.ask = latest.ask;
  }
  if (latest.last !== undefined) {
    row.last = latest.last;
  }
  if (latest.volume !== undefined) {
    row.volume = latest.volume;
  }
  return row;
}

function updateLatestPrice(
  latest: LatestGcQuote,
  key: "bid" | "ask" | "last",
  rawEntry: unknown,
  timestamps: number[],
): void {
  const price = entryPrice(rawEntry);
  if (price === undefined) {
    return;
  }
  latest[key] = price;
  const timestamp = entryTimestampMs(rawEntry);
  if (timestamp !== undefined) {
    timestamps.push(timestamp);
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Tradovate HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  const parsed = JSON.parse(bodyText) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    throw new Error(`Tradovate response was not a JSON object: ${url}`);
  }
  return record;
}

function sendWsRequest(ws: WebSocketLike, endpoint: string, requestId: number, body: unknown): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  ws.send(`${endpoint}\n${requestId}\n\n${payload}`);
}

function createWebSocket(url: string): WebSocketLike {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!ctor) {
    throw new Error("Global WebSocket is unavailable; run sidecar with Node.js 22+");
  }
  return new ctor(url);
}

function extractContractId(response: Record<string, unknown>): number | undefined {
  const direct = asFiniteNumber(response.id);
  if (direct !== undefined) {
    return direct;
  }
  const nested = asRecord(response.contract);
  if (nested) {
    return asFiniteNumber(nested.id);
  }
  const items = response.items;
  if (Array.isArray(items)) {
    return firstId(items);
  }
  const results = response.results;
  if (Array.isArray(results)) {
    return firstId(results);
  }
  return undefined;
}

function firstId(items: unknown[]): number | undefined {
  for (const item of items) {
    const record = asRecord(item);
    const id = record ? asFiniteNumber(record.id) : undefined;
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

function isResponseTo(record: Record<string, unknown>, requestId: number): boolean {
  return asFiniteNumber(record.i) === requestId;
}

function throwOnTradovateError(record: Record<string, unknown>): void {
  const status = asFiniteNumber(record.s);
  if (status !== undefined && status >= 400) {
    throw new Error(`Tradovate websocket request failed: status=${status}, body=${JSON.stringify(record).slice(0, 300)}`);
  }
}

function extractQuotes(message: Record<string, unknown>): Record<string, unknown>[] {
  if (message.e !== "md") {
    return [];
  }
  const data = asRecord(message.d);
  if (!data || !Array.isArray(data.quotes)) {
    return [];
  }
  return data.quotes.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function entryPrice(rawEntry: unknown): number | undefined {
  const entry = asRecord(rawEntry);
  return entry ? asFiniteNumber(entry.price) : undefined;
}

function entrySize(rawEntry: unknown): number | undefined {
  const entry = asRecord(rawEntry);
  return entry ? asFiniteNumber(entry.size) : undefined;
}

function entryTimestampMs(rawEntry: unknown): number | undefined {
  const entry = asRecord(rawEntry);
  if (!entry) {
    return undefined;
  }
  const timestamp = entry.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void runTradovateSidecar().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "tradovate_sidecar_fatal", error: message }));
  process.exitCode = 1;
});
