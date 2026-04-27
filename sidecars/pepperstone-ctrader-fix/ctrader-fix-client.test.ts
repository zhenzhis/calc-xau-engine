import assert from "node:assert/strict";
import test from "node:test";

import {
  SOH,
  buildFixMessage,
  buildSessionMessage,
  calculateCheckSum,
  extractBidAsk,
  parseFixMessage,
  type FixSessionConfig,
} from "./ctrader-fix-client.js";

const config: FixSessionConfig = {
  host: "example.invalid",
  port: 5211,
  ssl: true,
  username: "12345",
  password: "test-password",
  senderCompId: "demo.broker.12345",
  targetCompId: "CSERVER",
  senderSubId: "QUOTE",
  targetSubId: "QUOTE",
  heartbeatSec: 30,
  resetSeqNum: true,
};

test("FIX builder calculates BodyLength and CheckSum with SOH delimiter", () => {
  const message = buildFixMessage([
    ["35", "0"],
    ["49", "SENDER"],
    ["56", "CSERVER"],
  ]);

  assert.equal(message.includes(SOH), true);
  assert.equal(message.includes("|"), false);

  const bodyLength = Number(parseFixMessage(message).get("9"));
  const bodyStart = message.indexOf(SOH, message.indexOf("9=")) + 1;
  const checksumStart = message.indexOf("10=");
  const body = message.slice(bodyStart, checksumStart);
  assert.equal(Buffer.byteLength(body, "utf8"), bodyLength);

  const checksum = parseFixMessage(message).get("10");
  assert.equal(checksum, calculateCheckSum(message.slice(0, checksumStart)));
});

test("Logon message includes required cTrader FIX tags", () => {
  const message = buildSessionMessage(config, 1, "A", [
    ["98", "0"],
    ["108", 30],
    ["141", "Y"],
    ["553", config.username],
    ["554", config.password],
  ]);
  const parsed = parseFixMessage(message);

  assert.equal(parsed.get("35"), "A");
  assert.equal(parsed.get("49"), config.senderCompId);
  assert.equal(parsed.get("56"), "CSERVER");
  assert.equal(parsed.get("50"), "QUOTE");
  assert.equal(parsed.get("57"), "QUOTE");
  assert.equal(parsed.get("98"), "0");
  assert.equal(parsed.get("108"), "30");
  assert.equal(parsed.get("141"), "Y");
  assert.equal(parsed.get("553"), "12345");
  assert.equal(parsed.get("554"), "test-password");
});

test("MarketDataRequest contains snapshot plus updates bid/ask subscription", () => {
  const message = buildSessionMessage(config, 2, "V", [
    ["262", "md-1"],
    ["263", "1"],
    ["264", "1"],
    ["265", "1"],
    ["267", "2"],
    ["269", "0"],
    ["269", "1"],
    ["146", "1"],
    ["55", "99"],
  ]);
  const parsed = parseFixMessage(message);

  assert.equal(parsed.get("35"), "V");
  assert.equal(parsed.get("263"), "1");
  assert.equal(parsed.get("264"), "1");
  assert.equal(parsed.get("267"), "2");
  assert.deepEqual(parsed.getAll("269"), ["0", "1"]);
  assert.equal(parsed.get("55"), "99");
});

test("FIX parser extracts bid and ask from 35=W snapshot", () => {
  const message = buildFixMessage([
    ["35", "W"],
    ["55", "99"],
    ["268", "2"],
    ["269", "0"],
    ["270", "2349.82"],
    ["271", "10"],
    ["269", "1"],
    ["270", "2350.05"],
    ["271", "12"],
  ]);

  assert.deepEqual(extractBidAsk(parseFixMessage(message)), { bid: 2349.82, ask: 2350.05 });
});

test("FIX parser extracts bid and ask from 35=X incremental groups", () => {
  const message = buildFixMessage([
    ["35", "X"],
    ["268", "2"],
    ["279", "0"],
    ["269", "0"],
    ["278", "bid-1"],
    ["55", "99"],
    ["270", "2349.9"],
    ["271", "8"],
    ["279", "0"],
    ["269", "1"],
    ["278", "ask-1"],
    ["55", "99"],
    ["270", "2350.2"],
    ["271", "9"],
  ]);

  assert.deepEqual(extractBidAsk(parseFixMessage(message)), { bid: 2349.9, ask: 2350.2 });
});
