import { DataSnapshot } from "../data/types.js";
import {
  PriceLevel,
  LEVELS,
  resistancesAbove,
  supportsBelow,
  activeZone,
  strongestMagnet,
  proximityWeight,
  gridPosition,
  distanceToNearestZone,
  updateLevelStats,
  validateLevelsAgainstBars
} from "../levels/grid.js";
import {
  clamp,
  roundTo,
  ema,
  sma,
  trueRangeAtr,
  rsi,
  roc,
  zScore,
  hurstExponent,
  sigmoid,
  logReturns,
  realizedVol,
  varianceRatio,
  autoCorrelation,
  kama,
  bollingerBands,
  linRegSlope
} from "../lib/math.js";
import {
  GoldAnalysis,
  MarketRegime,
  TrendDirection,
  MomentumState,
  VolatilityRegime,
  TimeframeSummary,
  TradingSignal
} from "./types.js";
import { detectHeadAndShoulders } from "./patterns.js";
import { EventRisk } from "../events/event-calendar.js";
import { emptyMacroDrivers, MacroDrivers, MacroSnapshot } from "../macro/types.js";

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
const VR_PERIOD = 5;        // Variance ratio look-back multiplier
const KAMA_ER_PERIOD = 10;  // KAMA efficiency ratio period
const BB_PERIOD = 20;       // Bollinger Band period

export interface AnalysisContext {
  macro?: MacroSnapshot | null;
  macroDrivers?: MacroDrivers;
  eventRisk?: EventRisk;
}

const NORMAL_EVENT_RISK: EventRisk = {
  mode: "normal",
  tradePermission: "allowed"
};

// Category weight: institutional levels influence targets and breakout scoring
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
// Volatility Regime — returns-based
// ---------------------------------------------------------------------------

function classifyVolRegime(
  currentVol: number,
  historicalVol: number
): VolatilityRegime {
  if (historicalVol <= 0) return "normal";
  const ratio = currentVol / historicalVol;
  if (ratio < 0.5) return "low";
  if (ratio < 1.5) return "normal";
  if (ratio < 2.5) return "high";
  return "extreme";
}

// ---------------------------------------------------------------------------
// Regime Detection — multi-evidence synthesis
// ---------------------------------------------------------------------------

function detectRegime(
  prices: number[],
  returns: number[],
  emaFast: number | null,
  emaMid: number | null,
  emaSlow: number | null,
  rsiVal: number | null,
  hurst: number | null,
  vrVal: number | null,
  volRegime: VolatilityRegime
): MarketRegime {
  // Extreme volatility overrides everything
  if (volRegime === "extreme") return "volatile";
  if (volRegime === "high") {
    // High vol can still be trending if structure is clear
    const aligned =
      emaFast !== null && emaMid !== null && emaSlow !== null &&
      ((emaFast > emaMid && emaMid > emaSlow) ||
       (emaFast < emaMid && emaMid < emaSlow));
    if (!aligned) return "volatile";
  }

  // Evidence accumulation for regime
  let trendEvidence = 0;   // positive = trending, negative = ranging/reverting
  let consolEvidence = 0;  // positive = consolidation

  // 1. EMA alignment — strongest structural trend signal
  if (emaFast !== null && emaMid !== null && emaSlow !== null) {
    if (emaFast > emaMid && emaMid > emaSlow) trendEvidence += 2;
    else if (emaFast < emaMid && emaMid < emaSlow) trendEvidence += 2;
    else trendEvidence -= 1;
  }

  // 2. Variance ratio — statistical trending test
  if (vrVal !== null) {
    if (vrVal > 1.15) trendEvidence += 1.5;       // Strong serial correlation
    else if (vrVal > 1.05) trendEvidence += 0.5;
    else if (vrVal < 0.85) trendEvidence -= 1.5;   // Mean-reverting
    else if (vrVal < 0.95) trendEvidence -= 0.5;
  }

  // 3. Hurst exponent — long-range dependence
  if (hurst !== null) {
    if (hurst > 0.6) trendEvidence += 1;
    else if (hurst < 0.4) trendEvidence -= 1;
  }

  // 4. RSI in dead zone = consolidation
  if (rsiVal !== null && rsiVal > 42 && rsiVal < 58) {
    consolEvidence += 1;
  }

  // 5. Low volatility = consolidation
  if (volRegime === "low") consolEvidence += 1.5;

  // 6. Linear regression slope — structural direction
  const slope = linRegSlope(prices.slice(-30));
  if (slope !== null) {
    if (Math.abs(slope) > 0.0001) trendEvidence += 0.5;
    else consolEvidence += 0.5;
  }

  // Decision
  if (trendEvidence >= 2.5) {
    const price = prices[prices.length - 1];
    if (emaFast !== null && emaMid !== null) {
      return emaFast > emaMid ? "trending-up" : "trending-down";
    }
    // Fallback: use price vs short SMA
    const sma20 = sma(prices, Math.min(20, prices.length));
    return sma20 !== null && price > sma20 ? "trending-up" : "trending-down";
  }

  if (consolEvidence >= 2) return "consolidation";

  return "ranging";
}

