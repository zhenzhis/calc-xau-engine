import { Logger } from "../lib/logger.js";
import { RuntimeConfig } from "../types.js";
import { getJson } from "../lib/http.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldQuote {
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  change: number;
  changePct: number;
  timestamp: number;
}

export interface PricePoint {
  price: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Yahoo Finance chart response (GC=F gold futures)
// ---------------------------------------------------------------------------

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
          open: number[];
          high: number[];
          low: number[];
          close: number[];
        }>;
      };
    }>;
    error: null | { code: string; description: string };
  };
}

// ---------------------------------------------------------------------------
// Price Buffer — rolling window of recent prices for technical analysis
// ---------------------------------------------------------------------------

const MAX_BUFFER_SIZE = 512;

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
    // Deduplicate: skip if same timestamp as last point
    if (this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      if (last.timestamp === point.timestamp) return;
    }

    this.points.push(point);

    // Trim to max size
    if (this.points.length > MAX_BUFFER_SIZE) {
      this.points = this.points.slice(-MAX_BUFFER_SIZE);
    }
  }

  /** Prices from the most recent `count` data points. */
  recent(count: number): number[] {
    return this.points.slice(-count).map((p) => p.price);
  }

  /** Duration of the buffer in milliseconds. */
  durationMs(): number {
    if (this.points.length < 2) return 0;
    return this.points[this.points.length - 1].timestamp - this.points[0].timestamp;
  }

  /** Persist buffer to disk for warm restart. */
  async persist(): Promise<void> {
    await mkdir(dirname(this.persistPath), { recursive: true });
    const data = this.points.slice(-200);
    await writeFile(this.persistPath, JSON.stringify(data), "utf8");
  }

  /** Restore buffer from disk. */
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

// ---------------------------------------------------------------------------
// Gold Price Client — Yahoo Finance (GC=F, free, no API key)
// ---------------------------------------------------------------------------

const YAHOO_CHART_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d";

export class GoldPriceClient {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Fetch current XAUUSD (gold futures proxy) quote from Yahoo Finance.
   * Uses GC=F (COMEX gold futures), the most liquid gold benchmark.
   * Free, no API key required.
   */
  async fetchQuote(): Promise<GoldQuote> {
    this.logger.debug("Fetching gold quote from Yahoo Finance (GC=F)");

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

    const result = raw.chart.result?.[0];
    if (!result) {
      throw new Error("Yahoo Finance returned empty result");
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const change = price - previousClose;
    const changePct = previousClose > 0 ? (change / previousClose) * 100 : 0;

    // Extract intraday high/low/open from candle data if available
    let open = previousClose;
    let high = meta.regularMarketDayHigh ?? price;
    let low = meta.regularMarketDayLow ?? price;

    const quotes = result.indicators?.quote?.[0];
    if (quotes) {
      const validOpens = quotes.open.filter((v) => v != null && Number.isFinite(v));
      const validHighs = quotes.high.filter((v) => v != null && Number.isFinite(v));
      const validLows = quotes.low.filter((v) => v != null && Number.isFinite(v));

      if (validOpens.length > 0) open = validOpens[0];
      if (validHighs.length > 0) high = Math.max(...validHighs);
      if (validLows.length > 0) low = Math.min(...validLows);
    }

    return {
      price,
      open,
      high,
      low,
      previousClose,
      change,
      changePct,
      timestamp: meta.regularMarketTime
    };
  }

  /**
   * Seed the price buffer with recent intraday candle closes.
   * Call once at startup to warm up the technical indicator calculations.
   */
  async seedBuffer(buffer: PriceBuffer): Promise<number> {
    this.logger.debug("Seeding price buffer from Yahoo Finance 1min candles");

    const raw = await getJson<YahooChartResponse>(YAHOO_CHART_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; xau-state-discord/0.1.0)"
      },
      timeoutMs: this.config.requestTimeoutMs,
      maxAttempts: this.config.requestMaxAttempts,
      retryBaseDelayMs: this.config.requestRetryBaseMs
    });

    const result = raw.chart.result?.[0];
    if (!result?.timestamp || !result.indicators?.quote?.[0]) {
      return 0;
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    let seeded = 0;

    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close != null && Number.isFinite(close)) {
        buffer.push({ price: close, timestamp: timestamps[i] * 1000 });
        seeded++;
      }
    }

    this.logger.info("Buffer seeded", { seeded, total: buffer.length });
    return seeded;
  }
}
