import { readFile } from "node:fs/promises";

import { RuntimeConfig } from "../../types.js";
import { buildCandlesFromTicks } from "../bar-builder.js";
import { Candle, DataProvider, MarketTick, SourceHealth, Timeframe } from "../types.js";

interface PepperstoneJsonlRow {
  timestampMs?: unknown;
  symbol?: unknown;
  bid?: unknown;
  ask?: unknown;
  feed?: unknown;
  sidecar?: unknown;
  sessionVerified?: unknown;
  testData?: unknown;
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isSyntheticTestFeed(row: PepperstoneJsonlRow): boolean {
  return row.testData === true || row.feed === "synthetic_test";
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
        const testData = isSyntheticTestFeed(row);
        const qualityScore = testData ? 20 : 95;
        ticks.push({
          symbol: typeof row.symbol === "string" ? row.symbol : "XAUUSD",
          source: "pepperstone",
          instrumentKind: "broker_spot",
          timestampMs: row.timestampMs,
          bid: row.bid,
          ask: row.ask,
          mid: (row.bid + row.ask) / 2,
          qualityScore,
          feed: optionalString(row.feed),
          sidecar: optionalString(row.sidecar),
          sessionVerified: typeof row.sessionVerified === "boolean" ? row.sessionVerified : undefined,
          testData,
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
      const spreadWide = spread > this.config.maxBrokerSpread;
      const spreadPenalty = spreadWide ? 45 : spread > 1 ? 20 : 0;
      const isTest = last.testData === true || last.feed === "synthetic_test";
      const productionQuality = Math.max(60, 95 - spreadPenalty);
      const qualityScore = stale
        ? Math.min(isTest ? 20 : spreadWide ? 50 : productionQuality, 40)
        : isTest ? 20 : spreadWide ? Math.min(productionQuality, 50) : productionQuality;
      this.health = {
        source: "pepperstone",
        ok: !stale && !isTest && !spreadWide,
        lastUpdateMs: last.timestampMs,
        ageMs,
        latencyMs: Date.now() - start,
        stale,
        error: stale
          ? "latest Pepperstone tick is stale"
          : isTest
            ? "synthetic/test Pepperstone feed"
            : undefined,
        warning: isTest
          ? "synthetic/test feed; not production cTrader FIX"
          : spreadWide
            ? "broker spread wide"
            : undefined,
        feed: last.feed,
        sidecar: last.sidecar,
        sessionVerified: last.sessionVerified,
        testData: isTest,
        qualityScore
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
