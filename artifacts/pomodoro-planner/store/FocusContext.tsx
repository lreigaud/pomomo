import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Linking, Platform } from 'react-native';
import {
  hasScheduledAlarm,
  playForegroundAlarm,
  requestPhoneAlerts,
  syncTimerNotification,
  testPhoneAlert,
} from '@/services/timerAlerts';
import { withStartupDeadline } from '@/services/startup';
import { breakMinutesFor, taskDurationMs } from '@/utils/taskDuration';

const STORAGE_KEY = 'focus-garden-data-v1';
const FOCUS_MS = 25 * 60 * 1000;

export type TimerMode = 'focus' | 'break';

export type FocusTask = {
  id: string;
  title: string;
  targetSessions: number;
  /** Monday = 1 ... Sunday = 7. An empty list means a one-time task. */
  repeatDays: number[];
  createdAt: number;
  archived: boolean;
  /** Missing values preserve older tasks' 25-minute focus / automatic short break. */
  focusMinutes?: number;
  /** Missing means one fifth of the focus duration; a value is a manual override. */
  breakMinutes?: number;
};

export type FocusSession = {
  id: string;
  taskId: string;
  /** Retained when a task is permanently removed from the planner. */
  taskTitle?: string;
  completedAt: number;
  minutes: number;
};

export type TimerState = {
  mode: TimerMode;
  isRunning: boolean;
  remainingMs: number;
  totalMs: number;
  endsAt: number | null;
  taskId: string | null;
  /** A running cycle keeps its break length even if the task is edited. */
  breakDurationMs?: number;
  sessionStarted?: boolean;
};

type AppData = {
  tasks: FocusTask[];
  sessions: FocusSession[];
  timer: TimerState;
  alertsEnabled: boolean;
};

type FocusContextValue = {
  tasks: FocusTask[];
  sessions: FocusSession[];
  timer: TimerState;
  remainingMs: number;
  isReady: boolean;
  storageError: string | null;
  retryLoad: () => void;
  alertsEnabled: boolean;
  alertBusy: boolean;
  alertError: string | null;
  alertPermissionBlocked: boolean;
  enableAlerts: () => Promise<void>;
  disableAlerts: () => void;
  testAlerts: () => Promise<void>;
  addTask: (task: Omit<FocusTask, 'id' | 'createdAt' | 'archived'>) => void;
  updateTask: (task: FocusTask) => void;
  archiveTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  selectTask: (taskId: string) => void;
  startTimer: (taskId?: string) => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  changeTimerMode: (mode: TimerMode) => void;
};

const initialTimer: TimerState = {
  mode: 'focus',
  isRunning: false,
  remainingMs: FOCUS_MS,
  totalMs: FOCUS_MS,
  endsAt: null,
  taskId: null,
};

