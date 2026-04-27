import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Logger } from "../lib/logger.js";
import { RuntimeConfig } from "../types.js";
import { getJson } from "../lib/http.js";
import { aggregateCandles } from "./bar-builder.js";
import {
  Candle,
  DataProvider,
  DataSourceName,
  InstrumentKind,
  MarketTick,
  SourceHealth,
  Timeframe
} from "./types.js";

export interface GoldQuote {
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  change: number;
  changePct: number;
  timestamp: number;
  symbol: string;
  source: DataSourceName;
  instrumentKind: InstrumentKind;
}

export interface PricePoint {
  price: number;
  timestamp: number;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketTime: number;
      };
      timestamp?: number[];
      indicators?: {
        quote: Array<{
          open: Array<number | null>;
          high: Array<number | null>;
          low: Array<number | null>;
          close: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error: null | { code: string; description: string };
  };
}

const MAX_BUFFER_SIZE = 512;
const YAHOO_SYMBOL = "GC=F";
const YAHOO_CHART_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d";

function initialHealth(source: DataSourceName): SourceHealth {
  return {
    source,
    ok: false,
    lastUpdateMs: 0,
    ageMs: Number.POSITIVE_INFINITY,
    latencyMs: 0,
    stale: true,
    error: "not fetched",
    qualityScore: 0
  };
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export class PriceBuffer {
  private points: PricePoint[] = [];

  constructor(private readonly persistPath: string) {}

  get length(): number {
    return this.points.length;
  }

  get prices(): number[] {
    return this.points.map((p) => p.price);
  }

  get latest(): PricePoint | null {
    return this.points.length > 0 ? this.points[this.points.length - 1] : null;
  }

  push(point: PricePoint): void {
    if (this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      if (last.timestamp === point.timestamp) return;
    }

    this.points.push(point);
    if (this.points.length > MAX_BUFFER_SIZE) {
      this.points = this.points.slice(-MAX_BUFFER_SIZE);
    }
  }

  recent(count: number): number[] {
    return this.points.slice(-count).map((p) => p.price);
  }

  durationMs(): number {
    if (this.points.length < 2) return 0;
    return this.points[this.points.length - 1].timestamp - this.points[0].timestamp;
  }

  async persist(): Promise<void> {
    await mkdir(dirname(this.persistPath), { recursive: true });
    const data = this.points.slice(-200);
    await writeFile(this.persistPath, JSON.stringify(data), "utf8");
  }

  async restore(): Promise<void> {
    try {
      const raw = await readFile(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;

      const now = Date.now();
      const maxAgeMs = 6 * 60 * 60 * 1000;

      for (const entry of parsed) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as PricePoint).price === "number" &&
          typeof (entry as PricePoint).timestamp === "number" &&
          now - (entry as PricePoint).timestamp < maxAgeMs
        ) {
          this.points.push(entry as PricePoint);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export class YahooGoldProvider implements DataProvider {
  readonly name = "yahoo" as const;
  private health: SourceHealth = initialHealth("yahoo");
  private lastQuote: GoldQuote | null = null;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger
  ) {}

  getHealth(): SourceHealth {
    if (this.health.lastUpdateMs <= 0) return this.health;
    const ageMs = Date.now() - this.health.lastUpdateMs;
    const stale = ageMs > this.config.maxCandleAgeMs;
    return {
      ...this.health,
      ageMs,
      stale,
      ok: this.health.ok && !stale,
      qualityScore: stale ? Math.min(this.health.qualityScore, 40) : this.health.qualityScore
    };
  }

  async fetchLatestTick(): Promise<MarketTick> {
    const quote = await this.fetchQuote();
    return {
      symbol: YAHOO_SYMBOL,
      source: "yahoo",
      instrumentKind: "futures_proxy",
      timestampMs: quote.timestamp * 1000,
      mid: quote.price,
      last: quote.price,
      exchange: "COMEX",
      contract: YAHOO_SYMBOL,
      raw: { provider: "Yahoo Finance chart API" }
    };
  }

  async fetchRecentCandles(
    _symbol: string,
    timeframe: Timeframe,
    count: number
  ): Promise<Candle[]> {
    const raw = await this.fetchChart();
    const result = raw.chart.result?.[0];
    if (!result?.timestamp || !result.indicators?.quote?.[0]) return [];

    const quotes = result.indicators.quote[0];
    const oneMinute: Candle[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const open = quotes.open[i];
      const high = quotes.high[i];
      const low = quotes.low[i];
      const close = quotes.close[i];
      if (!validNumber(open) || !validNumber(high) || !validNumber(low) || !validNumber(close)) {
        continue;
      }

      const volumeRaw = quotes.volume?.[i];
      const volume = validNumber(volumeRaw) ? volumeRaw : undefined;
      const startMs = result.timestamp[i] * 1000;
      oneMinute.push({
        symbol: YAHOO_SYMBOL,
        source: "yahoo",
        instrumentKind: "futures_proxy",
        timeframe: "1m",
        startMs,
        endMs: startMs + 60_000,
        open,
        high,
        low,
        close,
        volume,
        tickCount: 1,
        complete: startMs + 60_000 <= Date.now(),
        qualityScore: 75
      });
    }

    if (oneMinute.length > 0) {
      const last = oneMinute[oneMinute.length - 1];
      this.updateHealth(true, last.endMs, 0, undefined, 75);
    }

    if (timeframe === "1m") return oneMinute.slice(-count);
    if (timeframe === "5m" || timeframe === "15m" || timeframe === "1h") {
      return aggregateCandles(oneMinute, timeframe).slice(-count);
    }
    return [];
  }

  async fetchQuote(): Promise<GoldQuote> {
    this.logger.debug("Fetching gold quote from Yahoo Finance (GC=F)");
    const raw = await this.fetchChart();
    const result = raw.chart.result?.[0];
    if (!result) {
      throw new Error("Yahoo Finance returned empty result");
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const change = price - previousClose;
    const changePct = previousClose > 0 ? (change / previousClose) * 100 : 0;

    let open = previousClose;
    let high = meta.regularMarketDayHigh ?? price;
    let low = meta.regularMarketDayLow ?? price;

    const quotes = result.indicators?.quote?.[0];
    if (quotes) {
      const validOpens = quotes.open.filter(validNumber);
      const validHighs = quotes.high.filter(validNumber);
      const validLows = quotes.low.filter(validNumber);

      if (validOpens.length > 0) open = validOpens[0];
      if (validHighs.length > 0) high = Math.max(...validHighs);
      if (validLows.length > 0) low = Math.min(...validLows);
    }

    const quote: GoldQuote = {
      price,
      open,
      high,
      low,
      previousClose,
      change,
      changePct,
      timestamp: meta.regularMarketTime,
      symbol: YAHOO_SYMBOL,
      source: "yahoo",
      instrumentKind: "futures_proxy"
    };
    this.lastQuote = quote;
    this.updateHealth(true, quote.timestamp * 1000, 0, undefined, 75);
    return quote;
  }

  async seedBuffer(buffer: PriceBuffer): Promise<number> {
    this.logger.debug("Seeding price buffer from Yahoo Finance 1min candles");
    const candles = await this.fetchRecentCandles(YAHOO_SYMBOL, "1m", 512);
    let seeded = 0;
    for (const candle of candles) {
      buffer.push({ price: candle.close, timestamp: candle.endMs });
      seeded++;
    }

    this.logger.info("Buffer seeded", { seeded, total: buffer.length });
    return seeded;
  }

  getLastQuote(): GoldQuote | null {
    return this.lastQuote;
  }

  private async fetchChart(): Promise<YahooChartResponse> {
    const start = Date.now();
    try {
      const raw = await getJson<YahooChartResponse>(YAHOO_CHART_URL, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; xau-state-discord/0.1.0)"
        },
        timeoutMs: this.config.requestTimeoutMs,
        maxAttempts: this.config.requestMaxAttempts,
        retryBaseDelayMs: this.config.requestRetryBaseMs
      });

      if (raw.chart.error) {
        throw new Error(
          `Yahoo Finance error: ${raw.chart.error.code} - ${raw.chart.error.description}`
        );
      }

      this.health = { ...this.health, latencyMs: Date.now() - start };
      return raw;
    } catch (error) {
      this.updateHealth(false, 0, Date.now() - start, (error as Error).message, 0);
      throw error;
    }
  }

  private updateHealth(
    ok: boolean,
    lastUpdateMs: number,
    latencyMs: number,
    error: string | undefined,
    qualityScore: number
  ): void {
    const ageMs = lastUpdateMs > 0 ? Date.now() - lastUpdateMs : Number.POSITIVE_INFINITY;
    const stale = lastUpdateMs <= 0 || ageMs > this.config.maxCandleAgeMs;
    this.health = {
      source: "yahoo",
      ok: ok && !stale,
      lastUpdateMs,
      ageMs,
      latencyMs,
      stale,
      error,
      qualityScore: stale ? Math.min(qualityScore, 40) : qualityScore
    };
  }
}

export class GoldPriceClient {
  private readonly provider: YahooGoldProvider;

  constructor(config: RuntimeConfig, logger: Logger) {
    this.provider = new YahooGoldProvider(config, logger);
  }

  fetchQuote(): Promise<GoldQuote> {
    return this.provider.fetchQuote();
  }

  seedBuffer(buffer: PriceBuffer): Promise<number> {
    return this.provider.seedBuffer(buffer);
  }

  getProvider(): YahooGoldProvider {
    return this.provider;
  }
}
