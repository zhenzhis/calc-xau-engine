import { PriceLevel, PriceZone } from "../levels/grid.js";
import { HeadAndShouldersPattern } from "./patterns.js";
import { BarCoverage, BrokerBasis, DataSnapshot, SourceHealth } from "../data/types.js";

// ---------------------------------------------------------------------------
// Market regime classification
// ---------------------------------------------------------------------------

export type MarketRegime =
  | "trending-up"
  | "trending-down"
  | "ranging"
  | "volatile"
  | "consolidation";

export type TrendDirection = "bullish" | "bearish" | "neutral";
export type MomentumState = "accelerating" | "steady" | "decaying";
export type VolatilityRegime = "low" | "normal" | "high" | "extreme";

// ---------------------------------------------------------------------------
// Multi-Timeframe Summary
// ---------------------------------------------------------------------------

export interface TimeframeSummary {
  trend: TrendDirection;
  rsi: number | null;
  emaAligned: boolean;      // fast > mid (bullish) or fast < mid (bearish)
  momentum: number;         // normalized momentum (sigma units)
}

// ---------------------------------------------------------------------------
// Actionable Trading Signal
// ---------------------------------------------------------------------------

export interface TradingSignal {
  direction: "LONG" | "SHORT" | "FLAT";
  strength: number;         // 0–100 signal strength
  entry: number;            // suggested entry price
  stopLoss: number;         // suggested stop-loss
  targets: number[];        // T1, T2 target prices
  riskReward: number;       // R:R ratio to T1
}

// ---------------------------------------------------------------------------
// Analysis result — full quantitative snapshot
// ---------------------------------------------------------------------------

export interface GoldAnalysis {
  asOf: number;             // Unix timestamp (seconds)
  symbol: string;           // analysis instrument, e.g. GC=F fallback or GC futures
  price: number;            // Current spot price
  dailyChange: number;
  dailyChangePct: number;
  previousClose: number;

  // --- Classical Indicators ---
  ema8: number | null;
  ema21: number | null;
  ema55: number | null;
  rsi14: number | null;
  atr: number | null;       // True-range ATR from canonical OHLC candles
  zScore: number | null;    // Z-score (20-period)
  hurst: number | null;     // Hurst exponent (0–1)

  // --- Advanced Indicators (returns-based) ---
  realizedVol: number | null;        // Continuous 1-min return stddev × √60 (hourly scale)
  varianceRatio: number | null;      // VR(5) — >1 trending, <1 mean-reverting
  autocorrelation: number | null;    // Lag-1 ACF of returns
  kamaPrice: number | null;          // Kaufman Adaptive Moving Average
  normalizedMomentum: number | null; // ROC / vol (sigma units, vol-adjusted)
  bbWidth: number | null;            // Bollinger bandwidth (squeeze detection)
  bbPercentB: number | null;         // %B position within bands

  // --- Regime & Trend ---
  regime: MarketRegime;
  trend: TrendDirection;
  momentum: MomentumState;
  volRegime: VolatilityRegime;

  // --- Multi-Timeframe Analysis ---
  tf: {
    m5: TimeframeSummary;
    m15: TimeframeSummary;
    confluence: number;       // -1 to 1 (weighted alignment across TFs)
  };

  // --- Actionable Signal ---
  signal: TradingSignal;

  // --- Pattern Detection ---
  patternWatch: HeadAndShouldersPattern | null;
  patternImpact: "watch-only" | null;

  // --- Level Analysis ---
  nearestResistance: PriceLevel | null;
  nearestSupport: PriceLevel | null;
  currentZone: PriceZone | null;
  magnetLevel: PriceLevel | null;

  // --- Targets ---
  bullTarget: number;
  bearTarget: number;
  expectedRange: { min: number; max: number };
  expectedMove: number | null;      // Vol-scaled 1-hour expected move from continuous 1m bars

  // --- Directional pressure scores ---
  breakoutScoreUp: number;    // 0–1 uncalibrated directional pressure score, not a probability
  breakoutScoreDown: number;  // 0–1 uncalibrated directional pressure score, not a probability

  // --- Risk/Reward ---
  rrLong: number;
  rrShort: number;

  // --- Confidence ---
  confidence: number;        // evidenceConfidence 0–100, not win rate

  // --- Level Grid Summary ---
  resistanceLevels: number[];
  supportLevels: number[];
  levelStates: Array<{
    price: number;
    label: string;
    status: "fresh" | "stale" | "invalidated";
    touchCount: number;
    lastTouchedAt?: string;
  }>;

  // --- Drivers (diagnostic — all factor scores for transparency) ---
  drivers: {
    emaCrossScore: number;       // EMA alignment signal
    momentumScore: number;       // Normalized momentum composite
    levelProximityScore: number; // Proximity to key levels
    volatilityScore: number;     // Normalized volatility
    zoneInfluence: number;       // Zone attraction/repulsion
    hurstBias: number;           // Trend persistence signal
    vrBias: number;              // Variance ratio bias
    tfConfluence: number;        // Multi-timeframe agreement
  };

  // --- Buffer stats ---
  bufferSize: number;
  bufferDurationMin: number;

  // --- Data provenance ---
  data: {
    snapshot: DataSnapshot;
    sourceHealth: SourceHealth[];
    basis: BrokerBasis;
    barCoverage: BarCoverage;
  };
}

// ---------------------------------------------------------------------------
// Publish state — minimal subset persisted between publishes
// ---------------------------------------------------------------------------

export interface GoldPublishState {
  asOf: number;
  publishedAtMs?: number;
  price: number;
  trend: TrendDirection;
  momentum: MomentumState;
  regime: MarketRegime;
  volRegime?: VolatilityRegime;
  confidence: number;
  bullTarget: number;
  bearTarget: number;
  nearestResistance?: number;
  nearestSupport?: number;
  patternSignature?: string;  // e.g., "HS-bear-15m-confirmed" or undefined
}