const FocusContext = createContext<FocusContextValue | null>(null);

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mondayFirstDay(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

export function getTaskSessionCount(
  task: FocusTask,
  sessions: FocusSession[],
  date = new Date(),
): number {
  const taskSessions = sessions.filter((session) => session.taskId === task.id);
  if (task.repeatDays.length === 0) return taskSessions.length;
  const dateKey = localDateKey(date);
  return taskSessions.filter(
    (session) => localDateKey(new Date(session.completedAt)) === dateKey,
  ).length;
}

export function isTaskComplete(
  task: FocusTask,
  sessions: FocusSession[],
  date = new Date(),
): boolean {
  return getTaskSessionCount(task, sessions, date) >= task.targetSessions;
}

function durationFor(mode: TimerMode, task?: FocusTask): number {
  return taskDurationMs(mode, task);
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>({
    tasks: [],
    sessions: [],
    timer: initialTimer,
    alertsEnabled: false,
  });
  const [isReady, setIsReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryLoad = useCallback(() => {
    setIsReady(false);
    setStorageError(null);
    setLoadAttempt((attempt) => attempt + 1);
  }, []);
  const [clockNow, setClockNow] = useState(Date.now());
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertPermissionBlocked, setAlertPermissionBlocked] = useState(false);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const finishGuard = useRef(false);

  useEffect(() => {
    let mounted = true;
    void withStartupDeadline(
      Promise.resolve().then(() => AsyncStorage.getItem(STORAGE_KEY)),
      'Reading your saved data took too long.',
    )
      .then((saved) => {
        if (!mounted) return;
        if (saved) {
          const restored = JSON.parse(saved) as AppData;
          if (
            Array.isArray(restored.tasks) &&
            Array.isArray(restored.sessions) &&
            restored.timer
          ) {
            setData({ ...restored, alertsEnabled: restored.alertsEnabled === true });
          } else {
            throw new Error('Saved data could not be read.');
          }
        }
        setIsReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        // Keep navigation and writes blocked until a successful read. Retrying
        // never clears storage or replaces existing history with empty defaults.
        setStorageError('Focus Garden could not load your saved data. It has not been changed. Tap Try again to retry.');
      });
    return () => {
      mounted = false;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!isReady || storageError) return;
    const snapshot = JSON.stringify(data);
    writeQueue.current = writeQueue.current
      .then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot))
      .catch(() => {
        setStorageError('Focus Garden could not save changes to this device.');
      });
  }, [data, isReady, storageError]);

  useEffect(() => {
    const interval = setInterval(() => setClockNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setClockNow(Date.now());
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  const remainingMs =
    data.timer.isRunning && data.timer.endsAt !== null
      ? Math.max(0, data.timer.endsAt - clockNow)
      : Math.max(0, data.timer.remainingMs);

  const taskTitle = data.tasks.find((task) => task.id === data.timer.taskId)?.title ?? 'Your focus task';
  const cycleBreakMinutes = data.timer.breakDurationMs !== undefined
    ? data.timer.breakDurationMs / 60_000
    : breakMinutesFor(data.tasks.find(task => task.id === data.timer.taskId));
  useEffect(() => {
    if (!isReady) return;
    let current = true;
    void syncTimerNotification(data.timer, taskTitle, data.alertsEnabled, cycleBreakMinutes)
      .then(() => { if (current) setAlertError(null); })
      .catch(() => {
        if (current) setAlertError('Could not schedule phone alerts. Check notification permission in your phone settings; in-app sound will still work.');
      });
    return () => { current = false; };
  }, [data.timer, data.alertsEnabled, taskTitle, isReady, cycleBreakMinutes]);

  useEffect(() => {
    if (!data.timer.isRunning || remainingMs > 0 || finishGuard.current) return;
    finishGuard.current = true;
    const finishedAt = data.timer.endsAt ?? Date.now();
    // Avoid replaying an old alarm when the app is reopened. A scheduled native
    // notification already provides sound/vibration, including in foreground.
    if (
      AppState.currentState === 'active' &&
      Date.now() - finishedAt < 10000 &&
      !hasScheduledAlarm(finishedAt)
    ) {
      void playForegroundAlarm().catch(() => {
        setAlertError('The timer finished, but sound could not play. Check your phone audio settings.');
      });
    }
    setData((current) => {
      const nextMode: TimerMode = current.timer.mode === 'focus' ? 'break' : 'focus';
      const task = current.tasks.find(task => task.id === current.timer.taskId);
      const nextDuration = nextMode === 'break'
        ? current.timer.breakDurationMs ?? durationFor('break', task)
        : durationFor('focus', task);
      const newSession: FocusSession | null =
        current.timer.mode === 'focus' && current.timer.taskId
          ? {
              id: createId(),
              taskId: current.timer.taskId,
              completedAt: finishedAt,
              minutes: current.timer.totalMs / 60_000,
            }
          : null;
      return {
        ...current,
        sessions: newSession
          ? [...current.sessions, newSession]
          : current.sessions,
        timer: {
          ...current.timer,
          mode: nextMode,
          isRunning: false,
          remainingMs: nextDuration,
          totalMs: nextDuration,
          breakDurationMs: nextMode === 'break' ? nextDuration : durationFor('break', task),
          sessionStarted: false,
          endsAt: null,
        },
      };
    });
  }, [data.timer.endsAt, data.timer.isRunning, remainingMs]);

  useEffect(() => {
    if (!data.timer.isRunning) finishGuard.current = false;
  }, [data.timer.isRunning]);

  const enableAlerts = useCallback(async () => {
    if (Platform.OS === 'web') return;
    setAlertBusy(true);
    setAlertError(null);
    try {
      const permission = await requestPhoneAlerts();
      if (permission.granted) {
        setAlertPermissionBlocked(false);
        setData((current) => ({ ...current, alertsEnabled: true }));
      } else {
        setAlertPermissionBlocked(!permission.canAskAgain);
        if (!permission.canAskAgain && alertPermissionBlocked) {
          await Linking.openSettings();
        }
        setAlertError(permission.canAskAgain
          ? 'Permission was not granted. You can enable phone alerts whenever you’re ready.'
          : 'Notifications are blocked. Open phone settings, allow notifications, then tap Enable phone alerts again.');
      }
    } catch {
      setAlertError('Could not enable notifications on this device. In-app sound and vibration are still available.');
    } finally {
      setAlertBusy(false);
    }
  }, [alertPermissionBlocked]);

  const disableAlerts = useCallback(() => {
    setData((current) => ({ ...current, alertsEnabled: false }));
    setAlertError(null);
  }, []);

  const testAlerts = useCallback(async () => {
    setAlertBusy(true);
    setAlertError(null);
    try {
      await testPhoneAlert(data.alertsEnabled);
    } catch {
      setAlertError('The alert could not play. Check notification permission, volume, and Do Not Disturb settings.');
    } finally {
      setAlertBusy(false);
    }
  }, [data.alertsEnabled]);

  const addTask = useCallback(
    (task: Omit<FocusTask, 'id' | 'createdAt' | 'archived'>) => {
      const newTask: FocusTask = {
        ...task,
        id: createId(),
        createdAt: Date.now(),
        archived: false,
      };
      setData((current) => ({
        ...current,
        tasks: [...current.tasks, newTask],
        timer: current.timer.taskId || current.timer.isRunning
          ? current.timer
          : {
              ...current.timer, taskId: newTask.id,
              remainingMs: durationFor(current.timer.mode, newTask),
              totalMs: durationFor(current.timer.mode, newTask),
              breakDurationMs: durationFor('break', newTask),
              sessionStarted: false,
            },
      }));
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [],
  );

  const updateTask = useCallback((task: FocusTask) => {
    setData((current) => {
      const selected = current.timer.taskId === task.id;
      const untouched = !current.timer.isRunning && !current.timer.sessionStarted && current.timer.remainingMs === current.timer.totalMs;
      const previousTask = current.tasks.find(item => item.id === task.id);
      return {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
        timer: !selected ? current.timer : untouched
          ? {
              ...current.timer,
              totalMs: durationFor(current.timer.mode, task),
              remainingMs: durationFor(current.timer.mode, task),
              breakDurationMs: durationFor('break', task),
            }
          : {
              ...current.timer,
              breakDurationMs: current.timer.breakDurationMs ?? durationFor('break', previousTask),
            },
      };
    });
  }, []);

  const archiveTask = useCallback((taskId: string) => {
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId ? { ...task, archived: true } : task,
      ),
      timer:
        current.timer.taskId === taskId && current.timer.mode === 'focus'
          ? {
              ...current.timer,
              taskId: null,
              isRunning: false,
              endsAt: null,
              remainingMs: FOCUS_MS,
              totalMs: FOCUS_MS,
              breakDurationMs: undefined,
              sessionStarted: false,
            }
          : current.timer,
    }));
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    setData((current) => {
      const task = current.tasks.find((item) => item.id === taskId);
      // Permanent deletion is available only for archived tasks.
      if (!task?.archived) return current;
      return {
        ...current,
        tasks: current.tasks.filter((item) => item.id !== taskId),
        sessions: current.sessions.map((session) =>
          session.taskId === taskId ? { ...session, taskTitle: task.title } : session,
        ),
        timer: current.timer.taskId === taskId
          ? { ...current.timer, taskId: null }
          : current.timer,
      };
    });
  }, []);

  const selectTask = useCallback((taskId: string) => {
    setData((current) => {
      const task = current.tasks.find(task => task.id === taskId && !task.archived);
      if (!task || current.timer.isRunning || current.timer.taskId === taskId) return current;
      const duration = durationFor(current.timer.mode, task);
      return {
        ...current,
        timer: {
          ...current.timer, taskId, remainingMs: duration, totalMs: duration,
          endsAt: null, breakDurationMs: durationFor('break', task),
          sessionStarted: false,
        },
      };
    });
  }, []);

  const startTimer = useCallback((taskId?: string) => {
    setClockNow(Date.now());
    setData((current) => {
      if (current.timer.isRunning) {
        const left = Math.max(
          0,
          (current.timer.endsAt ?? Date.now()) - Date.now(),
        );
        return {
          ...current,
          timer: {
            ...current.timer,
            isRunning: false,
            remainingMs: left,
            endsAt: null,
            sessionStarted: true,
          },
        };
      }
      const selectedTaskId = taskId ?? current.timer.taskId;
      const task = current.tasks.find(task => task.id === selectedTaskId);
      if (
        current.timer.mode === 'focus' &&
        (!selectedTaskId ||
          !current.tasks.some(
            (task) => task.id === selectedTaskId && !task.archived,
          ))
      ) {
        return current;
      }
      const changedTask = selectedTaskId !== current.timer.taskId;
      const freshFocus = current.timer.mode === 'focus' && !current.timer.sessionStarted && current.timer.remainingMs === current.timer.totalMs;
      const duration = changedTask || freshFocus ? durationFor(current.timer.mode, task) : current.timer.totalMs;
      const remaining = changedTask || freshFocus ? duration : current.timer.remainingMs;
      return {
        ...current,
        timer: {
          ...current.timer,
          taskId: selectedTaskId,
          isRunning: true,
          sessionStarted: true,
          totalMs: duration,
          remainingMs: remaining,
          breakDurationMs: changedTask || freshFocus
            ? durationFor('break', task)
            : current.timer.breakDurationMs ?? durationFor('break', task),
          endsAt: Date.now() + remaining,
        },
      };
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const pauseTimer = useCallback(() => {
    setClockNow(Date.now());
    setData((current) => {
      if (!current.timer.isRunning) return current;
      return {
        ...current,
        timer: {
          ...current.timer,
          isRunning: false,
          remainingMs: Math.max(
            0,
            (current.timer.endsAt ?? Date.now()) - Date.now(),
          ),
          endsAt: null,
          sessionStarted: true,
        },
      };
    });
  }, []);

  const resetTimer = useCallback(() => {
    setData((current) => {
      const task = current.tasks.find(task => task.id === current.timer.taskId);
      const duration = durationFor(current.timer.mode, task);
      return {
        ...current,
        timer: {
          ...current.timer, isRunning: false, remainingMs: duration,
          totalMs: duration, endsAt: null, breakDurationMs: durationFor('break', task),
          sessionStarted: false,
        },
      };
    });
  }, []);

  const changeTimerMode = useCallback((mode: TimerMode) => {
    setData((current) => {
      if (current.timer.isRunning) return current;
      const task = current.tasks.find(task => task.id === current.timer.taskId);
      const duration = durationFor(mode, task);
      return {
        ...current,
        timer: {
          ...current.timer,
          mode,
          remainingMs: duration,
          totalMs: duration,
          breakDurationMs: durationFor('break', task),
          sessionStarted: false,
          endsAt: null,
        },
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      tasks: data.tasks,
      sessions: data.sessions,
      timer: data.timer,
      remainingMs,
      isReady,
      storageError,
      retryLoad,
      alertsEnabled: data.alertsEnabled,
      alertBusy,
      alertError,
      alertPermissionBlocked,
      enableAlerts,
      disableAlerts,
      testAlerts,
      addTask,
      updateTask,
      archiveTask,
      deleteTask,
      selectTask,
      startTimer,
      pauseTimer,
      resetTimer,
      changeTimerMode,
    }),
    [
      data,
      remainingMs,
      isReady,
      storageError,
      retryLoad,
      alertBusy,
      alertError,
      alertPermissionBlocked,
      enableAlerts,
      disableAlerts,
      testAlerts,
      addTask,
      updateTask,
      archiveTask,
      deleteTask,
      selectTask,
      startTimer,
      pauseTimer,
      resetTimer,
      changeTimerMode,
    ],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusContextValue {
  const context = useContext(FocusContext);
  if (!context) throw new Error('useFocus must be used inside FocusProvider');
  return context;
}
