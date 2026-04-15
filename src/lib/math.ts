// ---------------------------------------------------------------------------
// Core math primitives for quantitative gold analysis
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Moving Averages
// ---------------------------------------------------------------------------

/** Simple Moving Average over the last `period` values. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Exponential Moving Average.
 * Processes entire array and returns the final EMA value.
 * Smoothing factor: α = 2 / (period + 1)
 */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;

  // Seed with SMA of first `period` values
  let result = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const alpha = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    result = alpha * values[i] + (1 - alpha) * result;
  }

  return result;
}

/**
 * Full EMA series (returns an array of EMA values for each point after warm-up).
 */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];

  const alpha = 2 / (period + 1);
  let current = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const result: number[] = [current];

  for (let i = period; i < values.length; i++) {
    current = alpha * values[i] + (1 - alpha) * current;
    result.push(current);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------------

/** Population standard deviation of the last `period` values. */
export function stddev(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

/**
 * Pseudo-ATR computed from price changes (no OHLC needed).
 * Uses absolute price changes over `period` intervals.
 */
export function pseudoAtr(values: number[], period: number): number | null {
  if (values.length < period + 1) return null;
  const changes: number[] = [];
  for (let i = values.length - period; i < values.length; i++) {
    changes.push(Math.abs(values[i] - values[i - 1]));
  }
  return changes.reduce((s, v) => s + v, 0) / changes.length;
}

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

/** RSI (Relative Strength Index) — Wilder's smoothing. */
export function rsi(values: number[], period: number): number | null {
  if (values.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial averages
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth with Wilder's method
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Rate of change: (current - past) / past */
export function roc(values: number[], lookback: number): number | null {
  if (values.length <= lookback) return null;
  const current = values[values.length - 1];
  const past = values[values.length - 1 - lookback];
  return past === 0 ? 0 : (current - past) / past;
}

// ---------------------------------------------------------------------------
// Statistical
// ---------------------------------------------------------------------------

/** Z-score of the latest value relative to the last `period` values. */
export function zScore(values: number[], period: number): number | null {
  const sd = stddev(values, period);
  const mean = sma(values, period);
  if (sd === null || mean === null || sd === 0) return null;
  return (values[values.length - 1] - mean) / sd;
}

/**
 * Hurst exponent approximation (R/S analysis, simplified).
 * H > 0.5 → trending, H < 0.5 → mean-reverting, H ≈ 0.5 → random walk.
 */
export function hurstExponent(values: number[], minWindow?: number): number | null {
  const n = values.length;
  if (n < 20) return null;

  const windowSizes = [8, 16, 32, 64].filter((w) => w <= n / 2);
  if (windowSizes.length < 2) return null;

  const logRS: Array<{ logN: number; logR: number }> = [];

  for (const w of windowSizes) {
    const rsValues: number[] = [];
    const numWindows = Math.floor(n / w);

    for (let i = 0; i < numWindows; i++) {
      const slice = values.slice(i * w, (i + 1) * w);
      const mean = slice.reduce((s, v) => s + v, 0) / w;
      const deviations = slice.map((v) => v - mean);

      // Cumulative deviation series
      let cumSum = 0;
      let maxCum = -Infinity;
      let minCum = Infinity;
      for (const d of deviations) {
        cumSum += d;
        maxCum = Math.max(maxCum, cumSum);
        minCum = Math.min(minCum, cumSum);
      }

      const range = maxCum - minCum;
      const sd = Math.sqrt(deviations.reduce((s, d) => s + d * d, 0) / w);
      if (sd > 0) {
        rsValues.push(range / sd);
      }
    }

    if (rsValues.length > 0) {
      const avgRS = rsValues.reduce((s, v) => s + v, 0) / rsValues.length;
      logRS.push({ logN: Math.log(w), logR: Math.log(avgRS) });
    }
  }

  if (logRS.length < 2) return null;

  // Linear regression: logR = H * logN + c
  const n2 = logRS.length;
  const sumX = logRS.reduce((s, p) => s + p.logN, 0);
  const sumY = logRS.reduce((s, p) => s + p.logR, 0);
  const sumXY = logRS.reduce((s, p) => s + p.logN * p.logR, 0);
  const sumX2 = logRS.reduce((s, p) => s + p.logN ** 2, 0);

  const denom = n2 * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  return clamp((n2 * sumXY - sumX * sumY) / denom, 0, 1);
}

/**
 * Approximate CDF of standard normal distribution.
 * Abramowitz and Stegun approximation (error < 7.5e-8).
 */
export function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1 + sign * y);
}

/** Sigmoid function: 1 / (1 + exp(-k * (x - x0))) */
export function sigmoid(x: number, k: number, x0: number): number {
  return 1 / (1 + Math.exp(-k * (x - x0)));
}

// ---------------------------------------------------------------------------
// Returns-Based Analysis — institutional standard
// ---------------------------------------------------------------------------

/** Log returns: r_t = ln(P_t / P_{t-1}). Foundational for all vol/momentum. */
export function logReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      r.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return r;
}

/**
 * Realized volatility from returns (sample stddev).
 * NOT annualized — caller must scale by sqrt(periods_per_year) if needed.
 */
export function realizedVol(returns: number[], window?: number): number {
  const s = window !== undefined ? returns.slice(-window) : returns;
  if (s.length < 2) return 0;
  const mu = s.reduce((a, r) => a + r, 0) / s.length;
  const v = s.reduce((a, r) => a + (r - mu) ** 2, 0) / (s.length - 1);
  return Math.sqrt(v);
}

/**
 * Variance Ratio VR(q) — Lo-MacKinlay (1988).
 * Compares q-period return variance to q × 1-period return variance.
 *   VR > 1 → positive serial correlation (trending / momentum)
 *   VR < 1 → negative serial correlation (mean-reverting)
 *   VR ≈ 1 → random walk
 */
export function varianceRatio(prices: number[], q: number): number | null {
  if (prices.length < q * 3) return null;

  const r1: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) r1.push(Math.log(prices[i] / prices[i - 1]));
  }

  const rq: number[] = [];
  for (let i = q; i < prices.length; i++) {
    if (prices[i - q] > 0) rq.push(Math.log(prices[i] / prices[i - q]));
  }

  if (r1.length < 2 || rq.length < 2) return null;

  const mu1 = r1.reduce((s, r) => s + r, 0) / r1.length;
  const muQ = rq.reduce((s, r) => s + r, 0) / rq.length;
  const var1 = r1.reduce((s, r) => s + (r - mu1) ** 2, 0) / (r1.length - 1);
  const varQ = rq.reduce((s, r) => s + (r - muQ) ** 2, 0) / (rq.length - 1);

  if (var1 === 0) return null;
  return varQ / (q * var1);
}

