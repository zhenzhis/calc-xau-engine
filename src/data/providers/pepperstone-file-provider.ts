import { readFile } from "node:fs/promises";

import { RuntimeConfig } from "../../types.js";
import { buildCandlesFromTicks } from "../bar-builder.js";
import { Candle, DataProvider, MarketTick, SourceHealth, Timeframe } from "../types.js";

interface PepperstoneJsonlRow {
  timestampMs?: unknown;
  symbol?: unknown;
  bid?: unknown;
  ask?: unknown;
}

function initialHealth(): SourceHealth {
  return {
    source: "pepperstone",
    ok: false,
    lastUpdateMs: 0,
    ageMs: Number.POSITIVE_INFINITY,
    latencyMs: 0,
    stale: true,
    error: "PEPPERSTONE_XAU_JSONL_PATH not configured",
    qualityScore: 0
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseLine(line: string): PepperstoneJsonlRow | null {
  try {
    return JSON.parse(line) as PepperstoneJsonlRow;
  } catch {
    return null;
  }
}

export class PepperstoneFileProvider implements DataProvider {
  readonly name = "pepperstone" as const;
  private health: SourceHealth = initialHealth();

  constructor(private readonly config: RuntimeConfig) {}

  getHealth(): SourceHealth {
    if (!this.config.pepperstoneXauJsonlPath || this.health.lastUpdateMs <= 0) return this.health;
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
    if (timeframe !== "1m") return [];
    return buildCandlesFromTicks(await this.readTicks(Math.max(count * 120, 2_000)), "1m").slice(-count);
  }

  private async readTicks(maxLines: number): Promise<MarketTick[]> {
    const path = this.config.pepperstoneXauJsonlPath;
    const start = Date.now();
    if (!path) {
      this.health = initialHealth();
      return [];
    }

    try {
      const raw = await readFile(path, "utf8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim()).slice(-maxLines);
      const ticks: MarketTick[] = [];
      for (const line of lines) {
        const row = parseLine(line);
        if (!row || !finite(row.timestampMs) || !finite(row.bid) || !finite(row.ask)) continue;
        ticks.push({
          symbol: typeof row.symbol === "string" ? row.symbol : "XAUUSD",
          source: "pepperstone",
          instrumentKind: "broker_spot",
          timestampMs: row.timestampMs,
          bid: row.bid,
          ask: row.ask,
          mid: (row.bid + row.ask) / 2,
          raw: row
        });
      }

      const last = ticks[ticks.length - 1];
      if (!last) {
        this.health = {
          source: "pepperstone",
          ok: false,
          lastUpdateMs: 0,
          ageMs: Number.POSITIVE_INFINITY,
          latencyMs: Date.now() - start,
          stale: true,
          error: "Pepperstone JSONL contained no valid ticks",
          qualityScore: 0
        };
        return [];
      }

      const ageMs = Date.now() - last.timestampMs;
      const stale = ageMs > this.config.maxTickAgeMs;
      const spread = last.ask !== undefined && last.bid !== undefined ? last.ask - last.bid : 0;
      const spreadPenalty = spread > 1 ? 20 : 0;
      this.health = {
        source: "pepperstone",
        ok: !stale,
        lastUpdateMs: last.timestampMs,
        ageMs,
        latencyMs: Date.now() - start,
        stale,
        error: stale ? "latest Pepperstone tick is stale" : undefined,
        qualityScore: stale ? 40 : Math.max(60, 95 - spreadPenalty)
      };
      return ticks;
    } catch (error) {
      this.health = {
        source: "pepperstone",
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
