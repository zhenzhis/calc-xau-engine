import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildIngestReport, strictIngestOk } from "./check-data-ingest.js";

test("check-data-ingest reports missing files without throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-ingest-"));
  const report = await buildIngestReport({
    pepperstonePath: join(dir, "missing-pepperstone.jsonl"),
    futuresPath: join(dir, "missing-futures.jsonl"),
    nowMs: 1_000,
    maxAgeMs: 500,
  });

  assert.equal(report.pepperstone_ok, false);
  assert.equal(report.futures_ok, false);
  assert.equal(strictIngestOk(report), false);
  assert.equal(report.messages.some((message) => message.includes("file not found")), true);
});

test("check-data-ingest accepts fresh Pepperstone and futures rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-ingest-"));
  const pepperstonePath = join(dir, "pepperstone.jsonl");
  const futuresPath = join(dir, "futures.jsonl");
  await writeFile(pepperstonePath, `${JSON.stringify({ timestampMs: 1_000, symbol: "XAUUSD", bid: 2349.82, ask: 2350.05 })}\n`);
  await writeFile(futuresPath, `${JSON.stringify({ timestampMs: 1_000, symbol: "GC", contract: "GCM6", bid: 2350.1, ask: 2350.2, last: 2350.15, volume: 12 })}\n`);

  const report = await buildIngestReport({
    pepperstonePath,
    futuresPath,
    nowMs: 1_100,
    maxAgeMs: 500,
  });

  assert.equal(report.pepperstone_ok, true);
  assert.equal(report.futures_ok, true);
  assert.equal(report.mode, "auto");
  assert.equal(report.broker_primary_ok, false);
  assert.equal(report.pepperstone_age_ms, 100);
  assert.equal(report.futures_age_ms, 100);
  assert.equal(report.pepperstone_spread, 0.2300000000000182);
  assert.equal(report.futures_last, 2350.15);
  assert.deepEqual(report.messages, []);
  assert.equal(strictIngestOk(report), true);
});

test("broker-primary strict accepts fresh Pepperstone with missing futures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-ingest-"));
  const pepperstonePath = join(dir, "pepperstone.jsonl");
  await writeFile(pepperstonePath, `${JSON.stringify({ timestampMs: 1_000, symbol: "XAUUSD", bid: 2349.82, ask: 2350.05 })}\n`);

  const report = await buildIngestReport({
    pepperstonePath,
    futuresPath: join(dir, "missing-futures.jsonl"),
    nowMs: 1_100,
    maxAgeMs: 500,
    mode: "broker",
    selectedBrokerSource: "pepperstone"
  });

  assert.equal(report.mode, "broker");
  assert.equal(report.pepperstone_ok, true);
  assert.equal(report.futures_ok, false);
  assert.equal(report.broker_primary_ok, true);
  assert.equal(report.selected_broker_source, "pepperstone");
  assert.equal(report.messages.includes("futures unavailable; broker-primary mode active"), true);
  assert.equal(strictIngestOk(report), true);
});