/**
 * Autocorrelation at lag k.
 * ρ(k) = Cov(x_t, x_{t-k}) / Var(x_t).
 * Positive → persistence, negative → reversion.
 */
export function autoCorrelation(series: number[], lag: number): number | null {
  if (series.length < lag + 3) return null;

  const n = series.length;
  const mu = series.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += (series[i] - mu) ** 2;
    if (i >= lag) {
      num += (series[i] - mu) * (series[i - lag] - mu);
    }
  }

  return den === 0 ? null : num / den;
}

/**
 * Kaufman Adaptive Moving Average (KAMA).
 * Adapts smoothing based on Efficiency Ratio: fast in trends, slow in noise.
 * Superior to fixed-period EMA for non-stationary data.
 */
export function kama(
  prices: number[],
  erPeriod = 10,
  fastPeriod = 2,
  slowPeriod = 30
): number | null {
  if (prices.length < erPeriod + 1) return null;

  const fastSC = 2 / (fastPeriod + 1);
  const slowSC = 2 / (slowPeriod + 1);

  let value = prices[erPeriod];

  for (let i = erPeriod + 1; i < prices.length; i++) {
    const direction = Math.abs(prices[i] - prices[i - erPeriod]);
    let noise = 0;
    for (let j = i - erPeriod + 1; j <= i; j++) {
      noise += Math.abs(prices[j] - prices[j - 1]);
    }

    const er = noise > 0 ? direction / noise : 0;
    const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
    value += sc * (prices[i] - value);
  }

  return value;
}

/**
 * Downsample by taking every Nth point, aligned to the latest value.
 * For multi-timeframe analysis: resample(prices, 5) → 5-minute bars.
 */
export function resample(values: number[], factor: number): number[] {
  if (factor <= 1 || values.length < factor) return values.slice();

  const result: number[] = [];
  const startOffset = (values.length - 1) % factor;
  for (let i = startOffset; i < values.length; i += factor) {
    result.push(values[i]);
  }
  return result;
}

/**
 * Bollinger Bands — bandwidth and %B.
 * Low bandwidth → squeeze → imminent breakout.
 * %B > 1 → above upper band (overbought), %B < 0 → below lower (oversold).
 */
export function bollingerBands(
  prices: number[],
  period = 20,
  mult = 2
): { width: number; percentB: number; upper: number; lower: number; middle: number } | null {
  if (prices.length < period) return null;

  const slice = prices.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const sd = Math.sqrt(slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period);

  const upper = middle + mult * sd;
  const lower = middle - mult * sd;
  const price = prices[prices.length - 1];

  const width = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
  const percentB = upper !== lower ? (price - lower) / (upper - lower) : 0.5;

  return { width, percentB, upper, lower, middle };
}

/**
 * Linear regression slope, normalized by mean (relative rate per bar).
 * Robust trend-strength measure: positive → uptrend, negative → downtrend.
 */
export function linRegSlope(values: number[]): number | null {
  const n = values.length;
  if (n < 3) return null;

  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  return (n * sumXY - sumX * sumY) / denom / mean;
}
