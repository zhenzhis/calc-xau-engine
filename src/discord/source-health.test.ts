import assert from "node:assert/strict";
import test from "node:test";

import { analyzeGold } from "../analysis/engine.js";
import { buildDiscordPayload } from "./webhook.js";
import { Candle, DataSnapshot, InstrumentKind, SourceHealth } from "../data/types.js";

function sourceHealth(
  source: SourceHealth["source"],
  qualityScore: number,
  error?: string,
  extra: Partial<SourceHealth> = {}
): SourceHealth {
  return {
    source,
    ok: qualityScore >= 60 && extra.testData !== true,
    lastUpdateMs: Date.now(),
    ageMs: qualityScore >= 60 || extra.testData === true ? 1_000 : Number.POSITIVE_INFINITY,
    latencyMs: 1,
    stale: extra.stale ?? (qualityScore < 60 && extra.testData !== true),
    error,
    qualityScore,
    ...extra
  };
}

function candles(options: {
  base?: number;
  symbol?: string;
  source?: Candle["source"];
  instrumentKind?: InstrumentKind;
  qualityScore?: number;
} = {}): Candle[] {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const base = options.base ?? 2300;
  return Array.from({ length: 80 }, (_, i) => {
    const open = base + i * 0.25;
    return {
      symbol: options.symbol ?? "GC=F",
      source: options.source ?? "yahoo",
      instrumentKind: options.instrumentKind ?? "futures_proxy",
      timeframe: "1m",
      startMs: start + i * 60_000,
      endMs: start + (i + 1) * 60_000,
      open,
      high: open + 0.5,
      low: open - 0.5,
      close: open + 0.1,
      tickCount: 1,
      complete: true,
      qualityScore: options.qualityScore ?? 75,
      completenessRatio: 1
    };
  });
}

function brokerSnapshot(options: {
  base?: number;
  testData?: boolean;
  dailyChangePct?: number;
  includeBasisSpread?: boolean;
} = {}): DataSnapshot {
  const m1 = candles({
    base: options.base ?? 4700,
    symbol: "XAUUSD",
    source: "pepperstone",
    instrumentKind: "broker_spot",
    qualityScore: options.testData ? 20 : 90
  });
  const last = m1[m1.length - 1];
  const bid = Number((last.close - 0.1).toFixed(2));
  const ask = Number((last.close + 0.1).toFixed(2));
  const provenance = options.testData
    ? { feed: "synthetic_test", sidecar: "test-generator", sessionVerified: false, testData: true }
    : { feed: "ctrader_fix", sidecar: "pepperstone-ctrader-fix", sessionVerified: true, testData: false };
  const pepperstone = sourceHealth(
    "pepperstone",
    options.testData ? 20 : 90,
    options.testData ? "synthetic/test Pepperstone feed" : undefined,
    provenance
  );
  const primary = {
    symbol: "XAUUSD",
    source: "pepperstone" as const,
    instrumentKind: "broker_spot" as const,
    timestampMs: last.endMs,
    price: last.close,
    fallback: false,
    ...(options.dailyChangePct !== undefined ? { dailyChangePct: options.dailyChangePct } : {})
  };

  return {
    asOfMs: last.endMs,
    primary,
    gcTick: null,
    gcCandle: null,
    xauBrokerTick: {
      symbol: "XAUUSD",
      source: "pepperstone",
      instrumentKind: "broker_spot",
      timestampMs: last.endMs,
      bid,
      ask,
      mid: last.close,
      qualityScore: options.testData ? 20 : 90,
      ...provenance
    },
    basis: options.includeBasisSpread ? { available: false, brokerSpread: 0.2 } : { available: false },
    activePrimaryHealth: pepperstone,
    brokerHealth: pepperstone,
    optionalSourceHealth: [
      sourceHealth("rithmic", 0, "RITHMIC_GC_JSONL_PATH not configured"),
      sourceHealth("yahoo", 0, "Yahoo reference unavailable")
    ],
    sourceHealth: [
      sourceHealth("rithmic", 0, "RITHMIC_GC_JSONL_PATH not configured"),
      sourceHealth("yahoo", 0, "Yahoo reference unavailable"),
      pepperstone
    ],
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
}

function payloadFor(snapshot: DataSnapshot) {
  return buildDiscordPayload(analyzeGold(snapshot)) as {
    embeds: Array<{ title: string; description: string; fields: Array<{ name: string; value: string }>; footer: { text: string } }>;
  };
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

  const payload = payloadFor(snapshot);

  assert.match(payload.embeds[0].title, /FALLBACK DATA/);
  assert.match(payload.embeds[0].title, /BROKER QUOTE MISSING/);
  assert.doesNotMatch(payload.embeds[0].title, /PRIMARY DATA DEGRADED/);
  assert.match(payload.embeds[0].footer.text, /optionalSourceHealth=rithmic:missing/);
});

