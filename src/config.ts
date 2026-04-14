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
