import assert from "node:assert/strict";
import test from "node:test";

import { analyzeGold } from "../analysis/engine.js";
import { buildDiscordPayload } from "./webhook.js";
import { Candle, DataSnapshot, SourceHealth } from "../data/types.js";

function sourceHealth(source: SourceHealth["source"], qualityScore: number, error?: string): SourceHealth {
  return {
    source,
    ok: qualityScore >= 60,
    lastUpdateMs: Date.now(),
    ageMs: qualityScore >= 60 ? 1_000 : Number.POSITIVE_INFINITY,
    latencyMs: 1,
    stale: qualityScore < 60,
    error,
    qualityScore
  };
}

function candles(): Candle[] {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  return Array.from({ length: 80 }, (_, i) => {
    const open = 2300 + i * 0.25;
    return {
      symbol: "GC=F",
      source: "yahoo",
      instrumentKind: "futures_proxy",
      timeframe: "1m",
      startMs: start + i * 60_000,
      endMs: start + (i + 1) * 60_000,
      open,
      high: open + 0.5,
      low: open - 0.5,
      close: open + 0.1,
      tickCount: 1,
      complete: true,
      qualityScore: 75,
      completenessRatio: 1
    };
  });
}

test("Yahoo fallback with missing optional sources does not mark primary degraded", () => {
  const m1 = candles();
  const yahoo = sourceHealth("yahoo", 75);
  const rithmic = sourceHealth("rithmic", 0, "RITHMIC_GC_JSONL_PATH not configured");
  const pepperstone = sourceHealth("pepperstone", 0, "PEPPERSTONE_XAU_JSONL_PATH not configured");
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
    activePrimaryHealth: yahoo,
    brokerHealth: pepperstone,
    optionalSourceHealth: [rithmic],
    sourceHealth: [rithmic, yahoo, pepperstone],
    futuresFlowStatus: "proxy-only",
    bars: { m1, m5: [], m15: [], h1: [] },
    barCoverage: {
      m1: m1.length,
      m5: 0,
      m15: 0,
      h1: 0,
      m1CompleteRatio: 1,
      m5CompleteRatio: 0,
      m15CompleteRatio: 0,
      h1CompleteRatio: 0
    }
  };

  const payload = buildDiscordPayload(analyzeGold(snapshot)) as {
    embeds: Array<{ title: string; footer: { text: string } }>;
  };

  assert.match(payload.embeds[0].title, /FALLBACK DATA/);
  assert.match(payload.embeds[0].title, /BROKER QUOTE MISSING/);
  assert.doesNotMatch(payload.embeds[0].title, /PRIMARY DATA DEGRADED/);
  assert.match(payload.embeds[0].footer.text, /optionalSourceHealth=rithmic:missing/);
});

test("Broker primary payload marks futures flow unknown without claiming futures confirmation", () => {
  const m1 = candles().map((candle) => ({
    ...candle,
    symbol: "XAUUSD",
    source: "pepperstone" as const,
    instrumentKind: "broker_spot" as const
  }));
  const pepperstone = sourceHealth("pepperstone", 90);
  const yahoo = sourceHealth("yahoo", 0, "Yahoo reference unavailable");
  const rithmic = sourceHealth("rithmic", 0, "RITHMIC_GC_JSONL_PATH not configured");
  const last = m1[m1.length - 1];
  const snapshot: DataSnapshot = {
    asOfMs: last.endMs,
    primary: {
      symbol: "XAUUSD",
      source: "pepperstone",
      instrumentKind: "broker_spot",
      timestampMs: last.endMs,
      price: last.close,
      fallback: false
    },
    gcTick: null,
    gcCandle: null,
    xauBrokerTick: {
      symbol: "XAUUSD",
      source: "pepperstone",
      instrumentKind: "broker_spot",
      timestampMs: last.endMs,
      bid: last.close - 0.1,
      ask: last.close + 0.1,
      mid: last.close
    },
    basis: { available: false, brokerSpread: 0.2 },
    activePrimaryHealth: pepperstone,
    brokerHealth: pepperstone,
    optionalSourceHealth: [rithmic, yahoo],
    sourceHealth: [rithmic, yahoo, pepperstone],
    futuresFlowStatus: "unknown",
    bars: { m1, m5: [], m15: [], h1: [] },
    barCoverage: {
      m1: m1.length,
      m5: 0,
      m15: 0,
      h1: 0,
      m1CompleteRatio: 1,
      m5CompleteRatio: 0,
      m15CompleteRatio: 0,
      h1CompleteRatio: 0
    }
  };

  const payload = buildDiscordPayload(analyzeGold(snapshot)) as {
    embeds: Array<{ title: string; description: string; fields: Array<{ value: string }>; footer: { text: string } }>;
  };
  const embedText = JSON.stringify(payload.embeds[0]);

  assert.match(payload.embeds[0].title, /BROKER PRIMARY/);
  assert.match(payload.embeds[0].title, /FUTURES FLOW UNKNOWN/);
  assert.doesNotMatch(embedText, /Rithmic\+Pepperstone/);
  assert.doesNotMatch(embedText, /Tradovate/);
  assert.doesNotMatch(embedText, /confirmed flow/i);
  assert.match(payload.embeds[0].footer.text, /mode=broker-primary/);
  assert.match(payload.embeds[0].footer.text, /futuresFlow=unknown/);
});
