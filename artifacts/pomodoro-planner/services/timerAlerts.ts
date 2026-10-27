import { Platform, Vibration } from 'react-native';
import * as Notifications from './localNotifications';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { TimerState } from '@/store/FocusContext';

// The same Android notification tag is used for the running status and alarm:
// Android replaces the status with the completion alert even while JS is asleep.
export const TIMER_NOTIFICATION_ID = 'focus-garden-timer';
const ALARM_CHANNEL = 'focus-garden-alarms-v2';
const RUNNING_CHANNEL = 'focus-garden-running-v1';
const VIBRATION = [0, 450, 180, 450, 180, 700];
let channelSetup: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();
let scheduledDeadline: number | null = null;
let player: ReturnType<typeof createAudioPlayer> | null = null;

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const running = notification.request.content.data?.kind === 'running';
      return {
        shouldShowBanner: !running,
        shouldShowList: true,
        shouldPlaySound: !running,
        shouldSetBadge: false,
      };
    },
  });
}

async function createChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!channelSetup) {
    channelSetup = Promise.all([
      Notifications.setNotificationChannelAsync(ALARM_CHANNEL, {
        name: 'Focus and break alarms',
        description: 'Sound and vibration when a Pomodoro or break ends.',
        importance: Notifications.AndroidImportance.HIGH,
        // Android supplies the default sound and vibration pattern. Avoid custom
        // channel arrays that can fail native channel serialization.
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
      Notifications.setNotificationChannelAsync(RUNNING_CHANNEL, {
        name: 'Running timer',
        description: 'Silent timer status on your lock screen.',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        enableVibrate: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
    ]).then(() => undefined).catch((error) => {
      channelSetup = null;
      throw error;
    });
  }
  await channelSetup;
}

export async function requestPhoneAlerts(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  if (Platform.OS === 'web') return { granted: false, canAskAgain: false };
  await createChannels();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return existing;
  if (!existing.canAskAgain) return existing;
  return Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
}

async function dismissRunningStatus(): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const notification of presented) {
    if (
      notification.request.identifier === TIMER_NOTIFICATION_ID &&
      notification.request.content.data?.kind === 'running'
    ) {
      await Notifications.dismissNotificationAsync(TIMER_NOTIFICATION_ID);
    }
  }
}

async function reconcile(
  timer: TimerState,
  taskTitle: string,
  enabled: boolean,
  breakMinutes: number,
): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!enabled || !timer.isRunning || timer.endsAt === null) {
    // Do not cancel an alarm that has just become due when React advances to
    // the next phase. Native notification delivery can race the JS interval.
    if (enabled && scheduledDeadline !== null && scheduledDeadline <= Date.now()) return;
    await Notifications.cancelScheduledNotificationAsync(TIMER_NOTIFICATION_ID);
    scheduledDeadline = null;
    await dismissRunningStatus();
    return;
  }
  if (timer.endsAt <= Date.now()) return;
  await createChannels();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    scheduledDeadline = null;
    throw new Error('Phone alerts are blocked. Allow notifications in your phone settings.');
  }

  await Notifications.cancelScheduledNotificationAsync(TIMER_NOTIFICATION_ID);
  scheduledDeadline = null;
  const endTime = new Date(timer.endsAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (Platform.OS === 'android') {
    await Notifications.scheduleNotificationAsync({
      identifier: TIMER_NOTIFICATION_ID,
      content: {
        title: timer.mode === 'focus' ? 'Focus timer running' : 'Break timer running',
        body: `${timer.mode === 'focus' ? taskTitle : 'Take a breather'} · Finishes at ${endTime}. Open for the countdown.`,
        sound: false,
        sticky: true,
        autoDismiss: false,
        data: { kind: 'running', endsAt: timer.endsAt },
      },
      // A channel-only trigger presents immediately without changing Android's
      // pending date trigger. No JS background loop or repeated alarms needed.
      trigger: { channelId: RUNNING_CHANNEL },
    });
  }
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: TIMER_NOTIFICATION_ID,
      content: {
        title: timer.mode === 'focus' ? 'Focus session finished' : 'Break finished',
        body: timer.mode === 'focus'
          ? `${taskTitle} · Time for a ${breakMinutes}-minute break.`
          : 'Ready for your next focus session?',
        sound: 'default',
        vibrate: VIBRATION,
        sticky: false,
        autoDismiss: true,
        data: { kind: 'completion', endsAt: timer.endsAt, mode: timer.mode },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(timer.endsAt),
        channelId: ALARM_CHANNEL,
      },
    });
    scheduledDeadline = timer.endsAt;
  } catch (error) {
    await dismissRunningStatus();
    throw error;
  }
}

export function syncTimerNotification(
  timer: TimerState,
  taskTitle: string,
  enabled: boolean,
  breakMinutes = 5,
): Promise<void> {
  // Keep rapid start/pause/reset requests ordered so an old async start cannot
  // leave an alarm behind after a later pause.
  queue = queue.catch(() => undefined).then(() => reconcile(timer, taskTitle, enabled, breakMinutes));
  return queue;
}

export function hasScheduledAlarm(deadline: number): boolean {
  return scheduledDeadline === deadline;
}

export async function playForegroundAlarm(): Promise<void> {
  Vibration.vibrate(VIBRATION);
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
  if (!player) player = createAudioPlayer(require('../assets/sounds/timer-chime.wav'));
  await player.seekTo(0);
  player.play();
}

export async function testPhoneAlert(enabled: boolean): Promise<void> {
  if (!enabled || Platform.OS === 'web') {
    await playForegroundAlarm();
    return;
  }
  await createChannels();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error('Allow notifications in phone settings before testing.');
  await Notifications.scheduleNotificationAsync({
    identifier: 'focus-garden-alert-test',
    content: {
      title: 'Focus Garden alert test',
      body: 'This is the sound and vibration for focus and break completion.',
      sound: 'default',
      vibrate: VIBRATION,
      data: { kind: 'test' },
    },
    trigger: { channelId: ALARM_CHANNEL },
  });
}
