import "dotenv/config";

import { resolve } from "node:path";

import { RuntimeConfig } from "./types.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid numeric environment variable: ${name}=${raw}`);
  }
  return value;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`Invalid boolean environment variable: ${name}=${raw}`);
}

function parseDataPrimary(): RuntimeConfig["dataPrimary"] {
  const raw = process.env.DATA_PRIMARY?.trim().toLowerCase() || "auto";
  if (raw === "auto" || raw === "rithmic" || raw === "yahoo") return raw;
  throw new Error(`Invalid DATA_PRIMARY: ${raw}`);
}

function optionalPath(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? resolve(value) : undefined;
}

export function loadConfig(): RuntimeConfig {
  const logLevel = (process.env.LOG_LEVEL?.trim().toLowerCase() ??
    "info") as RuntimeConfig["logLevel"];

  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}`);
  }

  return {
    discordWebhookUrl: requireEnv("DISCORD_WEBHOOK_URL"),
    publishStatePath: resolve(
      process.env.PUBLISH_STATE_PATH?.trim() || ".runtime/last-publish.json"
    ),
    priceBufferPath: resolve(
      process.env.PRICE_BUFFER_PATH?.trim() || ".runtime/price-buffer.json"
    ),
    dataPrimary: parseDataPrimary(),
    enableYahooFallback: parseBoolean("ENABLE_YAHOO_FALLBACK", true),
    rithmicGcJsonlPath: optionalPath("RITHMIC_GC_JSONL_PATH"),
    pepperstoneXauJsonlPath: optionalPath("PEPPERSTONE_XAU_JSONL_PATH"),
    minSourceQuality: parseNumber("MIN_SOURCE_QUALITY", 60),
    maxTickAgeMs: parseNumber("MAX_TICK_AGE_MS", 15_000),
    maxCandleAgeMs: parseNumber("MAX_CANDLE_AGE_MS", 120_000),
    enableBrokerBasis: parseBoolean("ENABLE_BROKER_BASIS", true),
    pollIntervalMs: parseNumber("POLL_INTERVAL_MS", 60_000),
    publishIntervalMs: parseNumber("PUBLISH_INTERVAL_MS", 900_000),
    requestTimeoutMs: parseNumber("REQUEST_TIMEOUT_MS", 6_000),
    requestMaxAttempts: parseNumber("REQUEST_MAX_ATTEMPTS", 3),
    requestRetryBaseMs: parseNumber("REQUEST_RETRY_BASE_MS", 300),
    maxDataAgeMs: parseNumber("MAX_DATA_AGE_MS", 120_000),
    marketTimezone: process.env.MARKET_TIMEZONE?.trim() || "America/New_York",
    enableMarketHoursOnly: parseBoolean("ENABLE_MARKET_HOURS_ONLY", true),
    logLevel
  };
}
