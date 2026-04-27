import { Logger } from "../lib/logger.js";
import { RuntimeConfig } from "../types.js";
import { aggregateCandles } from "./bar-builder.js";
import { YahooGoldProvider } from "./client.js";
import { RithmicFileProvider } from "./providers/rithmic-file-provider.js";
import { PepperstoneFileProvider } from "./providers/pepperstone-file-provider.js";
import { Candle, DataSnapshot, MarketTick, SourceHealth } from "./types.js";

interface ProviderResult {
  tick: MarketTick | null;
  candles: Candle[];
  health: SourceHealth;
}

function emptyResult(health: SourceHealth): ProviderResult {
  return { tick: null, candles: [], health };
}

function latestComplete(candles: Candle[]): Candle | null {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].complete) return candles[i];
  }
  return candles[candles.length - 1] ?? null;
}

export class MarketDataHub {
  private readonly yahoo: YahooGoldProvider;
  private readonly rithmic: RithmicFileProvider;
  private readonly pepperstone: PepperstoneFileProvider;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger
  ) {
    this.yahoo = new YahooGoldProvider(config, logger);
    this.rithmic = new RithmicFileProvider(config);
    this.pepperstone = new PepperstoneFileProvider(config);
  }

  async fetchSnapshot(): Promise<DataSnapshot> {
    const [rithmic, yahoo, broker] = await Promise.all([
      this.fetchRithmic(),
      this.config.enableYahooFallback ? this.fetchYahoo() : Promise.resolve(emptyResult(this.yahoo.getHealth())),
      this.fetchBroker()
    ]);

    const selected = this.selectPrimary(rithmic, yahoo);
    if (!selected.tick && selected.candles.length === 0) {
      throw new Error("No usable GC analysis data source is available");
    }

    const m1 = selected.candles.slice(-240);
    const m5 = aggregateCandles(m1, "5m").slice(-120);
    const m15 = aggregateCandles(m1, "15m").slice(-96);
    const h1 = aggregateCandles(m1, "1h").slice(-72);
    const gcCandle = latestComplete(m1);
    const gcTick = selected.tick;
    const price = gcTick?.mid ?? gcCandle?.close;
    const timestampMs = gcTick?.timestampMs ?? gcCandle?.endMs ?? Date.now();
    if (price === undefined) {
      throw new Error("Selected analysis source has no price");
    }

    const brokerTick = broker.tick && broker.health.qualityScore >= this.config.minSourceQuality
      ? broker.tick
      : null;
    const basis =
      this.config.enableBrokerBasis && brokerTick
        ? {
            available: true,
            futuresMinusBroker: price - brokerTick.mid,
            brokerSpread:
              brokerTick.ask !== undefined && brokerTick.bid !== undefined
                ? brokerTick.ask - brokerTick.bid
                : undefined
          }
        : { available: false };

    const quote = selected.kind === "yahoo" ? this.yahoo.getLastQuote() : null;

    return {
      asOfMs: timestampMs,
      primary: {
        symbol: gcTick?.symbol ?? gcCandle?.symbol ?? "GC",
        source: selected.health.source,
        instrumentKind: gcTick?.instrumentKind ?? gcCandle?.instrumentKind ?? "futures",
        timestampMs,
        price,
        previousClose: quote?.previousClose,
        dailyChange: quote?.change,
        dailyChangePct: quote?.changePct,
        fallback: selected.kind === "yahoo"
      },
      gcTick,
      gcCandle,
      xauBrokerTick: brokerTick,
      basis,
      sourceHealth: [rithmic.health, yahoo.health, broker.health],
      bars: { m1, m5, m15, h1 },
      barCoverage: {
        m1: m1.length,
        m5: m5.length,
        m15: m15.length,
        h1: h1.length
      }
    };
  }

  getSourceHealth(): SourceHealth[] {
    return [this.rithmic.getHealth(), this.yahoo.getHealth(), this.pepperstone.getHealth()];
  }

  private async fetchRithmic(): Promise<ProviderResult> {
    if (this.config.dataPrimary === "yahoo") return emptyResult(this.rithmic.getHealth());
    const [tick, candles] = await Promise.all([
      this.rithmic.fetchLatestTick?.() ?? Promise.resolve(null),
      this.rithmic.fetchRecentCandles?.("GC", "1m", 240) ?? Promise.resolve([])
    ]);
    return { tick, candles, health: this.rithmic.getHealth() };
  }

  private async fetchYahoo(): Promise<ProviderResult> {
    if (this.config.dataPrimary === "rithmic" && !this.config.enableYahooFallback) {
      return emptyResult(this.yahoo.getHealth());
    }
    const [tick, candles] = await Promise.all([
      this.yahoo.fetchLatestTick(),
      this.yahoo.fetchRecentCandles("GC=F", "1m", 240)
    ]);
    return { tick, candles, health: this.yahoo.getHealth() };
  }

  private async fetchBroker(): Promise<ProviderResult> {
    const tick = (await this.pepperstone.fetchLatestTick?.()) ?? null;
    return { tick, candles: [], health: this.pepperstone.getHealth() };
  }

  private selectPrimary(
    rithmic: ProviderResult,
    yahoo: ProviderResult
  ): ProviderResult & { kind: "rithmic" | "yahoo" } {
    const rithmicUsable =
      this.config.dataPrimary !== "yahoo" &&
      rithmic.health.qualityScore >= this.config.minSourceQuality &&
      (rithmic.tick !== null || rithmic.candles.length > 0);

    if (rithmicUsable) {
      return { ...rithmic, kind: "rithmic" };
    }

    const yahooUsable =
      this.config.enableYahooFallback &&
      (yahoo.tick !== null || yahoo.candles.length > 0);

    if (yahooUsable) {
      if (rithmic.health.error) {
        this.logger.warn("Using Yahoo GC=F fallback for analysis", {
          rithmic: rithmic.health.error
        });
      }
      return { ...yahoo, kind: "yahoo" };
    }

    return { ...rithmic, kind: "rithmic" };
  }
}
