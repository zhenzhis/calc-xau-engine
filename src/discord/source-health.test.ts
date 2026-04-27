import assert from "node:assert/strict";
import test from "node:test";

import { analyzeGold } from "../analysis/engine.js";
import { buildDiscordPayload } from "./webhook.js";
import { aggregateCandles } from "../data/bar-builder.js";
import { Candle, DataSnapshot, InstrumentKind, SourceHealth } from "../data/types.js";
import { emptyMacroDrivers } from "../macro/types.js";

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
  count?: number;
  step?: number;
} = {}): Candle[] {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const base = options.base ?? 2300;
  const count = options.count ?? 240;
  const step = options.step ?? 0.25;
  return Array.from({ length: count }, (_, i) => {
    const open = base + i * step;
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
  count?: number;
  step?: number;
  spread?: number;
  futuresFlowStatus?: DataSnapshot["futuresFlowStatus"];
  m5CompleteRatio?: number;
  m15CompleteRatio?: number;
  activeQuality?: number;
  stale?: boolean;
} = {}): DataSnapshot {
  const m1 = candles({
    base: options.base ?? 4700,
    symbol: "XAUUSD",
    source: "pepperstone",
    instrumentKind: "broker_spot",
    qualityScore: options.testData ? 20 : options.activeQuality ?? 90,
    count: options.count,
    step: options.step
  });
  const last = m1[m1.length - 1];
  const spread = options.spread ?? 0.2;
  const bid = Number((last.close - spread / 2).toFixed(2));
  const ask = Number((last.close + spread / 2).toFixed(2));
  const provenance = options.testData
    ? { feed: "synthetic_test", sidecar: "test-generator", sessionVerified: false, testData: true }
    : { feed: "ctrader_fix", sidecar: "pepperstone-ctrader-fix", sessionVerified: true, testData: false };
  const wideSpread = spread > 5;
  const pepperstone = sourceHealth(
    "pepperstone",
    options.testData ? 20 : wideSpread ? 50 : options.activeQuality ?? 90,
    options.testData ? "synthetic/test Pepperstone feed" : undefined,
    { ...provenance, stale: options.stale ?? false, warning: wideSpread ? "broker spread wide" : undefined }
  );
  const m5 = aggregateCandles(m1, "5m");
  const m15 = aggregateCandles(m1, "15m");
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
      qualityScore: options.testData ? 20 : wideSpread ? 50 : options.activeQuality ?? 90,
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
    futuresFlowStatus: options.futuresFlowStatus ?? "unknown",
    qualityPolicy: { minSourceQuality: 60, maxBrokerSpread: 5 },
    bars: { m1, m5, m15, h1: [] },
    barCoverage: {
      m1: m1.length,
      m5: m5.length,
      m15: m15.length,
      h1: 0,
      m1CompleteRatio: 1,
      m5CompleteRatio: options.m5CompleteRatio ?? 1,
      m15CompleteRatio: options.m15CompleteRatio ?? 1,
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
  assert.equal(analysis.recommendationLevel, "no-trade");
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
  assert.equal(analysis.recommendationLevel, "watch-only");
  assert.equal(analysis.signal.direction, "FLAT");
  assert.ok(analysis.confidence <= 35);
});

test("Undefined dailyChangePct displays n/a instead of zero percent", () => {
  const payload = payloadFor(brokerSnapshot({ base: 4700 }));

  assert.match(payload.embeds[0].description, /change=n\/a/);
  assert.doesNotMatch(payload.embeds[0].description, /change=\+0\.00%/);
});

test("Wide broker spread is no-trade and marked in the title", () => {
  const analysis = analyzeGold(brokerSnapshot({ base: 4700, spread: 6, dailyChangePct: 0.12 }));
  const payload = buildDiscordPayload(analysis) as { embeds: Array<{ title: string; footer: { text: string } }> };

  assert.equal(analysis.recommendationLevel, "no-trade");
  assert.equal(analysis.signal.direction, "FLAT");
  assert.match(payload.embeds[0].title, /SPREAD WIDE/);
  assert.match(payload.embeds[0].footer.text, /warning=broker spread wide/);
});

test("Insufficient 1m sample caps recommendation and confidence", () => {
  const noTrade = analyzeGold(brokerSnapshot({
    base: 4700,
    count: 100,
    futuresFlowStatus: "confirmed",
    dailyChangePct: 0.12
  }), {
    macroDrivers: { ...emptyMacroDrivers(), macroBias: "bullish-gold" }
  });
  const watchOnly = analyzeGold(brokerSnapshot({
    base: 4700,
    count: 180,
    futuresFlowStatus: "confirmed",
    dailyChangePct: 0.12
  }), {
    macroDrivers: { ...emptyMacroDrivers(), macroBias: "bullish-gold" }
  });

  assert.equal(noTrade.recommendationLevel, "no-trade");
  assert.equal(watchOnly.recommendationLevel, "watch-only");
  assert.ok(noTrade.confidence <= 40);
  assert.ok(watchOnly.confidence <= 40);
});

test("Poor m5 or m15 completeness keeps recommendation watch-only", () => {
  const analysis = analyzeGold(brokerSnapshot({
    base: 4700,
    futuresFlowStatus: "confirmed",
    m5CompleteRatio: 0.85,
    m15CompleteRatio: 0.95,
    dailyChangePct: 0.12
  }), {
    macroDrivers: { ...emptyMacroDrivers(), macroBias: "bullish-gold" }
  });

  assert.equal(analysis.recommendationLevel, "watch-only");
  assert.equal(analysis.signal.direction, "FLAT");
  assert.ok(analysis.confidence <= 40);
});

test("Watch-only Discord setup does not display execution instructions", () => {
  const payload = payloadFor(brokerSnapshot({ base: 4700, dailyChangePct: 0.12 }));
  const embedText = JSON.stringify(payload.embeds[0]);
  const setup = payload.embeds[0].fields.find((field) => field.name === "Setup")?.value ?? "";

  assert.match(payload.embeds[0].title, /WATCH/);
  assert.doesNotMatch(setup, /Setup zone|Reference targets|Targets:|Stop|stop-loss/i);
  assert.match(setup, /Reference only/);
  assert.doesNotMatch(embedText, /ACTIONABLE/);
});

test("Conditional setup only appears when all gates are satisfied", () => {
  const analysis = analyzeGold(brokerSnapshot({
    base: 4700,
    step: 0.5,
    futuresFlowStatus: "confirmed",
    dailyChangePct: 0.12
  }), {
    macroDrivers: { ...emptyMacroDrivers(), macroBias: "bullish-gold" }
  });
  const payload = buildDiscordPayload(analysis) as {
    embeds: Array<{ title: string; fields: Array<{ name: string; value: string }> }>;
  };
  const setup = payload.embeds[0].fields.find((field) => field.name === "Setup")?.value ?? "";

  assert.equal(analysis.recommendationLevel, "conditional-setup");
  assert.match(payload.embeds[0].title, /CONDITIONAL-/);
  assert.match(setup, /Reference levels, not execution order/);
  assert.match(setup, /Reference targets/);
  assert.doesNotMatch(JSON.stringify(payload), /ACTIONABLE/);
});
