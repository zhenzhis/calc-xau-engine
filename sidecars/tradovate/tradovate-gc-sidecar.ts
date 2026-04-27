import { optionalEnv, parseNumberEnv, requireEnv } from "../common/env.js";
import { createHeartbeat } from "../common/heartbeat.js";
import { appendJsonl } from "../common/jsonl-writer.js";
import { safeJson } from "../common/redaction.js";
import { TradovateClient, type TradovateClientConfig, type TradovateQuote } from "./tradovate-client.js";

interface SidecarConfig extends TradovateClientConfig {
  outputPath: string;
  maxReconnectMs: number;
  onceTimeoutMs: number;
}

interface SidecarState {
  lastWriteMs: number | null;
  lastQuote: { bid?: number; ask?: number; last?: number; volume?: number } | null;
  lastError: string | null;
  reconnects: number;
  writeCount: number;
}

const DEFAULT_OUTPUT_PATH = "/quant/calc/data/xau-state-discord/rithmic-gc.jsonl";
const DEFAULT_MD_WS_URL = "wss://md.tradovateapi.com/v1/websocket";

async function main(): Promise<void> {
  const config = readConfig();
  const once = process.argv.includes("--once");
  const state: SidecarState = {
    lastWriteMs: null,
    lastQuote: null,
    lastError: null,
    reconnects: 0,
    writeCount: 0,
  };

  createHeartbeat("tradovate-gc", 30_000, () => ({
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
      sidecar: "tradovate-gc",
      env: config.envName,
      restUrl: config.restUrl,
      mdWsUrl: config.mdWsUrl,
      contract: config.contract,
      outputPath: config.outputPath,
      once,
    }),
  );

  const client = new TradovateClient(config);
  if (once) {
    await client.runQuoteSession((quote) => writeQuote(config, state, quote), {
      once: true,
      onceTimeoutMs: config.onceTimeoutMs,
    });
    return;
  }

  let reconnectDelayMs = 1_000;
  while (true) {
    try {
      await client.runQuoteSession((quote) => {
        void writeQuote(config, state, quote).catch((error) => {
          state.lastError = error instanceof Error ? error.message : String(error);
          console.error(safeJson({ event: "tradovate_write_failed", error: state.lastError }));
        });
      });
      reconnectDelayMs = 1_000;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error(safeJson({ event: "tradovate_retry", error: state.lastError, reconnectDelayMs }));
      await sleep(reconnectDelayMs);
      state.reconnects += 1;
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, config.maxReconnectMs);
    }
  }
}

async function writeQuote(config: SidecarConfig, state: SidecarState, quote: TradovateQuote): Promise<boolean> {
  const row: Record<string, unknown> = {
    timestampMs: quote.timestampMs,
    symbol: "GC",
    contract: config.contract,
  };
  if (quote.bid !== undefined && quote.ask !== undefined && quote.ask > quote.bid) {
    row.bid = quote.bid;
    row.ask = quote.ask;
  }
  if (quote.last !== undefined) {
    row.last = quote.last;
  }
  if (quote.volume !== undefined) {
    row.volume = quote.volume;
  }
  if (row.bid === undefined && row.last === undefined) {
    return false;
  }

  await appendJsonl(config.outputPath, row);
  state.lastWriteMs = Date.now();
  state.lastQuote = { bid: quote.bid, ask: quote.ask, last: quote.last, volume: quote.volume };
  state.lastError = null;
  state.writeCount += 1;
  return true;
}

function readConfig(): SidecarConfig {
  const envName = readEnvName();
  const restUrl =
    envName === "live" ? "https://live.tradovateapi.com/v1" : "https://demo.tradovateapi.com/v1";
  return {
    envName,
    restUrl: optionalEnv("TRADOVATE_REST_URL", restUrl)!,
    mdWsUrl: optionalEnv("TRADOVATE_MD_WS_URL", DEFAULT_MD_WS_URL)!,
    username: requireEnv("TRADOVATE_USERNAME"),
    password: requireEnv("TRADOVATE_PASSWORD"),
    appId: requireEnv("TRADOVATE_APP_ID"),
    appVersion: optionalEnv("TRADOVATE_APP_VERSION", "1.0")!,
    cid: requireEnv("TRADOVATE_CID"),
    sec: requireEnv("TRADOVATE_SEC"),
    contract: optionalEnv("TRADOVATE_GC_CONTRACT", "GCM6")!,
    outputPath: optionalEnv("RITHMIC_GC_JSONL_PATH", DEFAULT_OUTPUT_PATH)!,
    maxReconnectMs: Math.trunc(parseNumberEnv("TRADOVATE_MAX_RECONNECT_MS", 60_000, { min: 1_000 })),
    onceTimeoutMs: Math.trunc(parseNumberEnv("TRADOVATE_ONCE_TIMEOUT_MS", 30_000, { min: 1_000 })),
  };
}

function readEnvName(): "demo" | "live" {
  const envName = optionalEnv("TRADOVATE_ENV", "demo")!.toLowerCase();
  if (envName !== "demo" && envName !== "live") {
    throw new Error("TRADOVATE_ENV must be demo or live");
  }
  return envName;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error(safeJson({ event: "tradovate_fatal", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
