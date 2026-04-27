import { readFile } from "node:fs/promises";

import { RuntimeConfig } from "../../types.js";
import { aggregateCandles, buildCandlesFromTicks } from "../bar-builder.js";
import { Candle, DataProvider, MarketTick, SourceHealth, Timeframe } from "../types.js";

interface RithmicJsonlRow {
  timestampMs?: unknown;
  symbol?: unknown;
  contract?: unknown;
  bid?: unknown;
  ask?: unknown;
  last?: unknown;
  volume?: unknown;
}

function configuredHealth(): SourceHealth {
  return {
    source: "rithmic",
    ok: false,
    lastUpdateMs: 0,
    ageMs: Number.POSITIVE_INFINITY,
    latencyMs: 0,
    stale: true,
    error: "RITHMIC_GC_JSONL_PATH not configured",
    qualityScore: 0
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseLine(line: string): RithmicJsonlRow | null {
  try {
    return JSON.parse(line) as RithmicJsonlRow;
  } catch {
    return null;
  }
}

export class RithmicFileProvider implements DataProvider {
  readonly name = "rithmic" as const;
  private health: SourceHealth = configuredHealth();

  constructor(private readonly config: RuntimeConfig) {}

  getHealth(): SourceHealth {
    if (!this.config.rithmicGcJsonlPath || this.health.lastUpdateMs <= 0) return this.health;
    const ageMs = Date.now() - this.health.lastUpdateMs;
    const stale = ageMs > this.config.maxTickAgeMs;
    return {
      ...this.health,
      ageMs,
      stale,
      ok: this.health.ok && !stale,
      qualityScore: stale ? Math.min(this.health.qualityScore, 40) : this.health.qualityScore
    };
  }

  async fetchLatestTick(): Promise<MarketTick | null> {
    const ticks = await this.readTicks(2_000);
    return ticks[ticks.length - 1] ?? null;
  }

  async fetchRecentCandles(
    _symbol: string,
    timeframe: Timeframe,
    count: number
  ): Promise<Candle[]> {
    const ticks = await this.readTicks(Math.max(count * 120, 2_000));
    const oneMinute = buildCandlesFromTicks(ticks, "1m");
    if (timeframe === "1m") return oneMinute.slice(-count);
    if (timeframe === "5m" || timeframe === "15m" || timeframe === "1h") {
      return aggregateCandles(oneMinute, timeframe).slice(-count);
    }
    return [];
  }

  private async readTicks(maxLines: number): Promise<MarketTick[]> {
    const path = this.config.rithmicGcJsonlPath;
    const start = Date.now();
    if (!path) {
      this.health = configuredHealth();
      return [];
    }

    try {
      const raw = await readFile(path, "utf8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim()).slice(-maxLines);
      const ticks: MarketTick[] = [];
      for (const line of lines) {
        const row = parseLine(line);
        if (!row || !finite(row.timestampMs)) continue;
        const bid = finite(row.bid) ? row.bid : undefined;
        const ask = finite(row.ask) ? row.ask : undefined;
        const last = finite(row.last) ? row.last : undefined;
        const mid =
          bid !== undefined && ask !== undefined
            ? (bid + ask) / 2
            : last;
        if (mid === undefined || !Number.isFinite(mid)) continue;

        ticks.push({
          symbol: typeof row.symbol === "string" ? row.symbol : "GC",
          source: "rithmic",
          instrumentKind: "futures",
          timestampMs: row.timestampMs,
          bid,
          ask,
          mid,
          last,
          volume: finite(row.volume) ? row.volume : undefined,
          exchange: "COMEX",
          contract: typeof row.contract === "string" ? row.contract : undefined,
          raw: row
        });
      }

      const last = ticks[ticks.length - 1];
      if (!last) {
        this.health = {
          source: "rithmic",
          ok: false,
          lastUpdateMs: 0,
          ageMs: Number.POSITIVE_INFINITY,
          latencyMs: Date.now() - start,
          stale: true,
          error: "Rithmic JSONL contained no valid ticks",
          qualityScore: 0
        };
        return [];
      }

      const ageMs = Date.now() - last.timestampMs;
      const stale = ageMs > this.config.maxTickAgeMs;
      this.health = {
        source: "rithmic",
        ok: !stale,
        lastUpdateMs: last.timestampMs,
        ageMs,
        latencyMs: Date.now() - start,
        stale,
        error: stale ? "latest Rithmic tick is stale" : undefined,
        qualityScore: stale ? 40 : 95
      };
      return ticks;
    } catch (error) {
      this.health = {
        source: "rithmic",
        ok: false,
        lastUpdateMs: 0,
        ageMs: Number.POSITIVE_INFINITY,
        latencyMs: Date.now() - start,
        stale: true,
        error: (error as Error).message,
        qualityScore: 0
      };
      return [];
    }
  }
}
