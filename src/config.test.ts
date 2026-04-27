import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "./config.js";

function withEnv(values: NodeJS.ProcessEnv, fn: () => void): void {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, original);
  }
}

test("DATA_PRIMARY=broker is accepted with Pepperstone broker source", () => {
  withEnv({
    DISCORD_WEBHOOK_URL: "https://example.invalid/webhook",
    DATA_PRIMARY: "broker",
    BROKER_PRIMARY_SOURCE: "pepperstone"
  }, () => {
    const config = loadConfig();
    assert.equal(config.dataPrimary, "broker");
    assert.equal(config.brokerPrimarySource, "pepperstone");
    assert.equal(config.maxBrokerSpread, 5);
  });
});

test("invalid DATA_PRIMARY is rejected", () => {
  withEnv({
    DISCORD_WEBHOOK_URL: "https://example.invalid/webhook",
    DATA_PRIMARY: "tradovate"
  }, () => {
    assert.throws(() => loadConfig(), /Invalid DATA_PRIMARY: tradovate/);
  });
});
