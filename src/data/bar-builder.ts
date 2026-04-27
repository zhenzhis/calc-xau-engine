import { Candle, DataSourceName, InstrumentKind, MarketTick, Timeframe } from "./types.js";

const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000
};

export function timeframeMs(timeframe: Timeframe): number {
  return TIMEFRAME_MS[timeframe];
}

function expectedOneMinuteChildCount(timeframe: "5m" | "15m" | "1h"): number {
  return timeframeMs(timeframe) / timeframeMs("1m");
}

export function bucketStartMs(timestampMs: number, timeframe: Timeframe): number {
  const size = timeframeMs(timeframe);
  return Math.floor(timestampMs / size) * size;
}

function tickPrice(tick: MarketTick): number {
  if (Number.isFinite(tick.mid)) return tick.mid;
  if (tick.last !== undefined && Number.isFinite(tick.last)) return tick.last;
  if (tick.bid !== undefined && tick.ask !== undefined) return (tick.bid + tick.ask) / 2;
  throw new Error(`Tick has no usable price: ${tick.symbol} ${tick.timestampMs}`);
}

export function buildCandlesFromTicks(
  ticks: MarketTick[],
  timeframe: Timeframe = "1m",
  nowMs = Date.now()
): Candle[] {
  if (ticks.length === 0) return [];

  const sorted = ticks
    .filter((tick) => Number.isFinite(tick.timestampMs))
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const grouped = new Map<number, MarketTick[]>();
  for (const tick of sorted) {
    const bucket = bucketStartMs(tick.timestampMs, timeframe);
    const group = grouped.get(bucket);
    if (group) group.push(tick);
    else grouped.set(bucket, [tick]);
  }

  const candles: Candle[] = [];
  for (const [startMs, group] of grouped) {
    const first = group[0];
    const prices = group.map(tickPrice);
    const volumeTicks = group.filter((tick) => tick.volume !== undefined);
    const volume =
      volumeTicks.length > 0
        ? volumeTicks.reduce((sum, tick) => sum + (tick.volume ?? 0), 0)
        : undefined;
    const weighted =
      volume !== undefined && volume > 0
        ? group.reduce((sum, tick) => sum + tickPrice(tick) * (tick.volume ?? 0), 0) / volume
        : undefined;

    candles.push({
      symbol: first.symbol,
      source: first.source,
      instrumentKind: first.instrumentKind,
      timeframe,
      startMs,
      endMs: startMs + timeframeMs(timeframe),
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume,
      tickCount: group.length,
      vwap: weighted,
      complete: startMs + timeframeMs(timeframe) <= nowMs,
      qualityScore: Math.min(...group.map((tick) => tick.qualityScore ?? 100)),
      completenessRatio: 1
    });
  }

  return candles.sort((a, b) => a.startMs - b.startMs);
}

export function normalizeOneMinuteCandles(candles: Candle[], nowMs = Date.now()): Candle[] {
  return candles
    .filter((candle) => candle.timeframe === "1m")
    .map((candle) => {
      const startMs = bucketStartMs(candle.startMs, "1m");
      return {
        ...candle,
        startMs,
        endMs: startMs + timeframeMs("1m"),
        tickCount: Math.max(1, candle.tickCount),
        complete: candle.complete && startMs + timeframeMs("1m") <= nowMs
      };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

export function aggregateCandles(
  candles: Candle[],
  timeframe: "5m" | "15m" | "1h",
  nowMs = Date.now()
): Candle[] {
  if (candles.length === 0) return [];

  const grouped = new Map<number, Candle[]>();
  const sorted = candles.slice().sort((a, b) => a.startMs - b.startMs);

  for (const candle of sorted) {
    const bucket = bucketStartMs(candle.startMs, timeframe);
    const group = grouped.get(bucket);
    if (group) group.push(candle);
    else grouped.set(bucket, [candle]);
  }

  const result: Candle[] = [];
  for (const [startMs, group] of grouped) {
    const ordered = group.slice().sort((a, b) => a.startMs - b.startMs);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const completeness = computeBarCompleteness(ordered, timeframe, startMs);
    const volumeParts = ordered.filter((candle) => candle.volume !== undefined);
    const volume =
      volumeParts.length > 0
        ? volumeParts.reduce((sum, candle) => sum + (candle.volume ?? 0), 0)
        : undefined;
    const vwap =
      volume !== undefined && volume > 0
        ? ordered.reduce((sum, candle) => {
            const weight = candle.volume ?? 0;
            return sum + (candle.vwap ?? candle.close) * weight;
          }, 0) / volume
        : undefined;

    result.push({
      symbol: first.symbol,
      source: first.source as DataSourceName,
      instrumentKind: first.instrumentKind as InstrumentKind,
      timeframe,
      startMs,
      endMs: startMs + timeframeMs(timeframe),
      open: first.open,
      high: Math.max(...ordered.map((candle) => candle.high)),
      low: Math.min(...ordered.map((candle) => candle.low)),
      close: last.close,
      volume,
      tickCount: ordered.reduce((sum, candle) => sum + candle.tickCount, 0),
      vwap,
      complete:
        completeness.complete &&
        ordered.every((candle) => candle.complete) &&
        startMs + timeframeMs(timeframe) <= nowMs,
      qualityScore: Math.round(Math.min(...ordered.map((candle) => candle.qualityScore)) * completeness.completenessRatio),
      completenessRatio: completeness.completenessRatio
    });
  }

  return result.sort((a, b) => a.startMs - b.startMs);
}

export function computeBarCompleteness(
  oneMinuteCandles: Candle[],
  timeframe: "5m" | "15m" | "1h",
  bucketStartMsValue?: number
): { expectedCount: number; actualCount: number; completenessRatio: number; continuous: boolean; complete: boolean } {
  const expectedCount = expectedOneMinuteChildCount(timeframe);
  if (oneMinuteCandles.length === 0) {
    return { expectedCount, actualCount: 0, completenessRatio: 0, continuous: false, complete: false };
  }

  const startMs = bucketStartMsValue ?? bucketStartMs(oneMinuteCandles[0].startMs, timeframe);
  const starts = new Set(oneMinuteCandles.map((candle) => candle.startMs));
  let actualCount = 0;
  for (let i = 0; i < expectedCount; i++) {
    if (starts.has(startMs + i * timeframeMs("1m"))) actualCount++;
  }

  const ordered = oneMinuteCandles.slice().sort((a, b) => a.startMs - b.startMs);
  const continuous =
    ordered.length === expectedCount &&
    ordered.every((candle, index) => candle.startMs === startMs + index * timeframeMs("1m"));
  const completenessRatio = actualCount / expectedCount;

  return {
    expectedCount,
    actualCount,
    completenessRatio,
    continuous,
    complete: completenessRatio === 1 && continuous
  };
}
