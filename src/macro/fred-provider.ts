import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { SourceHealth } from "../data/types.js";
import { RuntimeConfig } from "../types.js";
import { emptyMacroDrivers, MacroDrivers, MacroSnapshot } from "./types.js";

interface FredCache {
  asOfMs: number;
  us2y?: number;
  us10y?: number;
  realYield10y?: number;
}

const FRED_SERIES = {
  us2y: "DGS2",
  us10y: "DGS10",
  realYield10y: "DFII10"
} as const;

function health(
  ok: boolean,
  lastUpdateMs: number,
  latencyMs: number,
  error?: string
): SourceHealth {
  const ageMs = lastUpdateMs > 0 ? Date.now() - lastUpdateMs : Number.POSITIVE_INFINITY;
  const stale = lastUpdateMs <= 0 || ageMs > 36 * 60 * 60 * 1000;
  return {
    source: "fred",
    ok: ok && !stale,
    lastUpdateMs,
    ageMs,
    latencyMs,
    stale,
    error,
    qualityScore: ok ? (stale ? 50 : 85) : 0
  };
}

function latestCsvValue(csv: string): number | undefined {
  const lines = csv.trim().split(/\r?\n/).slice(1).reverse();
  for (const line of lines) {
    const [, rawValue] = line.split(",");
    const value = Number(rawValue);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`FRED HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export class FredProvider {
  private lastHealth = health(false, 0, 0, "not fetched");

  constructor(private readonly config: RuntimeConfig) {}

  getHealth(): SourceHealth {
    return this.lastHealth;
  }

  async fetchSnapshot(): Promise<MacroSnapshot> {
    if (!this.config.enableFred) {
      this.lastHealth = health(false, 0, 0, "ENABLE_FRED=false");
      return { asOfMs: Date.now(), sourceHealth: [this.lastHealth] };
    }

    const start = Date.now();
    try {
      const cached = await this.readCache();
      if (cached && Date.now() - cached.asOfMs < 24 * 60 * 60 * 1000) {
        this.lastHealth = health(true, cached.asOfMs, Date.now() - start);
        return { ...cached, sourceHealth: [this.lastHealth] };
      }

      const [us2y, us10y, realYield10y] = await Promise.all([
        this.fetchSeries(FRED_SERIES.us2y),
        this.fetchSeries(FRED_SERIES.us10y),
        this.fetchSeries(FRED_SERIES.realYield10y)
      ]);
      const cache: FredCache = { asOfMs: Date.now(), us2y, us10y, realYield10y };
      await this.writeCache(cache);
      this.lastHealth = health(true, cache.asOfMs, Date.now() - start);
      return { ...cache, sourceHealth: [this.lastHealth] };
    } catch (error) {
      const cached = await this.readCache().catch(() => null);
      if (cached) {
        this.lastHealth = health(false, cached.asOfMs, Date.now() - start, (error as Error).message);
        return { ...cached, sourceHealth: [this.lastHealth] };
      }
      this.lastHealth = health(false, 0, Date.now() - start, (error as Error).message);
      return { asOfMs: Date.now(), sourceHealth: [this.lastHealth] };
    }
  }

  deriveDrivers(snapshot: MacroSnapshot): MacroDrivers {
    if (
      snapshot.us2y === undefined &&
      snapshot.us10y === undefined &&
      snapshot.realYield10y === undefined
    ) {
      return emptyMacroDrivers();
    }

    const ratesPressure = snapshot.us10y !== undefined
      ? Math.max(-1, Math.min(1, -(snapshot.us10y - 4.0) / 2))
      : 0;
    const realYieldPressure = snapshot.realYield10y !== undefined
      ? Math.max(-1, Math.min(1, -(snapshot.realYield10y - 1.5) / 2))
      : 0;
    const composite = ratesPressure * 0.4 + realYieldPressure * 0.6;
    const macroBias =
      composite > 0.2 ? "bullish-gold"
      : composite < -0.2 ? "bearish-gold"
      : "mixed";

    return {
      dollarPressure: 0,
      ratesPressure,
      realYieldPressure,
      riskOffPressure: 0,
      silverConfirmation: 0,
      macroBias
    };
  }

  private async fetchSeries(seriesId: string): Promise<number | undefined> {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
    return latestCsvValue(await fetchText(url, this.config.requestTimeoutMs));
  }

  private async readCache(): Promise<FredCache | null> {
    try {
      const raw = await readFile(this.config.fredCachePath, "utf8");
      const parsed = JSON.parse(raw) as FredCache;
      return typeof parsed.asOfMs === "number" ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeCache(cache: FredCache): Promise<void> {
    await mkdir(dirname(this.config.fredCachePath), { recursive: true });
    await writeFile(this.config.fredCachePath, JSON.stringify(cache, null, 2), "utf8");
  }
}
