// ---------------------------------------------------------------------------
// Head & Shoulders Pattern Detection — Quantitative Approach
//
// Detects both regular H&S (bearish reversal) and inverse H&S (bullish
// reversal) across multiple timeframes. Higher-TF patterns carry greater
// statistical significance → larger confidence boost.
//
// Algorithm:
//   1. Smooth prices with EMA(3) to suppress 1-bar noise
//   2. Find local extrema (peaks/troughs) with adaptive prominence
//   3. Scan for 3-peak (H&S) or 3-trough (inv H&S) sequences
//   4. Score pattern: symmetry, neckline slope, depth, completion
//   5. Compute confidence boost ∝ quality × timeframe weight
//
// Timeframe confidence multipliers:
//   1m:  ×0.08   (noisy, short-term)
//   5m:  ×0.15   (moderate, filtered)
//   15m: ×0.22   (significant, institutional)
// ---------------------------------------------------------------------------

import { emaSeries, realizedVol, logReturns, clamp, roundTo } from "../lib/math.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HSTimeframe = "1m" | "5m" | "15m";

export interface HeadAndShouldersPattern {
  type: "bearish" | "bullish";    // bearish = top H&S, bullish = inverse H&S
  timeframe: HSTimeframe;

  // Key structural prices
  leftShoulder: number;
  head: number;
  rightShoulder: number;
  neckline: number;               // Interpolated neckline at current bar
  necklineSlope: number;          // Per-bar slope (positive = rising)

  // Measured-move target
  target: number;

  // Pattern metrics (0–100 each)
  symmetry: number;               // How close shoulders are in height
  necklineQuality: number;        // How horizontal the neckline is
  depth: number;                  // Pattern height relative to price
  quality: number;                // Composite quality score

  // Completion
  phase: "forming" | "confirmed"; // Confirmed = neckline broken
  completion: number;             // 0–1 (how far through neckline break)

  // Confidence contribution
  confidenceBoost: number;
}

export interface PatternResult {
  headAndShoulders: HeadAndShouldersPattern | null;
}

// ---------------------------------------------------------------------------
// TF confidence multiplier — institutional convention:
// higher timeframe = larger sample = more reliable reversal signal
// ---------------------------------------------------------------------------

const TF_CONFIDENCE: Record<HSTimeframe, number> = {
  "1m":  0.08,
  "5m":  0.15,
  "15m": 0.22,
};

// ---------------------------------------------------------------------------
// Local Extrema Detection
// ---------------------------------------------------------------------------

interface Extremum {
  index: number;
  price: number;
}

/**
 * Find local peaks (maxima) with minimum prominence.
 * A peak at index i is a point higher than all points within ±order bars.
 * Prominence = peak height above the higher of the two surrounding troughs.
 */
