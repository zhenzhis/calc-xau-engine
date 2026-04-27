import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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

export interface IngestReport {
  pepperstone_ok: boolean;
  futures_ok: boolean;
  pepperstone_age_ms: number | null;
  futures_age_ms: number | null;
  pepperstone_spread: number | null;
  futures_last: number | null;
  messages: string[];
}

interface IngestReportOptions {
  pepperstonePath: string;
  futuresPath: string;
  nowMs?: number;
  maxAgeMs?: number;
}

const DEFAULT_FUTURES_PATH = "/quant/calc/data/xau-state-discord/rithmic-gc.jsonl";
const DEFAULT_PEPPERSTONE_PATH = "/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl";

export async function buildIngestReport(options: IngestReportOptions): Promise<IngestReport> {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? readNumberEnv("MAX_TICK_AGE_MS", 15_000);
  const messages: string[] = [];

  const futuresRows = await readLastJsonRows<FuturesRow>(options.futuresPath, 5, "futures", messages);
  const pepperstoneRows = await readLastJsonRows<PepperstoneRow>(options.pepperstonePath, 5, "pepperstone", messages);
  const futures = futuresRows.at(-1);
  const pepperstone = pepperstoneRows.at(-1);

  const futuresAgeMs = ageMs(futures?.timestampMs, nowMs);
  const pepperstoneAgeMs = ageMs(pepperstone?.timestampMs, nowMs);
  const futuresLast = latestFuturesPrice(futures);
  const pepperstoneSpread = spread(pepperstone);

  if (futuresAgeMs === null) {
    messages.push("futures timestamp missing or invalid");
  } else if (futuresAgeMs > maxAgeMs) {
    messages.push(`futures stale: age ${futuresAgeMs}ms exceeds ${maxAgeMs}ms`);
  }
  if (futuresLast === null) {
    messages.push("futures bid/ask or last missing/invalid");
  }
  if (pepperstoneAgeMs === null) {
    messages.push("pepperstone timestamp missing or invalid");
  } else if (pepperstoneAgeMs > maxAgeMs) {
    messages.push(`pepperstone stale: age ${pepperstoneAgeMs}ms exceeds ${maxAgeMs}ms`);
  }
  if (pepperstoneSpread === null) {
    messages.push("pepperstone bid/ask/spread missing or invalid");
  }

  return {
    pepperstone_ok: pepperstoneAgeMs !== null && pepperstoneAgeMs <= maxAgeMs && pepperstoneSpread !== null,
    futures_ok: futuresAgeMs !== null && futuresAgeMs <= maxAgeMs && futuresLast !== null,
    pepperstone_age_ms: pepperstoneAgeMs,
    futures_age_ms: futuresAgeMs,
    pepperstone_spread: pepperstoneSpread,
    futures_last: futuresLast,
    messages,
  };
}

async function main(): Promise<void> {
  const report = await buildIngestReport({
    futuresPath: process.env.RITHMIC_GC_JSONL_PATH || DEFAULT_FUTURES_PATH,
    pepperstonePath: process.env.PEPPERSTONE_XAU_JSONL_PATH || DEFAULT_PEPPERSTONE_PATH,
  });
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--strict") && (!report.futures_ok || !report.pepperstone_ok)) {
    process.exitCode = 1;
  }
}

async function readLastJsonRows<T>(
  filePath: string,
  count: number,
  label: string,
  messages: string[],
): Promise<T[]> {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-count)
      .flatMap((line, index) => {
        try {
          return [JSON.parse(line) as T];
        } catch (error) {
          messages.push(`${label} JSON parse failed at tail line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
          return [];
        }
      });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      messages.push(`${label} file not found: ${filePath}`);
      return [];
    }
    messages.push(`${label} read failed: ${error instanceof Error ? error.message : String(error)}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(JSON.stringify({ event: "check_ingest_failed", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