test("Broker primary payload marks futures flow unknown without claiming futures confirmation", () => {
  const payload = payloadFor(brokerSnapshot({ base: 4700, includeBasisSpread: true, dailyChangePct: 0.12 }));
  const embedText = JSON.stringify(payload.embeds[0]);

  assert.match(payload.embeds[0].title, /BROKER PRIMARY/);
  assert.match(payload.embeds[0].title, /FUTURES FLOW UNKNOWN/);
  assert.doesNotMatch(embedText, /Rithmic\+Pepperstone/);
  assert.doesNotMatch(embedText, /Tradovate/);
  assert.doesNotMatch(embedText, /confirmed flow/i);
  assert.match(payload.embeds[0].footer.text, /mode=broker-primary/);
  assert.match(payload.embeds[0].footer.text, /futuresFlow=unknown/);
});

test("Synthetic Pepperstone feed is marked test data and blocks trade permission", () => {
  const snapshot = brokerSnapshot({ base: 2350, testData: true });
  const analysis = analyzeGold(snapshot);
  const payload = buildDiscordPayload(analysis) as { embeds: Array<{ title: string }> };

  assert.ok(snapshot.activePrimaryHealth.qualityScore <= 20);
  assert.equal(analysis.eventRisk.tradePermission, "blocked");
  assert.equal(analysis.signal.direction, "FLAT");
  assert.ok(analysis.confidence <= 10);
  assert.match(payload.embeds[0].title, /TEST DATA/);
  assert.match(payload.embeds[0].title, /NO-TRADE/);
});

test("Broker spread displays from bid ask when broker basis is disabled", () => {
  const payload = payloadFor(brokerSnapshot({ base: 4700, includeBasisSpread: false, dailyChangePct: 0.12 }));

  assert.match(payload.embeds[0].description, /spread=\$0\.20/);
  assert.match(payload.embeds[0].description, /basis=unavailable/);
});

test("Out-of-range level grid disables level based setup", () => {
  const analysis = analyzeGold(brokerSnapshot({ base: 2350, dailyChangePct: 0.12 }));
  const payload = buildDiscordPayload(analysis) as {
    embeds: Array<{ title: string; fields: Array<{ name: string; value: string }> }>;
  };
  const setup = payload.embeds[0].fields.find((field) => field.name === "Setup")?.value ?? "";
  const levels = payload.embeds[0].fields.find((field) => field.name === "Key Levels")?.value ?? "";

  assert.equal(analysis.levelGridStatus, "out-of-range");
  assert.equal(analysis.nearestResistance, null);
  assert.equal(analysis.nearestSupport, null);
  assert.equal(analysis.signal.direction, "FLAT");
  assert.doesNotMatch(payload.embeds[0].title, /SHORT-REJECTION|LONG-PULLBACK/);
  assert.match(levels, /Level grid out of range/);
  assert.match(setup, /manual level grid invalid for current price regime/);
  assert.doesNotMatch(setup, /4882/);
});

test("Broker primary with unknown futures and macro remains non-actionable", () => {
  const analysis = analyzeGold(brokerSnapshot({ base: 4700, dailyChangePct: 0.12 }));

  assert.equal(analysis.eventRisk.tradePermission, "watch-only");
  assert.equal(analysis.signal.direction, "FLAT");
  assert.ok(analysis.confidence <= 35);
});

test("Undefined dailyChangePct displays n/a instead of zero percent", () => {
  const payload = payloadFor(brokerSnapshot({ base: 4700 }));

  assert.match(payload.embeds[0].description, /change=n\/a/);
  assert.doesNotMatch(payload.embeds[0].description, /change=\+0\.00%/);
});
