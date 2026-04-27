import { optionalEnv, parseBooleanEnv, parseNumberEnv, requireEnv } from "../common/env.js";
import { createHeartbeat } from "../common/heartbeat.js";
import { appendJsonl } from "../common/jsonl-writer.js";
import { safeJson } from "../common/redaction.js";
import { CTraderFixClient, type CTraderQuote, type FixSessionConfig } from "./ctrader-fix-client.js";

interface PepperstoneFixConfig extends FixSessionConfig {
  symbolId: string;
  outputPath: string;
  maxSpread: number;
  maxReconnectMs: number;
}

interface SidecarState {
  lastWriteMs: number | null;
  lastQuote: { bid?: number; ask?: number; spread?: number } | null;
  lastError: string | null;
  reconnects: number;
  writeCount: number;
}

const DEFAULT_OUTPUT_PATH = "/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl";

async function main(): Promise<void> {
  const config = readConfig();
  const state: SidecarState = {
    lastWriteMs: null,
    lastQuote: null,
    lastError: null,
    reconnects: 0,
    writeCount: 0,
  };

  createHeartbeat("pepperstone-ctrader-fix", 30_000, () => ({
    alive: true,
    lastWriteAgeMs: state.lastWriteMs === null ? null : Date.now() - state.lastWriteMs,
    lastQuote: state.lastQuote,
    lastError: state.lastError,
    reconnects: state.reconnects,
    writeCount: state.writeCount,
  }));

  console.log(
    safeJson({
      event: "sidecar_started",
      sidecar: "pepperstone-ctrader-fix",
      host: config.host,
      port: config.port,
      ssl: config.ssl,
      senderCompId: config.senderCompId,
      targetCompId: config.targetCompId,
      senderSubId: config.senderSubId,
      targetSubId: config.targetSubId,
      outputPath: config.outputPath,
    }),
  );

  let reconnectDelayMs = 1_000;
  let currentClient: CTraderFixClient | null = null;
  let stopping = false;
  const shutdown = (): void => {
    stopping = true;
    currentClient?.logout("client shutdown");
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  while (!stopping) {
    try {
      currentClient = new CTraderFixClient(config);
      await runSession(currentClient, config, state);
      reconnectDelayMs = 1_000;
    } catch (error) {
      if (stopping) {
        break;
      }
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error(safeJson({ event: "pepperstone_fix_retry", error: state.lastError, reconnectDelayMs }));
      currentClient?.close();
      await sleep(reconnectDelayMs);
      state.reconnects += 1;
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, config.maxReconnectMs);
    }
  }
}

async function runSession(client: CTraderFixClient, config: PepperstoneFixConfig, state: SidecarState): Promise<void> {
  client.on("quote", (quote: CTraderQuote) => {
    void writeQuote(config, state, quote).catch((error) => {
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error(safeJson({ event: "pepperstone_fix_write_failed", error: state.lastError }));
    });
  });
  client.on("reject", (message) => {
    console.error(safeJson({ event: "pepperstone_fix_reject", msgType: message.get("35"), text: message.get("58") }));
  });

  await client.connect();
  const logonAck = new Promise<void>((resolve, reject) => {
    client.once("logon", () => resolve());
    client.once("close", () => reject(new Error("cTrader FIX socket closed before logon")));
    client.once("error", reject);
  });
  client.logon();
  await logonAck;
  client.subscribeMarketData(config.symbolId);
  await new Promise<void>((_resolve, reject) => {
    client.once("close", () => reject(new Error("cTrader FIX socket closed")));
    client.once("error", reject);
  });
}

async function writeQuote(config: PepperstoneFixConfig, state: SidecarState, quote: CTraderQuote): Promise<void> {
  if (quote.bid === undefined || quote.ask === undefined) {
    return;
  }
  if (!Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.ask <= quote.bid) {
    throw new Error(`invalid cTrader quote bid=${quote.bid} ask=${quote.ask}`);
  }
  const spread = quote.ask - quote.bid;
  if (spread > config.maxSpread) {
    throw new Error(`cTrader quote spread ${spread.toFixed(4)} exceeds max ${config.maxSpread}`);
  }
  await appendJsonl(config.outputPath, {
    timestampMs: Date.now(),
    symbol: "XAUUSD",
    bid: quote.bid,
    ask: quote.ask,
  });
  state.lastWriteMs = Date.now();
  state.lastQuote = { bid: quote.bid, ask: quote.ask, spread };
  state.lastError = null;
  state.writeCount += 1;
}

function readConfig(): PepperstoneFixConfig {
  return {
    host: requireEnv("CTRADER_FIX_HOST"),
    port: Math.trunc(parseNumberEnv("CTRADER_FIX_PORT", 5211, { min: 1, max: 65535 })),
    ssl: parseBooleanEnv("CTRADER_FIX_SSL", true),
    username: requireEnv("CTRADER_FIX_USERNAME"),
    password: requireEnv("CTRADER_FIX_PASSWORD"),
    senderCompId: requireEnv("CTRADER_FIX_SENDER_COMP_ID"),
    targetCompId: optionalEnv("CTRADER_FIX_TARGET_COMP_ID", "CSERVER")!,
    senderSubId: optionalEnv("CTRADER_FIX_SENDER_SUB_ID", "QUOTE")!,
    targetSubId: optionalEnv("CTRADER_FIX_TARGET_SUB_ID", "QUOTE")!,
    heartbeatSec: Math.trunc(parseNumberEnv("CTRADER_FIX_HEARTBEAT_SEC", 30, { min: 0 })),
    resetSeqNum: parseBooleanEnv("CTRADER_FIX_RESET_SEQ_NUM", true),
    symbolId: requireEnv("CTRADER_FIX_SYMBOL_ID_XAUUSD"),
    outputPath: optionalEnv("PEPPERSTONE_XAU_JSONL_PATH", DEFAULT_OUTPUT_PATH)!,
    maxSpread: parseNumberEnv("PEPPERSTONE_MAX_SPREAD", 5, { min: 0 }),
    maxReconnectMs: Math.trunc(parseNumberEnv("CTRADER_FIX_MAX_RECONNECT_MS", 60_000, { min: 1_000 })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error(safeJson({ event: "pepperstone_fix_fatal", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
