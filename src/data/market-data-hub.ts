import { Logger } from "../lib/logger.js";
import { RuntimeConfig } from "../types.js";
import { aggregateCandles } from "./bar-builder.js";
import { YahooGoldProvider } from "./client.js";
import { RithmicFileProvider } from "./providers/rithmic-file-provider.js";
import { PepperstoneFileProvider } from "./providers/pepperstone-file-provider.js";
import { Candle, DataSnapshot, FuturesFlowStatus, MarketTick, SourceHealth } from "./types.js";

interface ProviderResult {
  tick: MarketTick | null;
  candles: Candle[];
  health: SourceHealth;
}

type PrimaryKind = "rithmic" | "yahoo" | "broker";

function emptyResult(health: SourceHealth): ProviderResult {
  return { tick: null, candles: [], health };
}

function latestComplete(candles: Candle[]): Candle | null {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].complete) return candles[i];
  }
  return candles[candles.length - 1] ?? null;
}

function completeRatio(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const total = candles.reduce((sum, candle) => sum + (candle.completenessRatio ?? (candle.complete ? 1 : 0)), 0);
  return Math.round((total / candles.length) * 100) / 100;
}

function candleFromTick(tick: MarketTick, qualityScore: number): Candle {
  const startMs = Math.floor(tick.timestampMs / 60_000) * 60_000;
  return {
    symbol: tick.symbol,
    source: tick.source,
    instrumentKind: tick.instrumentKind,
    timeframe: "1m",
    startMs,
    endMs: startMs + 60_000,
    open: tick.mid,
    high: tick.mid,
    low: tick.mid,
    close: tick.mid,
    volume: tick.volume,
    tickCount: 1,
    complete: false,
    qualityScore,
    completenessRatio: 1
  };
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
      this.config.enableYahooFallback ? this.fetchYahoo().catch((error) => {
        this.logger.warn("Yahoo GC=F reference unavailable", {
          error: error instanceof Error ? error.message : String(error)
        });
        return emptyResult(this.yahoo.getHealth());
      }) : Promise.resolve(emptyResult(this.yahoo.getHealth())),
      this.fetchBroker()
    ]);

    const selected = this.selectPrimary(rithmic, yahoo, broker);
    if (!selected.tick && selected.candles.length === 0) {
      throw new Error("No usable analysis data source is available");
    }

    const selectedCandles = selected.candles.length > 0
      ? selected.candles
      : selected.tick
        ? [candleFromTick(selected.tick, selected.health.qualityScore)]
        : [];
    const m1 = selectedCandles.slice(-240);
    const m5 = aggregateCandles(m1, "5m").slice(-120);
    const m15 = aggregateCandles(m1, "15m").slice(-96);
    const h1 = aggregateCandles(m1, "1h").slice(-72);
    const primaryCandle = latestComplete(m1);
    const primaryTick = selected.tick;
    const price = primaryTick?.mid ?? primaryCandle?.close;
    const timestampMs = primaryTick?.timestampMs ?? primaryCandle?.endMs ?? Date.now();
    if (price === undefined) {
      throw new Error("Selected analysis source has no price");
    }

    const gcTick = selected.kind === "broker" ? (rithmic.tick ?? yahoo.tick) : selected.tick;
    const gcCandles = selected.kind === "broker"
      ? (rithmic.candles.length > 0 ? rithmic.candles : yahoo.candles)
      : m1;
    const gcCandle = latestComplete(gcCandles);
    const brokerTick = selected.kind === "broker"
      ? primaryTick
      : broker.tick && broker.health.qualityScore >= this.config.minSourceQuality
      ? broker.tick
      : null;
    const basisReferencePrice = gcTick?.mid ?? gcCandle?.close;
    const basis =
      this.config.enableBrokerBasis && brokerTick && basisReferencePrice !== undefined
        ? {
            available: true,
            futuresMinusBroker: basisReferencePrice - brokerTick.mid,
            brokerSpread:
              brokerTick.ask !== undefined && brokerTick.bid !== undefined
                ? brokerTick.ask - brokerTick.bid
                : undefined
          }
        : { available: false };

    const quote = selected.kind === "yahoo" || (selected.kind === "broker" && yahoo.tick)
      ? this.yahoo.getLastQuote()
      : null;
    const sourceHealth = [rithmic.health, yahoo.health, broker.health];
    const activePrimaryHealth = selected.health;
    const brokerHealth = broker.health;
    const futuresFlowStatus = this.futuresFlowStatus(selected.kind, rithmic, yahoo);

    return {
      asOfMs: timestampMs,
      primary: {
        symbol: primaryTick?.symbol ?? primaryCandle?.symbol ?? (selected.kind === "broker" ? "XAUUSD" : "GC"),
        source: selected.health.source,
        instrumentKind: primaryTick?.instrumentKind ?? primaryCandle?.instrumentKind ?? (selected.kind === "broker" ? "broker_spot" : "futures"),
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
      activePrimaryHealth,
      brokerHealth,
      optionalSourceHealth: sourceHealth.filter(
        (health) => health.source !== activePrimaryHealth.source && (selected.kind === "broker" || health.source !== "pepperstone")
      ),
      sourceHealth,
      futuresFlowStatus,
      qualityPolicy: {
        minSourceQuality: this.config.minSourceQuality,
        maxBrokerSpread: this.config.maxBrokerSpread
      },
      bars: { m1, m5, m15, h1 },
      barCoverage: {
        m1: m1.length,
        m5: m5.length,
        m15: m15.length,
        h1: h1.length,
        m1CompleteRatio: completeRatio(m1),
        m5CompleteRatio: completeRatio(m5),
        m15CompleteRatio: completeRatio(m15),
        h1CompleteRatio: completeRatio(h1)
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
    const [tick, candles] = await Promise.all([
      this.pepperstone.fetchLatestTick?.() ?? Promise.resolve(null),
      this.pepperstone.fetchRecentCandles?.("XAUUSD", "1m", 240) ?? Promise.resolve([])
    ]);
    return { tick, candles, health: this.pepperstone.getHealth() };
  }

  private selectPrimary(
    rithmic: ProviderResult,
    yahoo: ProviderResult,
    broker: ProviderResult
  ): ProviderResult & { kind: PrimaryKind } {
    const brokerHasFreshRows =
      !broker.health.stale &&
      (broker.tick !== null || broker.candles.length > 0);
    const brokerUsable =
      brokerHasFreshRows &&
      (
        broker.health.qualityScore >= this.config.minSourceQuality ||
        broker.health.testData === true ||
        broker.health.warning === "broker spread wide"
      );
    const yahooUsable =
      this.config.enableYahooFallback &&
      (yahoo.tick !== null || yahoo.candles.length > 0);

    if (this.config.dataPrimary === "broker") {
      if (brokerUsable) {
        return { ...broker, kind: "broker" };
      }
      if (yahooUsable) {
        this.logger.warn("Broker primary unavailable; using Yahoo GC=F fallback for analysis", {
          broker: broker.health.error
        });
        return { ...yahoo, kind: "yahoo" };
      }
      throw new Error("Broker primary selected but Pepperstone quote unavailable/stale.");
    }

    const rithmicUsable =
      this.config.dataPrimary !== "yahoo" &&
      rithmic.health.qualityScore >= this.config.minSourceQuality &&
      (rithmic.tick !== null || rithmic.candles.length > 0);

    if (rithmicUsable) {
      return { ...rithmic, kind: "rithmic" };
    }

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

  private futuresFlowStatus(
    selectedKind: PrimaryKind,
    rithmic: ProviderResult,
    yahoo: ProviderResult
  ): FuturesFlowStatus {
    const rithmicUsable =
      rithmic.health.qualityScore >= this.config.minSourceQuality &&
      (rithmic.tick !== null || rithmic.candles.length > 0);
    const yahooUsable = yahoo.tick !== null || yahoo.candles.length > 0;

    if (selectedKind === "rithmic" && rithmicUsable) return "confirmed";
    if (selectedKind === "yahoo" && yahooUsable) return "proxy-only";
    if (selectedKind === "broker" && rithmicUsable) return "confirmed";
    return "unknown";
  }
}
