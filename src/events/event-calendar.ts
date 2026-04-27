import { readFile } from "node:fs/promises";

export type EventImportance = "low" | "medium" | "high";

export interface CalendarEvent {
  id: string;
  name: string;
  country: string;
  importance: EventImportance;
  scheduledTimeMs: number;
  type: string;
}

export interface EventRisk {
  mode: "normal" | "pre-event" | "shock" | "post-event-confirmation";
  nearestEvent?: CalendarEvent;
  tradePermission: "allowed" | "watch-only" | "blocked";
}

interface EventCalendarFile {
  events?: CalendarEvent[];
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<CalendarEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.name === "string" &&
    typeof event.country === "string" &&
    (event.importance === "low" || event.importance === "medium" || event.importance === "high") &&
    typeof event.scheduledTimeMs === "number" &&
    Number.isFinite(event.scheduledTimeMs) &&
    typeof event.type === "string"
  );
}

export async function loadEventCalendar(path: string): Promise<CalendarEvent[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as EventCalendarFile;
    return Array.isArray(parsed.events)
      ? parsed.events.filter(isCalendarEvent).sort((a, b) => a.scheduledTimeMs - b.scheduledTimeMs)
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function getUpcomingEvents(
  events: CalendarEvent[],
  nowMs: number,
  windowHours: number
): CalendarEvent[] {
  const endMs = nowMs + windowHours * 60 * 60 * 1000;
  return events.filter((event) => event.scheduledTimeMs >= nowMs && event.scheduledTimeMs <= endMs);
}

export function getEventRisk(
  events: CalendarEvent[],
  nowMs: number,
  enableGate = true
): EventRisk {
  const highImpact = events
    .filter((event) => event.importance === "high")
    .sort((a, b) => Math.abs(a.scheduledTimeMs - nowMs) - Math.abs(b.scheduledTimeMs - nowMs));
  const nearestEvent = highImpact[0];
  if (!nearestEvent || !enableGate) {
    return { mode: "normal", nearestEvent, tradePermission: "allowed" };
  }

  const deltaMs = nearestEvent.scheduledTimeMs - nowMs;
  const minute = 60_000;
  if (deltaMs >= 0 && deltaMs <= 30 * minute) {
    return { mode: "pre-event", nearestEvent, tradePermission: "watch-only" };
  }
  if (deltaMs < 0 && Math.abs(deltaMs) <= 10 * minute) {
    return { mode: "shock", nearestEvent, tradePermission: "blocked" };
  }
  if (deltaMs < 0 && Math.abs(deltaMs) <= 60 * minute) {
    return { mode: "post-event-confirmation", nearestEvent, tradePermission: "watch-only" };
  }

  return { mode: "normal", nearestEvent, tradePermission: "allowed" };
}
