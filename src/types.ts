export interface RuntimeConfig {
  discordWebhookUrl: string;
  publishStatePath: string;
  priceBufferPath: string;
  dataPrimary: "auto" | "rithmic" | "yahoo";
  enableYahooFallback: boolean;
  rithmicGcJsonlPath?: string;
  pepperstoneXauJsonlPath?: string;
  minSourceQuality: number;
  maxTickAgeMs: number;
  maxCandleAgeMs: number;
  enableBrokerBasis: boolean;
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
