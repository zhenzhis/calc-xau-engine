import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { aggregateCandles, buildCandlesFromTicks } from "./bar-builder.js";
import { MarketTick } from "./types.js";
import { RithmicFileProvider } from "./providers/rithmic-file-provider.js";
import { RuntimeConfig } from "../types.js";

function tick(timestampMs: number, mid: number, volume = 1): MarketTick {
  return {
    symbol: "GC",
    source: "rithmic",
    instrumentKind: "futures",
    timestampMs,
    mid,
    last: mid,
    volume
  };
}

test("aligns ticks into canonical 1m buckets", () => {
  const candles = buildCandlesFromTicks([
    tick(60_100, 10),
    tick(60_500, 12),
    tick(119_900, 11),
    tick(120_000, 13)
  ], "1m", 180_000);

  assert.equal(candles.length, 2);
  assert.equal(candles[0].startMs, 60_000);
  assert.equal(candles[0].open, 10);
  assert.equal(candles[0].high, 12);
  assert.equal(candles[0].low, 10);
  assert.equal(candles[0].close, 11);
  assert.equal(candles[0].tickCount, 3);
  assert.equal(candles[1].startMs, 120_000);
});

test("aggregates 5m OHLCV from real candle high low open close", () => {
  const oneMinute = buildCandlesFromTicks([
    tick(0, 100, 2),
    tick(60_000, 102, 3),
    tick(120_000, 99, 4),
    tick(180_000, 105, 5),
    tick(240_000, 101, 6)
  ], "1m", 300_000);
  oneMinute[1] = { ...oneMinute[1], high: 108, low: 98, close: 102 };

  const fiveMinute = aggregateCandles(oneMinute, "5m", 300_000);
  assert.equal(fiveMinute.length, 1);
  assert.equal(fiveMinute[0].open, 100);
  assert.equal(fiveMinute[0].high, 108);
  assert.equal(fiveMinute[0].low, 98);
  assert.equal(fiveMinute[0].close, 101);
  assert.equal(fiveMinute[0].volume, 20);
  assert.equal(fiveMinute[0].tickCount, 5);
});

test("marks stale Rithmic file source explicitly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-rithmic-"));
  const path = join(dir, "gc.jsonl");
  const staleTs = Date.now() - 60_000;
  await writeFile(path, `${JSON.stringify({
    timestampMs: staleTs,
    symbol: "GC",
    contract: "GCM6",
    bid: 2350.1,
    ask: 2350.2,
    last: 2350.1,
    volume: 12
  })}\n`, "utf8");

  const config = {
    rithmicGcJsonlPath: path,
    maxTickAgeMs: 15_000,
    maxCandleAgeMs: 120_000
  } as RuntimeConfig;
  const provider = new RithmicFileProvider(config);
  await provider.fetchLatestTick();
  const health = provider.getHealth();
  assert.equal(health.source, "rithmic");
  assert.equal(health.stale, true);
  assert.equal(health.ok, false);
  assert.equal(health.qualityScore, 40);

  await rm(dir, { recursive: true, force: true });
});
