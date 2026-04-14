export interface RuntimeConfig {
  discordWebhookUrl: string;
  publishStatePath: string;
  priceBufferPath: string;
  pollIntervalMs: number;
  publishIntervalMs: number;
  requestTimeoutMs: number;
  requestMaxAttempts: number;
  requestRetryBaseMs: number;
  maxDataAgeMs: number;
  marketTimezone: string;
  enableMarketHoursOnly: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}
