import { PriceLevel, PriceZone } from "../levels/grid.js";
import { HeadAndShouldersPattern } from "./patterns.js";

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
  symbol: string;           // "XAUUSD"
  price: number;            // Current spot price
  dailyChange: number;
  dailyChangePct: number;
  previousClose: number;

  // --- Classical Indicators ---
  ema8: number | null;
  ema21: number | null;
  ema55: number | null;
  rsi14: number | null;
  atr: number | null;       // Pseudo-ATR from price changes
  zScore: number | null;    // Z-score (20-period)
  hurst: number | null;     // Hurst exponent (0–1)

  // --- Advanced Indicators (returns-based) ---
  realizedVol: number | null;        // 1-min return stddev × √60 (hourly scale)
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
  pattern: HeadAndShouldersPattern | null;

  // --- Level Analysis ---
  nearestResistance: PriceLevel | null;
  nearestSupport: PriceLevel | null;
  currentZone: PriceZone | null;
  magnetLevel: PriceLevel | null;

  // --- Targets ---
  bullTarget: number;
  bearTarget: number;
  expectedRange: { min: number; max: number };
  expectedMove: number;      // Vol-scaled 1-hour expected move ($)

  // --- Probability ---
  breakoutProbUp: number;    // 0–1
  breakoutProbDown: number;  // 0–1

  // --- Risk/Reward ---
  rrLong: number;
  rrShort: number;

  // --- Confidence ---
  confidence: number;        // 0–100 (evidence-based)

  // --- Level Grid Summary ---
  resistanceLevels: number[];
  supportLevels: number[];

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
