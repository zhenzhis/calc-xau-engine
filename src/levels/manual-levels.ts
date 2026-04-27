export const DEFAULT_MANUAL_LEVEL_METADATA = {
  createdAt: "2026-04-15T00:00:00.000Z",
  source: "TradingView manual chart extraction 2026-04-15",
  expiresAt: "2026-05-15T00:00:00.000Z",
  touchCount: 0,
  invalidated: false,
  notes: "Manual static level from original TradingView grid; must be revalidated against canonical bars."
} as const;

export type LevelStatus = "fresh" | "stale" | "invalidated";
