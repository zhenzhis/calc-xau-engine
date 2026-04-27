import assert from "node:assert/strict";
import test from "node:test";

import { CalendarEvent, getEventRisk, getUpcomingEvents } from "./event-calendar.js";

function eventAt(now: number, offsetMs: number): CalendarEvent {
  return {
    id: "cpi",
    name: "US CPI",
    country: "US",
    importance: "high",
    scheduledTimeMs: now + offsetMs,
    type: "CPI"
  };
}

test("returns upcoming events inside configured window", () => {
  const now = Date.UTC(2026, 4, 1, 12);
  const events = [eventAt(now, 20 * 60_000), eventAt(now, 3 * 60 * 60_000)];
  assert.equal(getUpcomingEvents(events, now, 1).length, 1);
});

test("gates high-impact events before release", () => {
  const now = Date.UTC(2026, 4, 1, 12);
  const risk = getEventRisk([eventAt(now, 20 * 60_000)], now, true);
  assert.equal(risk.mode, "pre-event");
  assert.equal(risk.tradePermission, "watch-only");
});

test("uses shock and confirmation windows after release", () => {
  const now = Date.UTC(2026, 4, 1, 12);
  assert.equal(getEventRisk([eventAt(now, -5 * 60_000)], now, true).mode, "shock");
  assert.equal(getEventRisk([eventAt(now, -30 * 60_000)], now, true).mode, "post-event-confirmation");
});