// ---------------------------------------------------------------------------
// Single-Timeframe Trend Score — returns [-1, 1]
// ---------------------------------------------------------------------------

function tfTrendScore(
  prices: number[],
  emaFast: number | null,
  emaMid: number | null,
  rsiVal: number | null
): number {
  if (prices.length < 3) return 0;

  const price = prices[prices.length - 1];
  let score = 0;
  let weight = 0;

  // EMA alignment
  if (emaFast !== null && emaMid !== null && emaMid !== 0) {
    const spread = (emaFast - emaMid) / (Math.abs(emaMid) * 0.005); // Normalize by 0.5%
    score += clamp(spread, -1, 1) * 0.45;
    weight += 0.45;
  }

  // Price vs EMA mid
  if (emaMid !== null && emaMid !== 0) {
    const priceBias = (price - emaMid) / (Math.abs(emaMid) * 0.005);
    score += clamp(priceBias, -1, 1) * 0.25;
    weight += 0.25;
  }

  // RSI bias
  if (rsiVal !== null) {
    score += ((rsiVal - 50) / 50) * 0.20;
    weight += 0.20;
  }

  // Slope of last 10 bars
  const slope = linRegSlope(prices.slice(-10));
  if (slope !== null) {
    score += clamp(slope * 2000, -1, 1) * 0.10;
    weight += 0.10;
  }

  return weight > 0 ? score / weight * Math.min(weight / 0.5, 1) : 0;
}

// ---------------------------------------------------------------------------
// Multi-Timeframe Trend — weighted confluence across 1m, 5m, 15m
// ---------------------------------------------------------------------------

function analyzeTF(
  prices: number[],
  returns: number[]
): TimeframeSummary {
  const emaF = ema(prices, EMA_FAST);
  const emaM = ema(prices, EMA_MID);
  const rsiVal = prices.length >= RSI_PERIOD + 1 ? rsi(prices, RSI_PERIOD) : null;

  const score = tfTrendScore(prices, emaF, emaM, rsiVal);
  const trend: TrendDirection =
    score > 0.15 ? "bullish" : score < -0.15 ? "bearish" : "neutral";

  const aligned = emaF !== null && emaM !== null &&
    ((trend === "bullish" && emaF > emaM) || (trend === "bearish" && emaF < emaM));

  // Normalized momentum: last ROC / realized vol (sigma units)
  const lookback = Math.min(5, prices.length - 1);
  const r = roc(prices, lookback);
  const rv = realizedVol(returns, Math.min(20, returns.length));
  const normMom = r !== null && rv > 0 ? r / rv : 0;

  return { trend, rsi: rsiVal !== null ? roundTo(rsiVal, 1) : null, emaAligned: aligned, momentum: roundTo(normMom, 2) };
}

