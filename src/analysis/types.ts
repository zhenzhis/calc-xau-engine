import { PriceLevel, PriceZone } from "../levels/grid.js";

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

// ---------------------------------------------------------------------------
// Analysis result — full quantitative snapshot
// ---------------------------------------------------------------------------

export interface GoldAnalysis {
  asOf: number;         // Unix timestamp (seconds)
  symbol: string;       // "XAUUSD"
  price: number;        // Current spot price
  dailyChange: number;
  dailyChangePct: number;
  previousClose: number;

  // --- Technical Indicators ---
  ema8: number | null;
  ema21: number | null;
  ema55: number | null;
  rsi14: number | null;
  atr: number | null;        // Pseudo-ATR from price changes
  zScore: number | null;     // Z-score (20-period)
  hurst: number | null;      // Hurst exponent (0-1)

  // --- Regime & Trend ---
  regime: MarketRegime;
  trend: TrendDirection;
  momentum: MomentumState;

  // --- Level Analysis ---
  nearestResistance: PriceLevel | null;
  nearestSupport: PriceLevel | null;
  currentZone: PriceZone | null;
  magnetLevel: PriceLevel | null;

  // --- Targets ---
  bullTarget: number;
  bearTarget: number;
  expectedRange: { min: number; max: number };

  // --- Probability ---
  breakoutProbUp: number;    // 0-1
  breakoutProbDown: number;  // 0-1

  // --- Risk/Reward ---
  rrLong: number;   // Risk:Reward ratio for long
  rrShort: number;  // Risk:Reward ratio for short

  // --- Confidence ---
  confidence: number; // 0-100

  // --- Level Grid Summary ---
  resistanceLevels: number[];
  supportLevels: number[];

  // --- Drivers (diagnostic) ---
  drivers: {
    emaCrossScore: number;      // EMA alignment signal
    momentumScore: number;      // Rate-of-change composite
    levelProximityScore: number; // How close to key levels
    volatilityScore: number;    // Normalized volatility
    zoneInfluence: number;      // Zone attraction/repulsion
    hurstBias: number;          // Trend persistence signal
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
  confidence: number;
  bullTarget: number;
  bearTarget: number;
  nearestResistance?: number;
  nearestSupport?: number;
}
