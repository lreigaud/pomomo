export const SLOT_MINUTES = 30;
export const HOUR_HEIGHT = 64;
const MIN_MS = 60000;

export type CalendarEvent = { id: string; title: string; startAt: number; endAt: number; paused?: boolean };
export type LaidOutEvent = CalendarEvent & {
  top: number; height: number; column: number; columns: number;
  clippedStart: boolean; clippedEnd: boolean;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse YYYY-MM-DD as a local date (midnight). Returns null when invalid. */
export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

/** Local YYYY-MM-DD for a Date or timestamp. */
export function toDateKey(value: Date | number): string {
  const d = typeof value === 'number' ? new Date(value) : value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: number = Date.now()): string {
  return toDateKey(now);
}

/** Shift a date key by whole calendar days (DST safe). */
export function shiftDateKey(key: string, days: number): string {
  const d = parseDateKey(key) ?? new Date();
  return toDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** Local start (inclusive) and end (exclusive) timestamps of a day. */
export function dayBounds(key: string): { start: number; end: number } {
  const d = parseDateKey(key) ?? new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { start, end };
}

/** Timestamp for a local wall-clock time on a day. */
export function slotTimestamp(key: string, hour: number, minute: number): number {
  const d = parseDateKey(key) ?? new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime();
}

/** 48 half-hour slots for a day. */
export function daySlots(key: string): { hour: number; minute: number; timestamp: number; id: string; valid: boolean }[] {
  const out: { hour: number; minute: number; timestamp: number; id: string; valid: boolean }[] = [];
  for (let i = 0; i < (24 * 60) / SLOT_MINUTES; i++) {
    const hour = Math.floor((i * SLOT_MINUTES) / 60);
    const minute = (i * SLOT_MINUTES) % 60;
    const timestamp = slotTimestamp(key, hour, minute);
    const local = new Date(timestamp);
    // A spring clock change can skip a wall-clock time. Never silently schedule
    // a tap on 02:30 at 03:30 instead.
    const valid = toDateKey(local) === key && local.getHours() === hour && local.getMinutes() === minute;
    out.push({ hour, minute, timestamp, id: `${pad(hour)}-${pad(minute)}`, valid });
  }
  return out;
}

/** Monday-start week of date keys containing the given day. */
export function weekKeys(key: string): string[] {
  const d = parseDateKey(key) ?? new Date();
  const offset = (d.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(key, i - offset));
}

/** Minutes since local midnight of the given day (wall clock, DST aware). */
export function minutesIntoDay(ts: number, key: string): number {
  const { start, end } = dayBounds(key);
  if (ts <= start) return 0;
  if (ts >= end) return 24 * 60;
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRange(startAt: number, endAt: number): string {
  return `${formatClock(startAt)} – ${formatClock(endAt)}`;
}

/**
 * Clip events to the day, assign side-by-side columns within overlap clusters.
 * Blocks shorter than minHeight are padded visually; that padding counts toward overlap.
 */
export function layoutDayEvents(events: CalendarEvent[], key: string, hourHeight = HOUR_HEIGHT, minHeight = 26): LaidOutEvent[] {
  const { start, end } = dayBounds(key);
  const items = events
    .filter((e) => e.endAt > start && e.startAt < end && e.endAt >= e.startAt)
    .map((e) => {
      const s = Math.max(e.startAt, start);
      const en = Math.min(Math.max(e.endAt, e.startAt + MIN_MS), end);
      const top = (minutesIntoDay(s, key) / 60) * hourHeight;
      const bottom = (minutesIntoDay(en, key) / 60) * hourHeight;
      const height = Math.max(minHeight, bottom - top);
      return { ...e, top: Math.min(top, 24 * hourHeight - minHeight), height, column: 0, columns: 1, clippedStart: e.startAt < start, clippedEnd: e.endAt > end };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height || a.id.localeCompare(b.id));

  let cluster: LaidOutEvent[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    cluster.forEach((c) => { c.columns = colEnds.length; });
    cluster = []; colEnds = [];
  };
  for (const it of items) {
    if (it.top >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= it.top);
    if (col === -1) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = it.top + it.height;
    it.column = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.top + it.height);
  }
  flush();
  return items;
}
