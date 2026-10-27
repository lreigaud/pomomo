import type { FocusTask, TimerMode } from '@/store/FocusContext';

export const DEFAULT_FOCUS_MINUTES = 25;
export const MAX_DURATION_MINUTES = 1440;

export function focusMinutesFor(task?: FocusTask): number {
  const minutes = task?.focusMinutes;
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_DURATION_MINUTES
    ? minutes : DEFAULT_FOCUS_MINUTES;
}

export function breakMinutesFor(task?: FocusTask): number {
  const minutes = task?.breakMinutes;
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0.01 && minutes <= MAX_DURATION_MINUTES
    ? minutes : focusMinutesFor(task) / 5;
}

export function taskDurationMs(mode: TimerMode, task?: FocusTask): number {
  return Math.round((mode === 'focus' ? focusMinutesFor(task) : breakMinutesFor(task)) * 60_000);
}

export function parseFocusMinutes(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const minutes = Number(text);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_DURATION_MINUTES ? minutes : null;
}

export function parseBreakMinutes(text: string): number | null {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text.trim())) return null;
  const minutes = Number(text.trim().replace(',', '.'));
  return Number.isFinite(minutes) && minutes >= 0.01 && minutes <= MAX_DURATION_MINUTES ? minutes : null;
}