function detectTrend(
  score1m: number,
  tf5m: TimeframeSummary,
  tf15m: TimeframeSummary,
  zScoreVal: number | null,
  vrVal: number | null,
  normMomentum: number | null
): { trend: TrendDirection; score: number } {
  // Multi-timeframe weighted score
  // Higher timeframes get more weight (noise filtering)
  let score = 0;
  let totalWeight = 0;

  // 15m trend (dominant weight)
  const score15m = tf15m.trend === "bullish" ? 1 : tf15m.trend === "bearish" ? -1 : 0;
  score += score15m * (tf15m.emaAligned ? 1.0 : 0.6) * 0.30;
  totalWeight += 0.30;

  // 5m trend
  const score5m = tf5m.trend === "bullish" ? 1 : tf5m.trend === "bearish" ? -1 : 0;
  score += score5m * (tf5m.emaAligned ? 1.0 : 0.6) * 0.25;
  totalWeight += 0.25;

  // 1m trend score (raw from indicators)
  score += clamp(score1m, -1, 1) * 0.15;
  totalWeight += 0.15;

  // Z-score contribution
  if (zScoreVal !== null) {
    score += clamp(zScoreVal / 2.5, -1, 1) * 0.10;
    totalWeight += 0.10;
  }

  // Variance ratio directional bias
  if (vrVal !== null) {
    // VR > 1 amplifies existing trend, VR < 1 dampens
    const vrAmplifier = vrVal > 1 ? Math.min(vrVal - 1, 0.5) : -Math.min(1 - vrVal, 0.3);
    score += Math.sign(score) * vrAmplifier * 0.10;
    totalWeight += 0.10;
  }

  // Normalized momentum
  if (normMomentum !== null) {
    score += clamp(normMomentum / 3, -1, 1) * 0.10;
    totalWeight += 0.10;
  }

  const finalScore = totalWeight > 0 ? score / totalWeight : 0;

  const trend: TrendDirection =
    finalScore > 0.12 ? "bullish" : finalScore < -0.12 ? "bearish" : "neutral";

  return { trend, score: finalScore };
}

// ---------------------------------------------------------------------------
// Momentum — vol-normalized (sigma units)
// ---------------------------------------------------------------------------

function detectMomentum(
  prices: number[],
  returns: number[]
): { momentum: MomentumState; score: number } {
  if (prices.length < 10 || returns.length < 10) {
    return { momentum: "steady", score: 0 };
  }

  const rv = realizedVol(returns, Math.min(30, returns.length));
  if (rv <= 0) return { momentum: "steady", score: 0 };

  // Multi-horizon normalized momentum (in sigma units)
  const roc3 = roc(prices, 3);
  const roc8 = roc(prices, 8);
  const roc20 = prices.length > 20 ? roc(prices, 20) : null;

  const norm3 = roc3 !== null ? Math.abs(roc3) / rv : 0;
  const norm8 = roc8 !== null ? Math.abs(roc8) / rv : 0;
  const norm20 = roc20 !== null ? Math.abs(roc20) / rv : 0;

  // Composite: recent weighted more
  const composite = norm3 * 0.5 + norm8 * 0.3 + (roc20 !== null ? norm20 * 0.2 : norm8 * 0.2);

  // Acceleration: is short-term momentum exceeding medium-term?
  const acceleration = norm3 - norm8;

  // In sigma units: > 1.5σ with acceleration = accelerating
  if (acceleration > 0.3 && composite > 1.2) return { momentum: "accelerating", score: composite };
  if (composite < 0.4) return { momentum: "decaying", score: composite };
  return { momentum: "steady", score: composite };
}

// ---------------------------------------------------------------------------
// Level Proximity — ATR-adaptive sigma
// ---------------------------------------------------------------------------

