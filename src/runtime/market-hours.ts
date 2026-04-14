// ---------------------------------------------------------------------------
// Gold (COMEX/Globex) Trading Sessions — Institutional Schedule
//
// Gold has distinct liquidity/volatility profiles across sessions.
// Professional desks adjust monitoring cadence accordingly:
//
//   Session          ET Time          Poll    Publish   Liquidity
//   ─────────────────────────────────────────────────────────────
//   Asian            18:00→03:00      120s    30min     Low
//   London           03:00→08:30      60s     15min     High (LBMA)
//   US-London OVL    08:30→12:00      30s     5min      Peak (COMEX+LBMA)
//   US Afternoon     12:00→17:00      60s     15min     Medium
//   Maintenance      17:00→18:00      —       —         Closed
//   Weekend          Fri 17→Sun 18    —       —         Closed
//
// Event-driven overrides (immediate publish regardless of interval):
//   - Regime change (volatility shift)
//   - Trend reversal (directional flip)
//   - Zone breach (enter/exit institutional S/D zone)
//   - Key level breach (price crosses extreme/zone-edge/key-support)
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

// ---------------------------------------------------------------------------
// Session Types
// ---------------------------------------------------------------------------

export type GoldSessionName =
  | "asian"
  | "london"
  | "us-overlap"
  | "us-afternoon"
  | "maintenance"
  | "weekend";

export interface GoldTradingSession {
  name: GoldSessionName;
  label: string;
  isOpen: boolean;
  pollIntervalMs: number;
  publishIntervalMs: number;
  localDate: string;
  localTime: string;
}

// ---------------------------------------------------------------------------
// Session Configuration — institutional standard
// ---------------------------------------------------------------------------

const SESSION_CONFIG: Record<GoldSessionName, {
  label: string;
  pollIntervalMs: number;
  publishIntervalMs: number;
}> = {
  "asian":        { label: "亚盘 (低波动)",       pollIntervalMs: 120_000, publishIntervalMs: 1_800_000 },
  "london":       { label: "伦敦盘 (LBMA)",       pollIntervalMs:  60_000, publishIntervalMs:   900_000 },
  "us-overlap":   { label: "美伦重叠 (峰值流动性)", pollIntervalMs:  30_000, publishIntervalMs:   300_000 },
  "us-afternoon": { label: "美盘午后",             pollIntervalMs:  60_000, publishIntervalMs:   900_000 },
  "maintenance":  { label: "维护时段",             pollIntervalMs:  60_000, publishIntervalMs:   900_000 },
  "weekend":      { label: "周末休市",             pollIntervalMs:  60_000, publishIntervalMs:   900_000 },
};

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  formatterCache.set(timezone, formatter);
  return formatter;
}

function getZonedParts(now: Date, timezone: string): ZonedParts {
  const raw = Object.fromEntries(
    getFormatter(timezone).formatToParts(now).map((p) => [p.type, p.value])
  );

  const weekday = WEEKDAY_INDEX[raw.weekday];
  if (weekday === undefined) {
    throw new Error(`Unsupported weekday: ${raw.weekday}`);
  }

  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    weekday,
    hour: Number(raw.hour),
    minute: Number(raw.minute)
  };
}

function pad2(v: number): string {
  return v.toString().padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Session Detection
// ---------------------------------------------------------------------------

function classifySession(weekday: number, minuteOfDay: number): GoldSessionName {
  // Saturday: weekend
  if (weekday === 6) return "weekend";

  // Sunday: closed until 18:00
  if (weekday === 0) {
    return minuteOfDay < 18 * 60 ? "weekend" : "asian";
  }

  // Friday: closed after 17:00
  if (weekday === 5 && minuteOfDay >= 17 * 60) return "weekend";

  // Mon-Fri: maintenance break 17:00-18:00
  if (minuteOfDay >= 17 * 60 && minuteOfDay < 18 * 60) return "maintenance";

  // Session classification by time of day (ET)
  // 18:00 → 03:00  Asian
  // 03:00 → 08:30  London
  // 08:30 → 12:00  US-London Overlap
  // 12:00 → 17:00  US Afternoon
  // 00:00 → 03:00  Asian (overnight continuation)

  if (minuteOfDay < 3 * 60)                                   return "asian";
  if (minuteOfDay < 8 * 60 + 30)                               return "london";
  if (minuteOfDay < 12 * 60)                                   return "us-overlap";
  if (minuteOfDay < 17 * 60)                                   return "us-afternoon";
  /* minuteOfDay >= 18 * 60 (after maintenance) */              return "asian";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getGoldTradingSession(now: Date, timezone: string): GoldTradingSession {
  const parts = getZonedParts(now, timezone);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const localDate = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const localTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`;

  const name = classifySession(parts.weekday, minuteOfDay);
  const config = SESSION_CONFIG[name];
  const isOpen = name !== "weekend" && name !== "maintenance";

  return {
    name,
    label: config.label,
    isOpen,
    pollIntervalMs: config.pollIntervalMs,
    publishIntervalMs: config.publishIntervalMs,
    localDate,
    localTime
  };
}

/** Backward-compatible wrapper. */
export function isGoldMarketOpen(now: Date, timezone: string): boolean {
  return getGoldTradingSession(now, timezone).isOpen;
}
