import { getEnv, getNumberEnv } from "../common/env.js";
import { startHeartbeat } from "../common/heartbeat.js";
import { appendJsonl } from "../common/jsonl-writer.js";

interface PepperstoneQuote {
  bid: number;
  ask: number;
  timestampMs?: number;
}

interface PepperstoneSidecarConfig {
  outputPath: string;
  quoteUrl: string;
  pollMs: number;
  maxSpread: number;
}

interface PepperstoneSidecarState {
  lastWriteMs: number | null;
  lastError: string | null;
  writeCount: number;
}

const DEFAULT_OUTPUT_PATH = "/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl";
const DEFAULT_QUOTE_URL = "http://127.0.0.1:8787/pepperstone/xau";

async function runPepperstoneSidecar(): Promise<void> {
  const config = readConfig();
  const state: PepperstoneSidecarState = {
    lastWriteMs: null,
    lastError: null,
    writeCount: 0,
  };

  startHeartbeat("pepperstone-xau", () => ({
    lastWriteMs: state.lastWriteMs,
    lastError: state.lastError,
    writeCount: state.writeCount,
  }));

  console.log(
    JSON.stringify({
      event: "sidecar_started",
      sidecar: "pepperstone-xau",
      quoteUrl: config.quoteUrl,
      outputPath: config.outputPath,
      pollMs: config.pollMs,
      maxSpread: config.maxSpread,
    }),
  );

  while (true) {
    const startedMs = Date.now();
    try {
      const quote = await fetchBridgeQuote(config);
      const row = {
        timestampMs: quote.timestampMs ?? Date.now(),
        symbol: "XAUUSD",
        bid: quote.bid,
        ask: quote.ask,
      };
      await appendJsonl(config.outputPath, row);
      state.lastWriteMs = Date.now();
      state.lastError = null;
      state.writeCount += 1;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          event: "pepperstone_poll_failed",
          error: state.lastError,
        }),
      );
    }

    const elapsedMs = Date.now() - startedMs;
    await sleep(Math.max(0, config.pollMs - elapsedMs));
  }
}

function readConfig(): PepperstoneSidecarConfig {
  return {
    outputPath: getEnv("PEPPERSTONE_XAU_JSONL_PATH", DEFAULT_OUTPUT_PATH)!,
    quoteUrl: getEnv("PEPPERSTONE_QUOTE_URL", DEFAULT_QUOTE_URL)!,
    pollMs: Math.trunc(getNumberEnv("PEPPERSTONE_POLL_MS", 1_000, { min: 100 })),
    maxSpread: getNumberEnv("PEPPERSTONE_MAX_SPREAD", 5, { min: 0 }),
  };
}

async function fetchBridgeQuote(config: PepperstoneSidecarConfig): Promise<PepperstoneQuote> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, config.pollMs * 3));
  try {
    const response = await fetch(config.quoteUrl, { signal: controller.signal });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
    }
    const quote = JSON.parse(bodyText) as Record<string, unknown>;
    return validateQuote(quote, config.maxSpread);
  } finally {
    clearTimeout(timeout);
  }
}

function validateQuote(raw: Record<string, unknown>, maxSpread: number): PepperstoneQuote {
  const bid = asFiniteNumber(raw.bid);
  const ask = asFiniteNumber(raw.ask);
  const timestampMs = raw.timestampMs === undefined ? undefined : asFiniteNumber(raw.timestampMs);
  if (bid === undefined || ask === undefined) {
    throw new Error("Pepperstone bridge quote must include numeric bid and ask");
  }
  if (ask <= bid) {
    throw new Error(`Pepperstone bridge quote has invalid spread: bid=${bid}, ask=${ask}`);
  }
  const spread = ask - bid;
  if (spread > maxSpread) {
    throw new Error(`Pepperstone bridge quote spread ${spread.toFixed(4)} exceeds max ${maxSpread}`);
  }
  return { bid, ask, timestampMs };
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

void runPepperstoneSidecar().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "pepperstone_sidecar_fatal", error: message }));
  process.exitCode = 1;
});
