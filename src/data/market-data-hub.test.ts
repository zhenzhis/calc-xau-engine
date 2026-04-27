import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Logger } from "../lib/logger.js";
import { RuntimeConfig } from "../types.js";
import { MarketDataHub } from "./market-data-hub.js";

function config(pepperstonePath: string): RuntimeConfig {
  return {
    discordWebhookUrl: "https://example.invalid/webhook",
    publishStatePath: ".runtime/last-publish.json",
    priceBufferPath: ".runtime/price-buffer.json",
    analysisSnapshotPath: ".runtime/analysis-snapshots.jsonl",
    dataPrimary: "broker",
    brokerPrimarySource: "pepperstone",
    enableYahooFallback: false,
    rithmicGcJsonlPath: undefined,
    pepperstoneXauJsonlPath: pepperstonePath,
    minSourceQuality: 60,
    maxTickAgeMs: 15_000,
    maxCandleAgeMs: 120_000,
    enableBrokerBasis: false,
    enableFred: false,
    fredCachePath: ".runtime/fred-cache.json",
    eventCalendarPath: "data/events.json",
    enableEventGate: false,
    pollIntervalMs: 60_000,
    publishIntervalMs: 900_000,
    requestTimeoutMs: 6_000,
    requestMaxAttempts: 1,
    requestRetryBaseMs: 300,
    maxDataAgeMs: 120_000,
    marketTimezone: "America/New_York",
    enableMarketHoursOnly: false,
    logLevel: "error"
  };
}

test("broker-primary selects fresh Pepperstone as active primary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-hub-"));
  const pepperstonePath = join(dir, "pepperstone-xau.jsonl");
  const now = Date.now();
  const lines = Array.from({ length: 20 }, (_, i) => {
    const bid = 2349.8 + i * 0.05;
    return JSON.stringify({
      timestampMs: now - (19 - i) * 60_000 - 1_000,
      symbol: "XAUUSD",
      bid,
      ask: bid + 0.2
    });
  }).join("\n");
  await writeFile(pepperstonePath, `${lines}\n`, "utf8");

  const hub = new MarketDataHub(config(pepperstonePath), new Logger("error"));
  const snapshot = await hub.fetchSnapshot();

  assert.equal(snapshot.primary.source, "pepperstone");
  assert.equal(snapshot.primary.instrumentKind, "broker_spot");
  assert.equal(snapshot.primary.fallback, false);
  assert.equal(snapshot.activePrimaryHealth.source, "pepperstone");
  assert.equal(snapshot.futuresFlowStatus, "unknown");
  assert.equal(snapshot.xauBrokerTick?.symbol, "XAUUSD");
  assert.ok(snapshot.bars.m1.length > 0);
});

test("broker-primary preserves synthetic Pepperstone provenance with degraded health", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-hub-"));
  const pepperstonePath = join(dir, "pepperstone-xau.jsonl");
  const now = Date.now();
  const lines = Array.from({ length: 20 }, (_, i) => {
    const bid = 2349.8 + i * 0.05;
    return JSON.stringify({
      timestampMs: now - (19 - i) * 60_000 - 1_000,
      symbol: "XAUUSD",
      bid,
      ask: bid + 0.2,
      feed: "synthetic_test",
      sidecar: "test-generator",
      sessionVerified: false,
      testData: true
    });
  }).join("\n");
  await writeFile(pepperstonePath, `${lines}\n`, "utf8");

  const hub = new MarketDataHub(config(pepperstonePath), new Logger("error"));
  const snapshot = await hub.fetchSnapshot();

  assert.equal(snapshot.primary.source, "pepperstone");
  assert.equal(snapshot.activePrimaryHealth.feed, "synthetic_test");
  assert.equal(snapshot.activePrimaryHealth.testData, true);
  assert.ok(snapshot.activePrimaryHealth.qualityScore <= 20);
  assert.equal(snapshot.xauBrokerTick?.testData, true);
});
