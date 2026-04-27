import { readFile } from "node:fs/promises";

interface FuturesRow {
  timestampMs?: unknown;
  bid?: unknown;
  ask?: unknown;
  last?: unknown;
}

interface PepperstoneRow {
  timestampMs?: unknown;
  bid?: unknown;
  ask?: unknown;
}

const DEFAULT_FUTURES_PATH = "/quant/calc/data/xau-state-discord/rithmic-gc.jsonl";
const DEFAULT_PEPPERSTONE_PATH = "/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl";
const maxAgeMs = readNumberEnv("MAX_TICK_AGE_MS", 15_000);

async function main(): Promise<void> {
  const futuresPath = process.env.RITHMIC_GC_JSONL_PATH || DEFAULT_FUTURES_PATH;
  const pepperstonePath = process.env.PEPPERSTONE_XAU_JSONL_PATH || DEFAULT_PEPPERSTONE_PATH;
  const nowMs = Date.now();

  const futuresRows = await readLastJsonRows<FuturesRow>(futuresPath, 5);
  const pepperstoneRows = await readLastJsonRows<PepperstoneRow>(pepperstonePath, 5);
  const futures = futuresRows.at(-1);
  const pepperstone = pepperstoneRows.at(-1);

  const futuresAgeMs = ageMs(futures?.timestampMs, nowMs);
  const pepperstoneAgeMs = ageMs(pepperstone?.timestampMs, nowMs);
  const futuresLast = latestFuturesPrice(futures);
  const pepperstoneBid = asFiniteNumber(pepperstone?.bid);
  const pepperstoneAsk = asFiniteNumber(pepperstone?.ask);
  const pepperstoneSpread = spread(pepperstone);
  const pepperstoneMid =
    pepperstoneSpread === null || pepperstoneBid === null || pepperstoneAsk === null
      ? null
      : (pepperstoneBid + pepperstoneAsk) / 2;

  const report = {
    futures_ok: futuresAgeMs !== null && futuresAgeMs <= maxAgeMs && futuresLast !== null,
    pepperstone_ok: pepperstoneAgeMs !== null && pepperstoneAgeMs <= maxAgeMs && pepperstoneSpread !== null,
    futures_age_ms: futuresAgeMs,
    pepperstone_age_ms: pepperstoneAgeMs,
    futures_last: futuresLast,
    pepperstone_mid: pepperstoneMid,
    pepperstone_spread: pepperstoneSpread,
  };

  console.log(JSON.stringify(report, null, 2));
}

async function readLastJsonRows<T>(filePath: string, count: number): Promise<T[]> {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-count)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "jsonl_parse_failed",
              filePath,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return [];
        }
      });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") {
      console.error(
        JSON.stringify({
          event: "jsonl_read_failed",
          filePath,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return [];
  }
}

function ageMs(timestamp: unknown, nowMs: number): number | null {
  const value = asFiniteNumber(timestamp);
  if (value === null) {
    return null;
  }
  return Math.max(0, nowMs - value);
}

function latestFuturesPrice(row: FuturesRow | undefined): number | null {
  const last = asFiniteNumber(row?.last);
  if (last !== null) {
    return last;
  }
  const bid = asFiniteNumber(row?.bid);
  const ask = asFiniteNumber(row?.ask);
  if (bid !== null && ask !== null && ask > bid) {
    return (bid + ask) / 2;
  }
  return null;
}

function spread(row: PepperstoneRow | undefined): number | null {
  const bid = asFiniteNumber(row?.bid);
  const ask = asFiniteNumber(row?.ask);
  if (bid === null || ask === null || ask <= bid) {
    return null;
  }
  return ask - bid;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "check_ingest_failed", error: message }));
  process.exitCode = 1;
});
