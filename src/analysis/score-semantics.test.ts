import assert from "node:assert/strict";
import test from "node:test";

import { analyzeGold } from "./engine.js";
import { buildDiscordPayload } from "../discord/webhook.js";
import { Candle, DataSnapshot, SourceHealth } from "../data/types.js";

function health(source: SourceHealth["source"], qualityScore: number): SourceHealth {
  return {
    source,
    ok: qualityScore >= 60,
    lastUpdateMs: Date.now(),
    ageMs: 1_000,
    latencyMs: 1,
    stale: false,
    qualityScore
  };
}

function candles(): Candle[] {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  return Array.from({ length: 80 }, (_, i) => {
    const open = 2300 + i * 0.5;
    return {
      symbol: "GC=F",
      source: "yahoo",
      instrumentKind: "futures_proxy",
      timeframe: "1m",
      startMs: start + i * 60_000,
      endMs: start + (i + 1) * 60_000,
      open,
      high: open + 1,
      low: open - 1,
      close: open + 0.25,
      tickCount: 1,
      complete: true,
      qualityScore: 75
    };
  });
}

test("Discord payload labels breakout values as scores, not probabilities", () => {
  const m1 = candles();
  const snapshot: DataSnapshot = {
    asOfMs: m1[m1.length - 1].endMs,
    primary: {
      symbol: "GC=F",
      source: "yahoo",
      instrumentKind: "futures_proxy",
      timestampMs: m1[m1.length - 1].endMs,
      price: m1[m1.length - 1].close,
      fallback: true
    },
    gcTick: null,
    gcCandle: m1[m1.length - 1],
    xauBrokerTick: null,
    basis: { available: false },
    sourceHealth: [health("yahoo", 75), health("rithmic", 0), health("pepperstone", 0)],
    bars: { m1, m5: [], m15: [], h1: [] },
    barCoverage: { m1: m1.length, m5: 0, m15: 0, h1: 0 }
  };
  const analysis = analyzeGold(snapshot);
  const payload = JSON.stringify(buildDiscordPayload(analysis));

  assert.match(payload, /scores=uncalibrated/);
  assert.match(payload, /Breakout scores/);
  assert.doesNotMatch(payload, /P\(↑\)|P\(↓\)|probability|Probability|胜率/);
});
