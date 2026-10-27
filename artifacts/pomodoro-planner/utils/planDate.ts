export const REMINDER_PRESETS = [5, 15, 30] as const;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses YYYY-MM-DD + HH:MM (24h) in device local time. Rejects impossible dates via round-trip. */
export function parseLocalDateTime(
  dateText: string,
  timeText: string,
): { ok: true; value: number } | { ok: false; field: 'date' | 'time'; message: string } {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  if (!dm) return { ok: false, field: 'date', message: 'Use the format YYYY-MM-DD, for example 2025-03-14.' };
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const day = Number(dm[3]);
  const probe = new Date(y, mo - 1, day, 12, 0, 0, 0);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== day) {
    return { ok: false, field: 'date', message: 'That date does not exist. Check the month and day.' };
  }
  if (!tm) return { ok: false, field: 'time', message: 'Use 24-hour HH:MM, for example 09:30 or 16:45.' };
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (h > 23 || mi > 59) return { ok: false, field: 'time', message: 'Hours run 00–23 and minutes 00–59.' };
  const d = new Date(y, mo - 1, day, h, mi, 0, 0);
  if (d.getHours() !== h || d.getMinutes() !== mi || d.getDate() !== day) {
    return { ok: false, field: 'time', message: 'That time is skipped on this date by a clock change.' };
  }
  return { ok: true, value: d.getTime() };
}

export function parseReminderMinutes(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function formatPlanWhen(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return `${date} · ${formatTimeInput(ms)}`;
}

export function formatLead(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? 'day' : 'days'} before`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'} before`;
  return `${minutes} min before`;
}
