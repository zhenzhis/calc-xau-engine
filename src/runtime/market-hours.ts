// ---------------------------------------------------------------------------
// Gold (COMEX/Globex) Trading Hours
//
// Gold trades nearly 24 hours, 5 days a week on CME Globex:
//   Sunday 6:00 PM ET → Friday 5:00 PM ET
//   Daily maintenance break: 5:00 PM → 6:00 PM ET (Mon-Thu)
//
// This module determines whether the gold market is currently in session.
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export type GoldSessionReason =
  | "open"
  | "weekend"
  | "maintenance-break"
  | "friday-closed";

export interface GoldSessionStatus {
  isOpen: boolean;
  reason: GoldSessionReason;
  localDate: string;
  localTime: string;
}

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

/**
 * Check if the gold market is currently open.
 *
 * Gold trading session (ET):
 *   Sunday 18:00 → Monday 17:00
 *   Monday 18:00 → Tuesday 17:00
 *   ...
 *   Thursday 18:00 → Friday 17:00
 *
 * Closed:
 *   Saturday all day
 *   Sunday before 18:00
 *   Friday after 17:00
 *   Daily 17:00-18:00 maintenance break (Mon-Thu)
 */
export function getGoldSession(now: Date, timezone: string): GoldSessionStatus {
  const parts = getZonedParts(now, timezone);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const localDate = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const localTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`;

  const base = { localDate, localTime };

  // Saturday: always closed
  if (parts.weekday === 6) {
    return { isOpen: false, reason: "weekend", ...base };
  }

  // Sunday: only open after 18:00 ET
  if (parts.weekday === 0) {
    if (minuteOfDay < 18 * 60) {
      return { isOpen: false, reason: "weekend", ...base };
    }
    return { isOpen: true, reason: "open", ...base };
  }

  // Friday: closed after 17:00 ET
  if (parts.weekday === 5) {
    if (minuteOfDay >= 17 * 60) {
      return { isOpen: false, reason: "friday-closed", ...base };
    }
    // Before 17:00 on Friday: check maintenance break
    if (minuteOfDay >= 17 * 60) {
      // won't reach here, but for clarity
      return { isOpen: false, reason: "friday-closed", ...base };
    }
  }

  // Monday-Friday: maintenance break 17:00-18:00 ET
  if (minuteOfDay >= 17 * 60 && minuteOfDay < 18 * 60) {
    return { isOpen: false, reason: "maintenance-break", ...base };
  }

  // All other times Mon-Fri: open
  return { isOpen: true, reason: "open", ...base };
}

export function isGoldMarketOpen(now: Date, timezone: string): boolean {
  return getGoldSession(now, timezone).isOpen;
}
