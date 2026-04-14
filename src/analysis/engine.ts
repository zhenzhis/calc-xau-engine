import { GoldQuote, PriceBuffer } from "../data/client.js";
import {
  PriceLevel,
  LEVELS,
  ZONES,
  resistancesAbove,
  supportsBelow,
  activeZone,
  strongestMagnet,
  proximityWeight,
  gridPosition,
  distanceToNearestZone
} from "../levels/grid.js";
import {
  clamp,
  roundTo,
  ema,
  sma,
  stddev,
  pseudoAtr,
  rsi,
  roc,
  zScore,
  hurstExponent,
  sigmoid,
  normalCdf
} from "../lib/math.js";
import {
  GoldAnalysis,
  MarketRegime,
  TrendDirection,
  MomentumState
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_BUFFER_FOR_INDICATORS = 15;
const EMA_FAST = 8;
const EMA_MID = 21;
const EMA_SLOW = 55;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const ZSCORE_PERIOD = 20;
const HURST_MIN_POINTS = 20;

// ---------------------------------------------------------------------------
// Category weight map — higher = stronger influence on targets & breakout
// ---------------------------------------------------------------------------

const CATEGORY_WEIGHT: Record<PriceLevel["category"], number> = {
  "extreme":     1.00,
  "zone-edge":   0.90,
  "key-support": 0.85,
  "deep":        0.85,
  "transition":  0.70,
  "pivot":       0.55,
  "indicator":   0.50,
};

// ---------------------------------------------------------------------------
// Regime Detection
// ---------------------------------------------------------------------------

function detectRegime(
  prices: number[],
  atrVal: number | null,
  rsiVal: number | null,
  emaFast: number | null,
  emaMid: number | null,
  emaSlow: number | null,
  hurst: number | null
): MarketRegime {
  // Volatility assessment
  const sd = stddev(prices, Math.min(20, prices.length));
  const meanPrice = sma(prices, Math.min(20, prices.length));
  const normalizedVol = sd !== null && meanPrice !== null && meanPrice > 0
    ? sd / meanPrice
    : 0;

  // High volatility regime
  if (normalizedVol > 0.008) return "volatile";

  // EMA alignment for trend detection
  if (emaFast !== null && emaMid !== null && emaSlow !== null) {
    const allAlignedUp = emaFast > emaMid && emaMid > emaSlow;
    const allAlignedDown = emaFast < emaMid && emaMid < emaSlow;

    // Strong trend: EMAs aligned AND hurst suggests persistence
    if (allAlignedUp && (hurst === null || hurst > 0.5)) return "trending-up";
    if (allAlignedDown && (hurst === null || hurst > 0.5)) return "trending-down";
  }

  // Consolidation: low volatility + RSI near 50
  if (normalizedVol < 0.002 && rsiVal !== null && rsiVal > 40 && rsiVal < 60) {
    return "consolidation";
  }

  return "ranging";
}

// ---------------------------------------------------------------------------
// Trend Detection — multi-factor scoring
// ---------------------------------------------------------------------------

function detectTrend(
  prices: number[],
  emaFast: number | null,
  emaMid: number | null,
  emaSlow: number | null,
  rsiVal: number | null,
  zScoreVal: number | null
): { trend: TrendDirection; emaCrossScore: number } {
  const price = prices[prices.length - 1];
  let score = 0;

  // Factor 1: EMA alignment (weight 0.35)
  if (emaFast !== null && emaMid !== null) {
    const emaDiff = (emaFast - emaMid) / Math.max(Math.abs(emaMid) * 0.001, 1);
    score += clamp(emaDiff, -1, 1) * 0.35;
  }

  // Factor 2: Price vs slow EMA (weight 0.25)
  if (emaSlow !== null) {
    const distFromSlow = (price - emaSlow) / Math.max(Math.abs(emaSlow) * 0.003, 1);
    score += clamp(distFromSlow, -1, 1) * 0.25;
  }

  // Factor 3: RSI directional bias (weight 0.20)
  if (rsiVal !== null) {
    const rsiBias = (rsiVal - 50) / 50; // -1 to +1
    score += rsiBias * 0.20;
  }

  // Factor 4: Z-score (weight 0.20)
  if (zScoreVal !== null) {
    score += clamp(zScoreVal / 2, -1, 1) * 0.20;
  }

  const emaCrossScore = score;

  if (score > 0.12) return { trend: "bullish", emaCrossScore };
  if (score < -0.12) return { trend: "bearish", emaCrossScore };
  return { trend: "neutral", emaCrossScore };
}

// ---------------------------------------------------------------------------
// Momentum Detection
// ---------------------------------------------------------------------------

function detectMomentum(
  prices: number[]
): { momentum: MomentumState; momentumScore: number } {
  if (prices.length < 10) {
    return { momentum: "steady", momentumScore: 0 };
  }

  // Multi-timeframe rate of change
  const rocShort = roc(prices, 3) ?? 0;   // ~3 min at 60s poll
  const rocMid = roc(prices, 8) ?? 0;     // ~8 min
  const rocLong = roc(prices, 20) ?? 0;   // ~20 min

  // Composite momentum (recent changes weighted more)
  const composite = Math.abs(rocShort) * 0.5 + Math.abs(rocMid) * 0.3 + Math.abs(rocLong) * 0.2;

  // Acceleration: is momentum increasing or decreasing?
  const acceleration = Math.abs(rocShort) - Math.abs(rocMid);

  const momentumScore = composite * 1000; // Scale to more readable range

  if (acceleration > 0.0002 && composite > 0.0005) return { momentum: "accelerating", momentumScore };
  if (composite < 0.0002) return { momentum: "decaying", momentumScore };
  return { momentum: "steady", momentumScore };
}

// ---------------------------------------------------------------------------
// Level Proximity Analysis — uses gridPosition + distanceToNearestZone
// ---------------------------------------------------------------------------

function analyzeLevelProximity(price: number): {
  levelProximityScore: number;
  zoneInfluence: number;
} {
  // Aggregate proximity to all levels (higher = closer to key levels)
  const sigma = 10; // Gold points
  let maxProximity = 0;

  for (const level of LEVELS) {
    // Weight proximity by both strength and category importance
    const catWeight = CATEGORY_WEIGHT[level.category];
    const prox = proximityWeight(price, level.price, sigma) * level.strength * catWeight;
    maxProximity = Math.max(maxProximity, prox);
  }

  // Zone influence via distanceToNearestZone
  let zoneInfluence = 0;
  const zone = activeZone(price);

  if (zone) {
    // Price is inside a zone
    const zoneWidth = zone.max - zone.min;
    const positionInZone = (price - zone.min) / zoneWidth; // 0 = bottom, 1 = top
    const zoneSign = zone.type === "demand" ? 1 : zone.type === "supply" ? -1 : 0;

    // Stronger effect when price is deeper into the zone
    const depth = zone.type === "demand"
      ? (1 - positionInZone) // closer to bottom = stronger demand
      : positionInZone;      // closer to top = stronger supply
    zoneInfluence = zoneSign * zone.strength * (0.5 + 0.5 * depth);
  } else {
    // Price outside all zones — use distanceToNearestZone for approach detection
    const nearest = distanceToNearestZone(price);
    if (nearest && Math.abs(nearest.distance) < 30) {
      const approachSign =
        nearest.zone.type === "demand" ? 1
        : nearest.zone.type === "supply" ? -1
        : 0;
      const approachWeight = Math.exp(-Math.abs(nearest.distance) / 10)
        * nearest.zone.strength * 0.5;
      zoneInfluence = approachSign * approachWeight;
    }
  }

  return {
    levelProximityScore: clamp(maxProximity, 0, 1),
    zoneInfluence: clamp(zoneInfluence, -1, 1)
  };
}

// ---------------------------------------------------------------------------
// Target Price Computation — category-weighted targeting
// ---------------------------------------------------------------------------

function computeTargets(
  price: number,
  trend: TrendDirection,
  atrVal: number | null,
  regime: MarketRegime
): { bullTarget: number; bearTarget: number; expectedRange: { min: number; max: number } } {
  const resistances = resistancesAbove(price, 3);
  const supports = supportsBelow(price, 3);

  // Bull target: nearest resistances weighted by proximity, strength, and category
  let bullTarget = price + 15; // default if no resistance found
  if (resistances.length > 0) {
    const weighted = resistances.map((r, i) => {
      const catWeight = CATEGORY_WEIGHT[r.category];
      return {
        price: r.price,
        weight: r.strength * catWeight * (1 / (i + 1))
      };
    });
    const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
    bullTarget = totalWeight > 0
      ? weighted.reduce((s, w) => s + w.price * w.weight, 0) / totalWeight
      : resistances[0].price;
  }

  // Bear target: nearest supports weighted by proximity, strength, and category
  let bearTarget = price - 15;
  if (supports.length > 0) {
    const weighted = supports.map((s, i) => {
      const catWeight = CATEGORY_WEIGHT[s.category];
      return {
        price: s.price,
        weight: s.strength * catWeight * (1 / (i + 1))
      };
    });
    const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
    bearTarget = totalWeight > 0
      ? weighted.reduce((s, w) => s + w.price * w.weight, 0) / totalWeight
      : supports[0].price;
  }

  // Expected range based on ATR and regime
  const baseRange = atrVal ?? 8;
  const regimeMultiplier =
    regime === "volatile" ? 2.0
    : regime === "trending-up" || regime === "trending-down" ? 1.5
    : regime === "consolidation" ? 0.6
    : 1.0;

  const halfRange = roundTo(baseRange * regimeMultiplier * 1.5, 2);

  return {
    bullTarget: roundTo(bullTarget, 2),
    bearTarget: roundTo(bearTarget, 2),
    expectedRange: {
      min: roundTo(price - halfRange, 2),
      max: roundTo(price + halfRange, 2)
    }
  };
}

// ---------------------------------------------------------------------------
// Breakout Probability — factors zone proximity and category strength
// ---------------------------------------------------------------------------

function computeBreakoutProbability(
  price: number,
  trend: TrendDirection,
  momentum: MomentumState,
  rsiVal: number | null,
  zScoreVal: number | null,
  hurst: number | null,
  zoneInfluence: number
): { up: number; down: number } {
  // Base probability from trend
  let upBias = trend === "bullish" ? 0.15 : trend === "bearish" ? -0.10 : 0;

  // Momentum contribution
  if (momentum === "accelerating") {
    upBias += trend === "bullish" ? 0.10 : trend === "bearish" ? -0.10 : 0;
  }

  // RSI contribution — extreme values increase breakout probability in that direction
  if (rsiVal !== null) {
    if (rsiVal > 70) upBias += 0.08;
    else if (rsiVal < 30) upBias -= 0.08;
  }

  // Zone influence
  upBias += zoneInfluence * 0.12;

  // Zone proximity bonus — being near a zone boundary increases breakout odds
  const nearestZoneInfo = distanceToNearestZone(price);
  if (nearestZoneInfo && nearestZoneInfo.side !== "inside") {
    const dist = Math.abs(nearestZoneInfo.distance);
    if (dist < 15) {
      // Close approach to a zone boundary — breakout more likely through that boundary
      const zoneApproachBonus = Math.exp(-dist / 8) * nearestZoneInfo.zone.strength * 0.06;
      if (nearestZoneInfo.side === "below" && nearestZoneInfo.zone.type === "supply") {
        // Approaching supply from below — upward breakout harder
        upBias -= zoneApproachBonus;
      } else if (nearestZoneInfo.side === "above" && nearestZoneInfo.zone.type === "demand") {
        // Approaching demand from above — downward breakout harder
        upBias += zoneApproachBonus;
      }
    }
  }

  // Grid position bias — extreme grid positions slightly favor mean-reversion
  const gp = gridPosition(price);
  if (gp > 0.85) upBias -= 0.04;       // near top of grid, slight downward bias
  else if (gp < 0.15) upBias += 0.04;  // near bottom of grid, slight upward bias

  // Hurst contribution — persistent trends more likely to break out
  if (hurst !== null && hurst > 0.6) {
    upBias *= 1.2;
  }

  // Find nearest resistance and support
  const nearestRes = resistancesAbove(price, 1)[0];
  const nearestSup = supportsBelow(price, 1)[0];

  // Proximity to level modulates breakout probability
  const distToRes = nearestRes ? nearestRes.price - price : 50;
  const distToSup = nearestSup ? price - nearestSup.price : 50;

  // Closer to level = higher breakout probability (in that direction)
  const resProximityFactor = sigmoid(20 - distToRes, 0.15, 0);
  const supProximityFactor = sigmoid(20 - distToSup, 0.15, 0);

  // Level strength + category weight reduce breakout probability (stronger = harder to break)
  const resCatWeight = nearestRes ? CATEGORY_WEIGHT[nearestRes.category] : 0.5;
  const supCatWeight = nearestSup ? CATEGORY_WEIGHT[nearestSup.category] : 0.5;
  const resStrength = (nearestRes?.strength ?? 0.5) * resCatWeight;
  const supStrength = (nearestSup?.strength ?? 0.5) * supCatWeight;

  const upBreakout = clamp(
    0.25 + upBias + resProximityFactor * 0.15 * (1 - resStrength),
    0.05,
    0.85
  );
  const downBreakout = clamp(
    0.25 - upBias + supProximityFactor * 0.15 * (1 - supStrength),
    0.05,
    0.85
  );

  return { up: roundTo(upBreakout, 3), down: roundTo(downBreakout, 3) };
}

// ---------------------------------------------------------------------------
// Confidence Score
// ---------------------------------------------------------------------------

function computeConfidence(
  bufferSize: number,
  regime: MarketRegime,
  trend: TrendDirection,
  momentum: MomentumState,
  rsiVal: number | null,
  hurst: number | null,
  levelProximityScore: number,
  emaCrossScore: number
): number {
  let score = 40; // Base

  // More data = higher confidence (up to +20)
  score += Math.min(20, bufferSize / 3);

  // Clear regime = higher confidence
  if (regime === "trending-up" || regime === "trending-down") score += 10;
  else if (regime === "consolidation") score += 5;
  else if (regime === "volatile") score -= 8;

  // EMA alignment clarity
  score += Math.abs(emaCrossScore) * 15;

  // Momentum clarity
  if (momentum === "accelerating") score += 5;
  else if (momentum === "decaying") score -= 3;

  // RSI not in extremes = more reliable signals
  if (rsiVal !== null) {
    if (rsiVal > 30 && rsiVal < 70) score += 5;
    else score -= 5; // Extreme RSI = lower confidence in target accuracy
  }

  // Near key level = higher confidence in level analysis
  score += levelProximityScore * 10;

  // Hurst clarity
  if (hurst !== null) {
    if (hurst > 0.6 || hurst < 0.4) score += 5; // Clear signal
  }

  return Math.round(clamp(score, 10, 95));
}

// ---------------------------------------------------------------------------
// Risk / Reward
// ---------------------------------------------------------------------------

function computeRiskReward(
  price: number,
  bullTarget: number,
  bearTarget: number
): { rrLong: number; rrShort: number } {
  const nearestSup = supportsBelow(price, 1)[0];
  const nearestRes = resistancesAbove(price, 1)[0];

  const longReward = bullTarget - price;
  const longRisk = nearestSup ? price - nearestSup.price : 10;
  const rrLong = longRisk > 0 ? roundTo(longReward / longRisk, 2) : 0;

  const shortReward = price - bearTarget;
  const shortRisk = nearestRes ? nearestRes.price - price : 10;
  const rrShort = shortRisk > 0 ? roundTo(shortReward / shortRisk, 2) : 0;

  return { rrLong: Math.max(0, rrLong), rrShort: Math.max(0, rrShort) };
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

export function analyzeGold(
  quote: GoldQuote,
  buffer: PriceBuffer
): GoldAnalysis {
  const price = quote.price;
  const prices = buffer.prices;
  const hasIndicators = prices.length >= MIN_BUFFER_FOR_INDICATORS;

  // --- Technical Indicators ---
  const emaFast = hasIndicators ? ema(prices, EMA_FAST) : null;
  const emaMid = hasIndicators ? ema(prices, EMA_MID) : null;
  const emaSlow = prices.length >= EMA_SLOW ? ema(prices, EMA_SLOW) : null;
  const rsiVal = prices.length >= RSI_PERIOD + 1 ? rsi(prices, RSI_PERIOD) : null;
  const atrVal = prices.length >= ATR_PERIOD + 1 ? pseudoAtr(prices, ATR_PERIOD) : null;
  const zScoreVal = prices.length >= ZSCORE_PERIOD ? zScore(prices, ZSCORE_PERIOD) : null;
  const hurstVal = prices.length >= HURST_MIN_POINTS
    ? hurstExponent(prices)
    : null;

  // --- Regime ---
  const regime = hasIndicators
    ? detectRegime(prices, atrVal, rsiVal, emaFast, emaMid, emaSlow, hurstVal)
    : "ranging";

  // --- Trend ---
  const { trend, emaCrossScore } = hasIndicators
    ? detectTrend(prices, emaFast, emaMid, emaSlow, rsiVal, zScoreVal)
    : { trend: "neutral" as const, emaCrossScore: 0 };

  // --- Momentum ---
  const { momentum, momentumScore } = detectMomentum(prices);

  // --- Level Analysis ---
  const { levelProximityScore, zoneInfluence } = analyzeLevelProximity(price);
  const resistances = resistancesAbove(price, 4);
  const supports = supportsBelow(price, 4);
  const nearestRes = resistances[0] ?? null;
  const nearestSup = supports[0] ?? null;
  const zone = activeZone(price);
  const magnet = strongestMagnet(price);

  // --- Volatility Score ---
  const sd20 = stddev(prices, Math.min(20, prices.length));
  const mean20 = sma(prices, Math.min(20, prices.length));
  const volatilityScore = sd20 !== null && mean20 !== null && mean20 > 0
    ? clamp(sd20 / mean20 * 200, 0, 1)
    : 0;

  // --- Hurst bias ---
  const hurstBias = hurstVal !== null ? clamp((hurstVal - 0.5) * 2, -1, 1) : 0;

  // --- Targets ---
  const { bullTarget, bearTarget, expectedRange } = computeTargets(
    price, trend, atrVal, regime
  );

  // --- Breakout Probability ---
  const breakout = computeBreakoutProbability(
    price, trend, momentum, rsiVal, zScoreVal, hurstVal, zoneInfluence
  );

  // --- Risk/Reward ---
  const { rrLong, rrShort } = computeRiskReward(price, bullTarget, bearTarget);

  // --- Confidence ---
  const confidence = computeConfidence(
    buffer.length, regime, trend, momentum, rsiVal, hurstVal,
    levelProximityScore, emaCrossScore
  );

  return {
    asOf: quote.timestamp,
    symbol: "XAUUSD",
    price: roundTo(price, 2),
    dailyChange: roundTo(quote.change, 2),
    dailyChangePct: roundTo(quote.changePct, 3),
    previousClose: roundTo(quote.previousClose, 2),

    ema8: emaFast !== null ? roundTo(emaFast, 2) : null,
    ema21: emaMid !== null ? roundTo(emaMid, 2) : null,
    ema55: emaSlow !== null ? roundTo(emaSlow, 2) : null,
    rsi14: rsiVal !== null ? roundTo(rsiVal, 1) : null,
    atr: atrVal !== null ? roundTo(atrVal, 2) : null,
    zScore: zScoreVal !== null ? roundTo(zScoreVal, 2) : null,
    hurst: hurstVal !== null ? roundTo(hurstVal, 3) : null,

    regime,
    trend,
    momentum,

    nearestResistance: nearestRes,
    nearestSupport: nearestSup,
    currentZone: zone,
    magnetLevel: magnet,

    bullTarget,
    bearTarget,
    expectedRange,

    breakoutProbUp: breakout.up,
    breakoutProbDown: breakout.down,

    rrLong,
    rrShort,

    confidence,

    resistanceLevels: resistances.map((r) => r.price),
    supportLevels: supports.map((s) => s.price),

    drivers: {
      emaCrossScore: roundTo(emaCrossScore, 4),
      momentumScore: roundTo(momentumScore, 4),
      levelProximityScore: roundTo(levelProximityScore, 4),
      volatilityScore: roundTo(volatilityScore, 4),
      zoneInfluence: roundTo(zoneInfluence, 4),
      hurstBias: roundTo(hurstBias, 4)
    },

    bufferSize: buffer.length,
    bufferDurationMin: roundTo(buffer.durationMs() / 60_000, 1)
  };
}