function findPeaks(prices: number[], order: number, minProminence: number): Extremum[] {
  const peaks: Extremum[] = [];

  for (let i = order; i < prices.length - order; i++) {
    let isPeak = true;
    for (let j = 1; j <= order; j++) {
      if (prices[i] < prices[i - j] || prices[i] < prices[i + j]) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;

    // Compute prominence: height above the higher of the two bounding troughs
    const leftMin = Math.min(...prices.slice(Math.max(0, i - order * 3), i));
    const rightMin = Math.min(...prices.slice(i + 1, Math.min(prices.length, i + order * 3 + 1)));
    const prominence = prices[i] - Math.max(leftMin, rightMin);

    if (prominence >= minProminence) {
      peaks.push({ index: i, price: prices[i] });
    }
  }

  return peaks;
}

/**
 * Find local troughs (minima) with minimum prominence.
 */
function findTroughs(prices: number[], order: number, minProminence: number): Extremum[] {
  const troughs: Extremum[] = [];

  for (let i = order; i < prices.length - order; i++) {
    let isTrough = true;
    for (let j = 1; j <= order; j++) {
      if (prices[i] > prices[i - j] || prices[i] > prices[i + j]) {
        isTrough = false;
        break;
      }
    }
    if (!isTrough) continue;

    const leftMax = Math.max(...prices.slice(Math.max(0, i - order * 3), i));
    const rightMax = Math.max(...prices.slice(i + 1, Math.min(prices.length, i + order * 3 + 1)));
    const prominence = Math.min(leftMax, rightMax) - prices[i];

    if (prominence >= minProminence) {
      troughs.push({ index: i, price: prices[i] });
    }
  }

  return troughs;
}

/**
 * Find the deepest trough (or highest peak) between two indices.
 */
function deepestTroughBetween(troughs: Extremum[], from: number, to: number): Extremum | null {
  let best: Extremum | null = null;
  for (const t of troughs) {
    if (t.index > from && t.index < to) {
      if (!best || t.price < best.price) best = t;
    }
  }
  return best;
}

function highestPeakBetween(peaks: Extremum[], from: number, to: number): Extremum | null {
  let best: Extremum | null = null;
  for (const p of peaks) {
    if (p.index > from && p.index < to) {
      if (!best || p.price > best.price) best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// H&S Pattern Scan
// ---------------------------------------------------------------------------

function scanBearishHS(
  prices: number[],
  peaks: Extremum[],
  troughs: Extremum[],
  tf: HSTimeframe
): HeadAndShouldersPattern | null {
  if (peaks.length < 3) return null;

  // Scan from most recent peaks backwards — find the freshest pattern
  for (let i = peaks.length - 1; i >= 2; i--) {
    const P3 = peaks[i];       // Right shoulder (most recent)
    const P2 = peaks[i - 1];   // Head
    const P1 = peaks[i - 2];   // Left shoulder

    // Head must be the highest peak
    if (P2.price <= P1.price || P2.price <= P3.price) continue;

    // Right shoulder should be somewhat recent (within last 60% of data)
    if (P3.index < prices.length * 0.4) continue;

    // Find troughs between shoulders → neckline points
    const T1 = deepestTroughBetween(troughs, P1.index, P2.index);
    const T2 = deepestTroughBetween(troughs, P2.index, P3.index);
    if (!T1 || !T2) continue;

    // Pattern metrics
    const necklineMid = (T1.price + T2.price) / 2;
    const patternHeight = P2.price - necklineMid;

    // Minimum pattern height (must be meaningful relative to price)
    if (patternHeight < prices[prices.length - 1] * 0.001) continue;

    // Shoulder symmetry: |P1 - P3| relative to pattern height
    const shoulderDiff = Math.abs(P1.price - P3.price);
    const symmetryRaw = 1 - shoulderDiff / patternHeight;
    if (symmetryRaw < 0.3) continue; // Too asymmetric

    // Neckline quality: how horizontal is the neckline
    const necklineDiff = Math.abs(T2.price - T1.price);
    const necklineRatio = necklineDiff / patternHeight;
    if (necklineRatio > 0.6) continue; // Neckline too tilted

    const necklineQualityRaw = 1 - necklineRatio;

    // Depth score: larger patterns are more significant
    const depthRatio = patternHeight / P2.price;
    const depthScore = Math.min(depthRatio * 500, 100);

    // Composite quality
    const symmetry = clamp(symmetryRaw * 100, 0, 100);
    const necklineQuality = clamp(necklineQualityRaw * 100, 0, 100);
    const quality = roundTo(symmetry * 0.30 + necklineQuality * 0.30 + depthScore * 0.40, 1);

    // Neckline slope and current neckline price
    const necklineSlope = (T2.price - T1.price) / (T2.index - T1.index);
    const currentNeckline = T1.price + necklineSlope * (prices.length - 1 - T1.index);

    // Completion: has price broken below the neckline?
    const currentPrice = prices[prices.length - 1];
    let phase: "forming" | "confirmed" = "forming";
    let completion = 0;
    if (currentPrice < currentNeckline) {
      phase = "confirmed";
      completion = clamp((currentNeckline - currentPrice) / patternHeight, 0, 1);
    }

    // Target: measured move
    const target = roundTo(currentNeckline - patternHeight, 2);

    // Confidence boost: quality × timeframe weight
    // Confirmed patterns get 1.5× boost
    const phaseMultiplier = phase === "confirmed" ? 1.5 : 1.0;
    const confidenceBoost = roundTo(quality * TF_CONFIDENCE[tf] * phaseMultiplier, 1);

    return {
      type: "bearish",
      timeframe: tf,
      leftShoulder: roundTo(P1.price, 2),
      head: roundTo(P2.price, 2),
      rightShoulder: roundTo(P3.price, 2),
      neckline: roundTo(currentNeckline, 2),
      necklineSlope: roundTo(necklineSlope, 4),
      target,
      symmetry: roundTo(symmetry, 1),
      necklineQuality: roundTo(necklineQuality, 1),
      depth: roundTo(depthScore, 1),
      quality: roundTo(quality, 1),
      phase,
      completion: roundTo(completion, 3),
      confidenceBoost
    };
  }

  return null;
}

function scanBullishHS(
  prices: number[],
  peaks: Extremum[],
  troughs: Extremum[],
  tf: HSTimeframe
): HeadAndShouldersPattern | null {
  if (troughs.length < 3) return null;

  // Scan from most recent troughs backwards
  for (let i = troughs.length - 1; i >= 2; i--) {
    const T3 = troughs[i];       // Right shoulder
    const T2 = troughs[i - 1];   // Head (deepest trough)
    const T1 = troughs[i - 2];   // Left shoulder

    // Head must be the lowest trough
    if (T2.price >= T1.price || T2.price >= T3.price) continue;

    // Right shoulder should be recent
    if (T3.index < prices.length * 0.4) continue;

    // Find peaks between troughs → neckline points
    const P1 = highestPeakBetween(peaks, T1.index, T2.index);
    const P2 = highestPeakBetween(peaks, T2.index, T3.index);
    if (!P1 || !P2) continue;

    // Pattern metrics (inverted)
    const necklineMid = (P1.price + P2.price) / 2;
    const patternHeight = necklineMid - T2.price;

    if (patternHeight < prices[prices.length - 1] * 0.001) continue;

    // Shoulder symmetry
    const shoulderDiff = Math.abs(T1.price - T3.price);
    const symmetryRaw = 1 - shoulderDiff / patternHeight;
    if (symmetryRaw < 0.3) continue;

    // Neckline quality
    const necklineDiff = Math.abs(P2.price - P1.price);
    const necklineRatio = necklineDiff / patternHeight;
    if (necklineRatio > 0.6) continue;

    const necklineQualityRaw = 1 - necklineRatio;
    const depthRatio = patternHeight / T2.price;
    const depthScore = Math.min(depthRatio * 500, 100);

    const symmetry = clamp(symmetryRaw * 100, 0, 100);
    const necklineQuality = clamp(necklineQualityRaw * 100, 0, 100);
    const quality = roundTo(symmetry * 0.30 + necklineQuality * 0.30 + depthScore * 0.40, 1);

    const necklineSlope = (P2.price - P1.price) / (P2.index - P1.index);
    const currentNeckline = P1.price + necklineSlope * (prices.length - 1 - P1.index);

    const currentPrice = prices[prices.length - 1];
    let phase: "forming" | "confirmed" = "forming";
    let completion = 0;
    if (currentPrice > currentNeckline) {
      phase = "confirmed";
      completion = clamp((currentPrice - currentNeckline) / patternHeight, 0, 1);
    }

    const target = roundTo(currentNeckline + patternHeight, 2);
    const phaseMultiplier = phase === "confirmed" ? 1.5 : 1.0;
    const confidenceBoost = roundTo(quality * TF_CONFIDENCE[tf] * phaseMultiplier, 1);

    return {
      type: "bullish",
      timeframe: tf,
      leftShoulder: roundTo(T1.price, 2),
      head: roundTo(T2.price, 2),
      rightShoulder: roundTo(T3.price, 2),
      neckline: roundTo(currentNeckline, 2),
      necklineSlope: roundTo(necklineSlope, 4),
      target,
      symmetry: roundTo(symmetry, 1),
      necklineQuality: roundTo(necklineQuality, 1),
      depth: roundTo(depthScore, 1),
      quality: roundTo(quality, 1),
      phase,
      completion: roundTo(completion, 3),
      confidenceBoost
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Single-Timeframe Detection
// ---------------------------------------------------------------------------

function detectOnTimeframe(
  rawPrices: number[],
  tf: HSTimeframe,
  order: number,
  minProminence: number
): HeadAndShouldersPattern | null {
  if (rawPrices.length < order * 6) return null;

  // Light smoothing to suppress 1-bar noise (use EMA(3))
  const smoothed = emaSeries(rawPrices, 3);
  if (smoothed.length < order * 6) return null;

  const peaks = findPeaks(smoothed, order, minProminence);
  const troughs = findTroughs(smoothed, order, minProminence);

  // Try bearish first (top H&S), then bullish (inverse)
  const bearish = scanBearishHS(rawPrices, peaks, troughs, tf);
  const bullish = scanBullishHS(rawPrices, peaks, troughs, tf);

  // Return the higher-quality pattern
  if (bearish && bullish) {
    return bearish.quality >= bullish.quality ? bearish : bullish;
  }
  return bearish ?? bullish;
}

// ---------------------------------------------------------------------------
// Multi-Timeframe H&S Detection (public API)
// ---------------------------------------------------------------------------

export function detectHeadAndShoulders(
  prices1m: number[],
  prices5m: number[],
  prices15m: number[]
): PatternResult {
  // Compute adaptive minimum prominence per timeframe
  // Based on realized volatility: peaks must be ≥ 1.5σ prominent
  const rv1m = realizedVol(logReturns(prices1m), Math.min(60, prices1m.length - 1));
  const price = prices1m[prices1m.length - 1];

  // 1m: order=5 (±5 bars), prominence scaled by √10 bars × vol
  const prom1m = Math.max(rv1m * price * Math.sqrt(10) * 1.5, 1);
  const p1m = detectOnTimeframe(prices1m, "1m", 5, prom1m);

  // 5m: order=3 (±3 bars ≈ ±15min), prominence scaled by √6 bars × vol_5m
  const rv5m = realizedVol(logReturns(prices5m), Math.min(30, prices5m.length - 1));
  const prom5m = Math.max(rv5m * price * Math.sqrt(6) * 1.5, 2);
  const p5m = detectOnTimeframe(prices5m, "5m", 3, prom5m);

  // 15m: order=3 (±3 bars ≈ ±45min), prominence scaled for 15m vol
  const rv15m = realizedVol(logReturns(prices15m), Math.min(20, prices15m.length - 1));
  const prom15m = Math.max(rv15m * price * Math.sqrt(6) * 1.5, 3);
  const p15m = detectOnTimeframe(prices15m, "15m", 3, prom15m);

  // Select the best pattern: prefer higher TF, then higher quality
  const candidates = [p15m, p5m, p1m].filter(Boolean) as HeadAndShouldersPattern[];

  if (candidates.length === 0) {
    return { headAndShoulders: null };
  }

  // Pick the one with highest confidence boost (quality × TF weight)
  let best = candidates[0];
  for (const c of candidates) {
    if (c.confidenceBoost > best.confidenceBoost) best = c;
  }

  // Multi-TF confirmation bonus: if pattern appears on 2+ timeframes, boost
  if (candidates.length >= 2) {
    const sameDirection = candidates.every(c => c.type === best.type);
    if (sameDirection) {
      best = { ...best, confidenceBoost: roundTo(best.confidenceBoost + 5, 1) };
    }
  }

  return { headAndShoulders: best };
}
