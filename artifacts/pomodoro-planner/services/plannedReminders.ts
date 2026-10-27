import { Platform } from 'react-native';
import * as Notifications from './localNotifications';
import type { FocusTask } from '@/store/FocusContext';

export type PlannedTask = {
  id: string;
  taskId: string;
  dueAt: number;
  /** Optional end of the calendar block; reminders remain relative to dueAt. */
  endAt?: number;
  reminderMinutes: number;
  createdAt: number;
};
export type PlanInput = Omit<PlannedTask, 'id' | 'createdAt'> & { id?: string };

export const PLAN_NOTIFICATION_PREFIX = 'focus-garden-plan-';
const CHANNEL = 'focus-garden-reminders-v2';
const VIBRATION = [0, 350, 150, 350];
let queue: Promise<void> = Promise.resolve();

export function reminderTime(plan: Pick<PlannedTask, 'dueAt' | 'reminderMinutes'>): number {
  return plan.dueAt - plan.reminderMinutes * 60_000;
}

export function validatePlan(input: PlanInput, now = Date.now()): void {
  if (input.endAt !== undefined && (
    !Number.isSafeInteger(input.endAt) || !Number.isFinite(new Date(input.endAt).getTime()) ||
    input.endAt <= input.dueAt
  )) {
    throw new Error('Choose an end date and time after the start.');
  }
  if (!Number.isSafeInteger(input.dueAt) || !Number.isFinite(new Date(input.dueAt).getTime()) || input.dueAt <= now) {
    throw new Error('Choose a due date and time in the future.');
  }
  if (!Number.isSafeInteger(input.reminderMinutes) || input.reminderMinutes < 1) {
    throw new Error('Enter a whole number of reminder minutes, at least 1.');
  }
  if (!Number.isSafeInteger(reminderTime(input)) || reminderTime(input) <= now) {
    throw new Error('The reminder time has already passed. Choose a later due time or fewer reminder minutes.');
  }
}

async function createChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Planned task reminders',
      description: 'Reminders before the due time you choose for a task.',
      importance: Notifications.AndroidImportance.HIGH,
      // Omitting sound uses Android's default notification sound. Channel sound
      // strings are native resource filenames, unlike notification content.sound.
      enableVibrate: true,
      // Use the system pattern: some native bridges reject custom pattern arrays
      // while serializing a channel. A new channel ID avoids immutable old settings.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message : String(failure);
    throw new Error(`Android could not set up reminder alerts. Reload the app and try again. If this continues, check notification settings. Details: ${detail}`);
  }
}

export async function requestPlanPermission(): Promise<void> {
  if (Platform.OS === 'web') return;
  await createChannel();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
  }
  if (!permission.granted) {
    throw new Error('Allow notifications in your phone settings to save a reminder, then try again.');
  }
}

async function reconcile(plans: PlannedTask[], tasks: FocusTask[]): Promise<void> {
  if (Platform.OS === 'web') return;
  const now = Date.now();
  const active = new Map(tasks.filter(task => !task.archived).map(task => [task.id, task]));
  const future = plans.filter(plan => active.has(plan.taskId) && reminderTime(plan) > now);
  // Do not cancel an alert merely because it became due while JS was asleep.
  // Android may still be delivering it. Only explicit removal/archive cancels it.
  const wanted = new Set(plans.filter(plan => active.has(plan.taskId)).map(plan => PLAN_NOTIFICATION_PREFIX + plan.id));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notification of scheduled) {
    if (notification.identifier.startsWith(PLAN_NOTIFICATION_PREFIX) && !wanted.has(notification.identifier)) {
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    }
  }
  if (!future.length) return;
  await createChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Task reminders are blocked. Allow notifications in phone settings, then retry reminders.');
  }
  for (const plan of future) {
    const task = active.get(plan.taskId)!;
    const identifier = PLAN_NOTIFICATION_PREFIX + plan.id;
    const existing = scheduled.find(notification => notification.identifier === identifier);
    if (
      existing?.content.data?.dueAt === plan.dueAt &&
      existing.content.data.reminderMinutes === plan.reminderMinutes &&
      existing.content.data.taskTitle === task.title &&
      (Platform.OS !== 'android' || existing.content.data.channelId === CHANNEL)
    ) continue;
    // A stable identifier replaces an edited reminder, rather than adding a duplicate.
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: 'Task reminder',
        body: `${task.title} · Due ${new Date(plan.dueAt).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })} (${plan.reminderMinutes} min reminder).`,
        sound: 'default',
        vibrate: VIBRATION,
        data: { kind: 'task-reminder', planId: plan.id, taskId: task.id, taskTitle: task.title, dueAt: plan.dueAt, reminderMinutes: plan.reminderMinutes, channelId: CHANNEL },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminderTime(plan)),
        channelId: CHANNEL,
      },
    });
  }
}

export function syncPlannedReminders(plans: PlannedTask[], tasks: FocusTask[]): Promise<void> {
  queue = queue.catch(() => undefined).then(() => reconcile(plans, tasks));
  return queue;
}