function analyzeLevelProximity(
  price: number,
  atrVal: number | null
): {
  levelProximityScore: number;
  zoneInfluence: number;
} {
  // Adaptive sigma: use ATR if available, else default
  const sigma = atrVal !== null && atrVal > 0 ? Math.max(atrVal * 1.5, 5) : 12;

  let maxProximity = 0;
  for (const level of LEVELS) {
    const catWeight = CATEGORY_WEIGHT[level.category];
    const prox = proximityWeight(price, level.price, sigma) * level.strength * catWeight;
    maxProximity = Math.max(maxProximity, prox);
  }

  // Zone influence
  let zoneInfluence = 0;
  const zone = activeZone(price);

  if (zone) {
    const zoneWidth = zone.max - zone.min;
    const positionInZone = (price - zone.min) / zoneWidth;
    const zoneSign = zone.type === "demand" ? 1 : zone.type === "supply" ? -1 : 0;
    const depth = zone.type === "demand" ? (1 - positionInZone) : positionInZone;
    zoneInfluence = zoneSign * zone.strength * (0.5 + 0.5 * depth);
  } else {
    const nearest = distanceToNearestZone(price);
    if (nearest && Math.abs(nearest.distance) < (atrVal ?? 15) * 3) {
      const approachSign =
        nearest.zone.type === "demand" ? 1
        : nearest.zone.type === "supply" ? -1
        : 0;
      const approachWeight = Math.exp(-Math.abs(nearest.distance) / (sigma * 1.5))
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
// Targets — category-weighted with ATR scaling
// ---------------------------------------------------------------------------

function computeTargets(
  price: number,
  trend: TrendDirection,
  expectedMove: number | null,
  regime: MarketRegime
): { bullTarget: number; bearTarget: number; expectedRange: { min: number; max: number } } {
  const resistances = resistancesAbove(price, 3);
  const supports = supportsBelow(price, 3);

  // Bull target: category-weighted average of nearest resistances
  let bullTarget = price + Math.max(expectedMove ?? 0, 10) * 2;
  if (resistances.length > 0) {
    const weighted = resistances.map((r, i) => ({
      price: r.price,
      weight: r.strength * CATEGORY_WEIGHT[r.category] * (1 / (i + 1))
    }));
    const total = weighted.reduce((s, w) => s + w.weight, 0);
    bullTarget = total > 0
      ? weighted.reduce((s, w) => s + w.price * w.weight, 0) / total
      : resistances[0].price;
  }

  // Bear target: category-weighted average of nearest supports
  let bearTarget = price - Math.max(expectedMove ?? 0, 10) * 2;
  if (supports.length > 0) {
    const weighted = supports.map((s, i) => ({
      price: s.price,
      weight: s.strength * CATEGORY_WEIGHT[s.category] * (1 / (i + 1))
    }));
    const total = weighted.reduce((s, w) => s + w.weight, 0);
    bearTarget = total > 0
      ? weighted.reduce((s, w) => s + w.price * w.weight, 0) / total
      : supports[0].price;
  }

  // Expected range: realized-vol expected move, regime-adjusted
  // expectedMove is already the 1-hour vol-scaled move in $
  const baseRange = Math.max(expectedMove ?? 5, 5); // Floor at $5 if continuous 1m move is unavailable
  const regimeMultiplier =
    regime === "volatile" ? 2.2
    : regime === "trending-up" || regime === "trending-down" ? 1.8
    : regime === "consolidation" ? 0.7
    : 1.2;

  const halfRange = roundTo(baseRange * regimeMultiplier, 2);

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
// Breakout Score — uncalibrated directional pressure model
// ---------------------------------------------------------------------------

function computeBreakoutScore(
  price: number,
  trendScore: number,
  momentum: MomentumState,
  normMomentum: number | null,
  rsiVal: number | null,
  vrVal: number | null,
  zoneInfluence: number,
  levelProximityScore: number
): { up: number; down: number } {
  // Heuristic directional evidence mapped into 0–1. This is not calibrated
  // against historical outcomes and must not be interpreted as probability.
  let z = 0;

  // Trend direction and strength (dominant factor)
  z += trendScore * 2.0;

  // Momentum (vol-normalized)
  if (normMomentum !== null) {
    z += clamp(normMomentum / 2, -1, 1) * 0.8;
  }
  if (momentum === "accelerating") z += Math.sign(trendScore || 1) * 0.3;

  // RSI
  if (rsiVal !== null) {
    if (rsiVal > 70) z += 0.4;
    else if (rsiVal < 30) z -= 0.4;
    else z += (rsiVal - 50) / 50 * 0.3;
  }

  // Variance ratio: persistent trends more likely to continue
  if (vrVal !== null) {
    z += clamp((vrVal - 1) * 2, -0.5, 0.5);
  }

  // Zone influence
  z += zoneInfluence * 0.6;

  // Grid position — extreme positions favor mean-reversion
  const gp = gridPosition(price);
  if (gp > 0.85) z -= 0.3;
  else if (gp < 0.15) z += 0.3;

  // Level proximity reduces breakout odds (stronger level = harder to break)
  const nearestRes = resistancesAbove(price, 1)[0];
  const nearestSup = supportsBelow(price, 1)[0];

  if (nearestRes) {
    const dist = nearestRes.price - price;
    const strength = nearestRes.strength * CATEGORY_WEIGHT[nearestRes.category];
    if (dist < 15) z -= strength * 0.4 * Math.exp(-dist / 8);
  }
  if (nearestSup) {
    const dist = price - nearestSup.price;
    const strength = nearestSup.strength * CATEGORY_WEIGHT[nearestSup.category];
    if (dist < 15) z += strength * 0.4 * Math.exp(-dist / 8);
  }

  const scoreUp = sigmoid(z, 1, 0);
  const scoreDown = sigmoid(-z, 1, 0);

  return {
    up: roundTo(clamp(scoreUp, 0.05, 0.90), 3),
    down: roundTo(clamp(scoreDown, 0.05, 0.90), 3)
  };
}

// ---------------------------------------------------------------------------
// Confidence — evidence accumulation model
// ---------------------------------------------------------------------------

function computeConfidence(
  bufferSize: number,
  emaCrossScore: number,
  tfConfluence: number,
  normMomentum: number | null,
  hurst: number | null,
  vrVal: number | null,
  levelProximityScore: number,
  regime: MarketRegime,
  volRegime: VolatilityRegime
): number {
  // Evidence accumulation: each factor contributes evidence
  // More evidence → higher confidence in the analysis quality
  let evidence = 0;

  // Data quantity (diminishing returns)
  if (bufferSize >= 30) evidence += 0.6;
  if (bufferSize >= 60) evidence += 0.5;
  if (bufferSize >= 120) evidence += 0.4;
  if (bufferSize >= 200) evidence += 0.3;

  // EMA alignment clarity
  evidence += Math.abs(emaCrossScore) * 2.5;

  // Multi-TF confluence — factors agreeing = more confidence
  evidence += Math.abs(tfConfluence) * 2.0;

  // Momentum clarity (vol-normalized)
  if (normMomentum !== null && Math.abs(normMomentum) > 1.0) {
    evidence += 0.4;
  }

  // Hurst clarity — clear trending or mean-reverting signal
  if (hurst !== null && (hurst > 0.6 || hurst < 0.4)) {
    evidence += 0.5;
  }

  // Variance ratio clarity
  if (vrVal !== null && Math.abs(vrVal - 1) > 0.12) {
    evidence += 0.4;
  }

  // Near key level → level-based analysis more reliable
  evidence += levelProximityScore * 0.6;

  // Regime clarity (trending/volatile are clearer than ranging)
  if (regime === "trending-up" || regime === "trending-down") evidence += 0.5;
  else if (regime === "volatile") evidence += 0.3;
  else if (regime === "consolidation") evidence += 0.2;
  else evidence -= 0.2; // Ranging = unclear

  // Extreme vol reduces confidence
  if (volRegime === "extreme") evidence -= 0.8;
  else if (volRegime === "high") evidence -= 0.3;

  // Map through sigmoid: evidence=3 → ~50%, evidence=6 → ~95%
  // confidence = 5 + 90 × sigmoid(evidence - 3)
  const raw = 5 + 90 * sigmoid(evidence, 1, 3);
  return Math.round(clamp(raw, 5, 95));
}

// ---------------------------------------------------------------------------
// Actionable Signal — entry / stop / targets
// ---------------------------------------------------------------------------

function computeSignal(
  price: number,
  trend: TrendDirection,
  trendScore: number,
  confidence: number,
  atrVal: number | null,
  kamaVal: number | null
): TradingSignal {
  const atr = atrVal ?? 8;

  if (trend === "neutral" || Math.abs(trendScore) < 0.08) {
    return {
      direction: "FLAT",
      strength: Math.round(clamp(Math.abs(trendScore) * 100, 0, 100)),
      entry: roundTo(price, 2),
      stopLoss: roundTo(price - atr * 1.5, 2),
      targets: [],
      riskReward: 0
    };
  }

  const isLong = trend === "bullish";
  const direction = isLong ? "LONG" as const : "SHORT" as const;
  const strength = Math.round(clamp(Math.abs(trendScore) * 120, 0, 100));

  // Entry: use KAMA as ideal entry (pullback to adaptive MA)
  // If KAMA is between current price and stop, use it; else use current price
  let entry = price;
  if (kamaVal !== null) {
    if (isLong && kamaVal < price && kamaVal > price - atr) {
      entry = kamaVal;
    } else if (!isLong && kamaVal > price && kamaVal < price + atr) {
      entry = kamaVal;
    }
  }

  // Stop: beyond nearest S/R + ATR buffer
  let stopLoss: number;
  if (isLong) {
    const support = supportsBelow(price, 1)[0];
    stopLoss = support
      ? Math.min(support.price - atr * 0.3, price - atr * 1.2)
      : price - atr * 1.5;
  } else {
    const resistance = resistancesAbove(price, 1)[0];
    stopLoss = resistance
      ? Math.max(resistance.price + atr * 0.3, price + atr * 1.2)
      : price + atr * 1.5;
  }

  // Targets: next 2 S/R levels in signal direction
  const targets: number[] = [];
  if (isLong) {
    const res = resistancesAbove(price, 2);
    targets.push(...res.map(r => r.price));
  } else {
    const sup = supportsBelow(price, 2);
    targets.push(...sup.map(s => s.price));
  }

  // Ensure at least one target (ATR-based fallback)
  if (targets.length === 0) {
    targets.push(roundTo(isLong ? price + atr * 2 : price - atr * 2, 2));
  }

  // R:R to T1
  const risk = Math.abs(entry - stopLoss);
  const reward = targets.length > 0 ? Math.abs(targets[0] - entry) : atr * 2;
  const rr = risk > 0 ? reward / risk : 0;

  return {
    direction,
    strength,
    entry: roundTo(entry, 2),
    stopLoss: roundTo(stopLoss, 2),
    targets: targets.map(t => roundTo(t, 2)),
    riskReward: roundTo(rr, 2)
  };
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
// Expected Move — realized-vol-scaled
// ---------------------------------------------------------------------------

function getContinuousOneMinuteCloses(bars: DataSnapshot["bars"]["m1"]): number[] {
  if (bars.length < 2) return bars.map((bar) => bar.close);
  const tail = [bars[bars.length - 1]];
  for (let i = bars.length - 2; i >= 0; i--) {
    const next = tail[0];
    if (bars[i].startMs + 60_000 !== next.startMs) break;
    tail.unshift(bars[i]);
  }
  return tail.map((bar) => bar.close);
}

function computeExpectedMove(
  price: number,
  oneMinuteBars: DataSnapshot["bars"]["m1"]
): number | null {
  const returns = logReturns(getContinuousOneMinuteCloses(oneMinuteBars));
  if (returns.length < 10) return null;

  // Use only continuous 1-minute returns. Scale to 1-hour horizon with sqrt(60).
  const window = Math.min(60, returns.length);
  const rv = realizedVol(returns, window);
  const hourlyVol = rv * Math.sqrt(60);
  return roundTo(price * hourlyVol, 2);
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

export function analyzeGold(
  snapshot: DataSnapshot,
  context: AnalysisContext = {}
): GoldAnalysis {
  const price = snapshot.primary.price;
  const isBrokerPrimary = snapshot.primary.instrumentKind === "broker_spot";
  const prices = snapshot.bars.m1.map((bar) => bar.close);
  const hasIndicators = prices.length >= MIN_BUFFER_FOR_INDICATORS;

  // ── Log Returns (foundation of all returns-based metrics) ──
  const returns = logReturns(prices);

  // ── Classical Indicators (1m timeframe) ──
  const emaFast = hasIndicators ? ema(prices, EMA_FAST) : null;
  const emaMid = hasIndicators ? ema(prices, EMA_MID) : null;
  const emaSlow = prices.length >= EMA_SLOW ? ema(prices, EMA_SLOW) : null;
  const rsiVal = prices.length >= RSI_PERIOD + 1 ? rsi(prices, RSI_PERIOD) : null;
  const atrVal = snapshot.bars.m1.length >= ATR_PERIOD + 1
    ? trueRangeAtr(snapshot.bars.m1, ATR_PERIOD)
    : null;
  const zScoreVal = prices.length >= ZSCORE_PERIOD ? zScore(prices, ZSCORE_PERIOD) : null;
  const hurstVal = prices.length >= HURST_MIN_POINTS ? hurstExponent(prices) : null;

  // ── Advanced Indicators (returns-based) ──
  const currentVol = returns.length >= 30 ? realizedVol(returns, 30) : 0;
  const historicalVol = returns.length >= 60 ? realizedVol(returns) : currentVol;
  const rvDisplay = returns.length >= 10
    ? roundTo(realizedVol(returns, Math.min(60, returns.length)) * Math.sqrt(60) * 100, 3)
    : null;

  const vrVal = prices.length >= VR_PERIOD * 3 ? varianceRatio(prices, VR_PERIOD) : null;
  const acfVal = returns.length >= 5 ? autoCorrelation(returns, 1) : null;
  const kamaVal = prices.length >= KAMA_ER_PERIOD + 1 ? kama(prices, KAMA_ER_PERIOD) : null;

  // Normalized momentum: ROC(5) / realized_vol → sigma units
  const rocVal = roc(prices, 5);
  const rvShort = realizedVol(returns, Math.min(20, returns.length));
  const normMomentum = rocVal !== null && rvShort > 0 ? roundTo(rocVal / rvShort, 2) : null;

  // Bollinger Bands
  const bb = prices.length >= BB_PERIOD ? bollingerBands(prices, BB_PERIOD) : null;

  // ── Volatility Regime ──
  const volRegime = hasIndicators ? classifyVolRegime(currentVol, historicalVol) : "normal";

  // ── Multi-Timeframe Analysis ──
  const prices5m = snapshot.bars.m5.map((bar) => bar.close);
  const prices15m = snapshot.bars.m15.map((bar) => bar.close);
  const returns5m = logReturns(prices5m);
  const returns15m = logReturns(prices15m);

  const tf5m = prices5m.length >= 8 ? analyzeTF(prices5m, returns5m) : {
    trend: "neutral" as const, rsi: null, emaAligned: false, momentum: 0
  };
  const tf15m = prices15m.length >= 8 ? analyzeTF(prices15m, returns15m) : {
    trend: "neutral" as const, rsi: null, emaAligned: false, momentum: 0
  };

  // Confluence: weighted agreement across timeframes
  const tfScores = [
    { score: tf15m.trend === "bullish" ? 1 : tf15m.trend === "bearish" ? -1 : 0, weight: 0.5 },
    { score: tf5m.trend === "bullish" ? 1 : tf5m.trend === "bearish" ? -1 : 0, weight: 0.3 },
  ];
  // Add 1m trend from raw indicators
  const score1m = hasIndicators ? tfTrendScore(prices, emaFast, emaMid, rsiVal) : 0;
  tfScores.push({
    score: score1m > 0.15 ? 1 : score1m < -0.15 ? -1 : 0,
    weight: 0.2
  });

  const totalW = tfScores.reduce((s, t) => s + t.weight, 0);
  const tfConfluence = totalW > 0
    ? tfScores.reduce((s, t) => s + t.score * t.weight, 0) / totalW
    : 0;

  // ── Regime Detection ──
  const regime = hasIndicators
    ? detectRegime(prices, returns, emaFast, emaMid, emaSlow, rsiVal, hurstVal, vrVal, volRegime)
    : "ranging";

  // ── Trend Detection (multi-TF weighted) ──
  const { trend, score: trendScore } = hasIndicators
    ? detectTrend(score1m, tf5m, tf15m, zScoreVal, vrVal, normMomentum)
    : { trend: "neutral" as TrendDirection, score: 0 };

  // ── Momentum (vol-normalized) ──
  const { momentum, score: momentumScore } = detectMomentum(prices, returns);

  // ── Level Analysis (ATR-adaptive sigma) ──
  const { levelProximityScore, zoneInfluence } = analyzeLevelProximity(price, atrVal);
  const resistances = resistancesAbove(price, 4);
  const supports = supportsBelow(price, 4);
  const nearestRes = resistances[0] ?? null;
  const nearestSup = supports[0] ?? null;
  const zone = activeZone(price);
  const magnet = strongestMagnet(price, atrVal ? atrVal * 3 : 30);

  // ── Volatility Score (returns-based) ──
  const volatilityScore = currentVol > 0 && historicalVol > 0
    ? clamp(currentVol / historicalVol, 0, 3) / 3
    : 0;

  // ── Hurst bias ──
  const hurstBias = hurstVal !== null ? clamp((hurstVal - 0.5) * 2, -1, 1) : 0;

  // ── VR bias ──
  const vrBias = vrVal !== null ? clamp((vrVal - 1) * 3, -1, 1) : 0;

  // ── Expected Move (vol-scaled) — must come before targets ──
  const expectedMove = computeExpectedMove(price, snapshot.bars.m1);

  // ── Targets ──
  const { bullTarget, bearTarget, expectedRange } = computeTargets(
    price, trend, expectedMove, regime
  );

  // ── Breakout Score (uncalibrated directional pressure) ──
  const breakout = computeBreakoutScore(
    price, trendScore, momentum, normMomentum,
    rsiVal, vrVal, zoneInfluence, levelProximityScore
  );

  // ── Risk/Reward ──
  const { rrLong, rrShort } = computeRiskReward(price, bullTarget, bearTarget);

  // ── Confidence (evidence-based) ──
  const rawConfidence = computeConfidence(
    prices.length, trendScore, tfConfluence, normMomentum,
    hurstVal, vrVal, levelProximityScore, regime, volRegime
  );
  const confidence = isBrokerPrimary && snapshot.futuresFlowStatus !== "confirmed"
    ? Math.min(rawConfidence, 75)
    : rawConfidence;

  // ── Pattern Detection (Head & Shoulders) ──
  const patternResult = prices.length >= 30
    ? detectHeadAndShoulders(prices, prices5m, prices15m)
    : { headAndShoulders: null };
  const patternWatch = patternResult.headAndShoulders;
  const patternImpact = patternWatch ? "watch-only" as const : null;

  // ── Actionable Signal ──
  let signal = computeSignal(price, trend, trendScore, confidence, atrVal, kamaVal);
  const eventRisk = context.eventRisk ?? NORMAL_EVENT_RISK;
  if (eventRisk.tradePermission !== "allowed") {
    signal = {
      ...signal,
      direction: "FLAT",
      strength: 0,
      targets: [],
      riskReward: 0
    };
  }

  const levelStates = validateLevelsAgainstBars(
    updateLevelStats(LEVELS, snapshot.bars.m1),
    snapshot.bars.m1
  );

  return {
    asOf: Math.floor(snapshot.primary.timestampMs / 1000),
    symbol: snapshot.primary.symbol,
    price: roundTo(price, 2),
    dailyChange: roundTo(snapshot.primary.dailyChange ?? 0, 2),
    dailyChangePct: roundTo(snapshot.primary.dailyChangePct ?? 0, 3),
    previousClose: roundTo(snapshot.primary.previousClose ?? price, 2),

    ema8: emaFast !== null ? roundTo(emaFast, 2) : null,
    ema21: emaMid !== null ? roundTo(emaMid, 2) : null,
    ema55: emaSlow !== null ? roundTo(emaSlow, 2) : null,
    rsi14: rsiVal !== null ? roundTo(rsiVal, 1) : null,
    atr: atrVal !== null ? roundTo(atrVal, 2) : null,
    zScore: zScoreVal !== null ? roundTo(zScoreVal, 2) : null,
    hurst: hurstVal !== null ? roundTo(hurstVal, 3) : null,

    realizedVol: rvDisplay,
    varianceRatio: vrVal !== null ? roundTo(vrVal, 3) : null,
    autocorrelation: acfVal !== null ? roundTo(acfVal, 3) : null,
    kamaPrice: kamaVal !== null ? roundTo(kamaVal, 2) : null,
    normalizedMomentum: normMomentum,
    bbWidth: bb !== null ? roundTo(bb.width, 3) : null,
    bbPercentB: bb !== null ? roundTo(bb.percentB, 3) : null,

    regime,
    trend,
    momentum,
    volRegime,

    tf: {
      m5: tf5m,
      m15: tf15m,
      confluence: roundTo(tfConfluence, 3)
    },

    signal,
    patternWatch,
    patternImpact,

    nearestResistance: nearestRes,
    nearestSupport: nearestSup,
    currentZone: zone,
    magnetLevel: magnet,

    bullTarget,
    bearTarget,
    expectedRange,
    expectedMove,

    breakoutScoreUp: breakout.up,
    breakoutScoreDown: breakout.down,

    rrLong,
    rrShort,

    confidence,

    resistanceLevels: resistances.map(r => r.price),
    supportLevels: supports.map(s => s.price),
    levelStates: levelStates.map((level) => ({
      price: level.price,
      label: level.label,
      status: level.status,
      touchCount: level.touchCount,
      lastTouchedAt: level.lastTouchedAt
    })),

    drivers: {
      emaCrossScore: roundTo(trendScore, 4),
      momentumScore: roundTo(momentumScore, 4),
      levelProximityScore: roundTo(levelProximityScore, 4),
      volatilityScore: roundTo(volatilityScore, 4),
      zoneInfluence: roundTo(zoneInfluence, 4),
      hurstBias: roundTo(hurstBias, 4),
      vrBias: roundTo(vrBias, 4),
      tfConfluence: roundTo(tfConfluence, 4)
    },

    bufferSize: snapshot.bars.m1.length,
    bufferDurationMin: snapshot.bars.m1.length > 1
      ? roundTo((snapshot.bars.m1[snapshot.bars.m1.length - 1].endMs - snapshot.bars.m1[0].startMs) / 60_000, 1)
      : 0,

    data: {
      snapshot,
      sourceHealth: snapshot.sourceHealth,
      basis: snapshot.basis,
      barCoverage: snapshot.barCoverage,
      futuresFlowStatus: snapshot.futuresFlowStatus
    },

    macro: context.macro ?? null,
    macroDrivers: context.macroDrivers ?? emptyMacroDrivers(),
    eventRisk
  };
}
