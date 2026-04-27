export interface RuntimeConfig {
  discordWebhookUrl: string;
  publishStatePath: string;
  priceBufferPath: string;
  analysisSnapshotPath: string;
  dataPrimary: "auto" | "rithmic" | "yahoo" | "broker";
  brokerPrimarySource: "pepperstone";
  enableYahooFallback: boolean;
  rithmicGcJsonlPath?: string;
  pepperstoneXauJsonlPath?: string;
  minSourceQuality: number;
  maxTickAgeMs: number;
  maxCandleAgeMs: number;
  maxBrokerSpread: number;
  enableBrokerBasis: boolean;
  enableFred: boolean;
  fredCachePath: string;
  eventCalendarPath: string;
  enableEventGate: boolean;
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
