import assert from "node:assert/strict";
import test from "node:test";

import { getGoldTradingSession } from "./market-hours.js";

const TZ = "America/New_York";

test("classifies US-London overlap session", () => {
  const session = getGoldTradingSession(new Date("2026-01-05T14:00:00.000Z"), TZ);
  assert.equal(session.name, "us-overlap");
  assert.equal(session.isOpen, true);
});

test("classifies Sunday Globex open as Asian session", () => {
  const session = getGoldTradingSession(new Date("2026-04-26T22:30:00.000Z"), TZ);
  assert.equal(session.name, "asian");
  assert.equal(session.isOpen, true);
});

test("classifies Friday after COMEX close as weekend", () => {
  const session = getGoldTradingSession(new Date("2026-04-24T21:30:00.000Z"), TZ);
  assert.equal(session.name, "weekend");
  assert.equal(session.isOpen, false);
});
