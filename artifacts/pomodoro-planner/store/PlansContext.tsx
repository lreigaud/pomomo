import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocus } from './FocusContext';
import { withStartupDeadline } from '@/services/startup';
import { PlannedTask, PlanInput, requestPlanPermission, syncPlannedReminders, validatePlan } from '@/services/plannedReminders';

export type { PlannedTask, PlanInput } from '@/services/plannedReminders';
const STORAGE_KEY = 'focus-garden-plans-v1';

type PlansValue = {
  plans: PlannedTask[];
  isReady: boolean;
  error: string | null;
  notificationError: string | null;
  isBusy: boolean;
  savePlan: (input: PlanInput) => Promise<void>;
  deletePlan: (id: string) => Promise<void>;
  retryLoad: () => void;
  refreshNotifications: () => Promise<void>;
};
const PlansContext = createContext<PlansValue | null>(null);

function readPlans(saved: string | null): PlannedTask[] {
  if (saved === null) return [];
  const parsed: unknown = JSON.parse(saved);
  if (!Array.isArray(parsed) || parsed.some(plan =>
    !plan || typeof plan.id !== 'string' || typeof plan.taskId !== 'string' ||
    !Number.isSafeInteger(plan.dueAt) || !Number.isFinite(new Date(plan.dueAt).getTime()) ||
    (plan.endAt !== undefined && (
      !Number.isSafeInteger(plan.endAt) || !Number.isFinite(new Date(plan.endAt).getTime()) || plan.endAt <= plan.dueAt
    )) ||
    !Number.isSafeInteger(plan.reminderMinutes) || plan.reminderMinutes < 1 ||
    !Number.isSafeInteger(plan.createdAt),
  ) || new Set(parsed.map(plan => plan.id)).size !== parsed.length) {
    throw new Error('Invalid saved plans');
  }
  return parsed;
}

export function PlansProvider({ children }: { children: ReactNode }) {
  const { tasks, isReady: focusReady } = useFocus();
  const [plans, setPlans] = useState<PlannedTask[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const current = useRef<PlannedTask[]>([]);
  const currentTasks = useRef(tasks);
  currentTasks.current = tasks;
  const mutations = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const syncVersion = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; syncVersion.current++; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void withStartupDeadline(
      Promise.resolve().then(() => AsyncStorage.getItem(STORAGE_KEY)),
      'Loading plans took too long.',
    ).then(saved => {
      if (cancelled) return;
      const restored = readPlans(saved);
      current.current = restored;
      setPlans(restored);
      setError(null);
      setIsReady(true);
    }).catch(() => {
      if (!cancelled) setError('Your plans could not be loaded. They have not been changed. Tap Try again.');
    });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const refreshNotifications = useCallback(async () => {
    if (!isReady || !focusReady) return;
    const version = ++syncVersion.current;
    try {
      await withStartupDeadline(
        syncPlannedReminders(current.current, currentTasks.current),
        'Scheduling reminders took too long. Please retry.',
      );
      if (mounted.current && version === syncVersion.current) setNotificationError(null);
    } catch (failure) {
      if (mounted.current && version === syncVersion.current) {
        setNotificationError(failure instanceof Error ? failure.message : 'Reminders could not be scheduled. Please retry.');
      }
    }
  }, [isReady, focusReady]);

  useEffect(() => {
    if (!isReady || !focusReady) return;
    // Archiving/deleting a task cancels its alerts without touching focus timers.
    void refreshNotifications();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshNotifications();
    });
    return () => listener.remove();
  }, [tasks, isReady, focusReady, refreshNotifications]);

  const commit = useCallback(async (next: PlannedTask[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      if (mounted.current) setError('Your plans could not be saved. Reload your saved plans before trying again.');
      throw new Error('Your plan changes could not be saved.');
    }
    current.current = next;
    if (mounted.current) setPlans(next);
    await refreshNotifications();
  }, [refreshNotifications]);

  const mutate = useCallback(async (work: () => Promise<void>) => {
    if (!isReady || !focusReady || error) throw new Error('Load your saved plans before making changes.');
    setIsBusy(true);
    const request = mutations.current.catch(() => undefined).then(work);
    mutations.current = request;
    try {
      // Permission dialogs are user-controlled and must not time out while the
      // user is deciding. Keep native writes serialized until they really settle.
      await request;
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }, [isReady, focusReady, error]);

  const savePlan = useCallback((input: PlanInput) => mutate(async () => {
    validatePlan(input);
    if (!currentTasks.current.some(task => task.id === input.taskId && !task.archived)) {
      throw new Error('Choose an active task.');
    }
    try {
      await requestPlanPermission();
    } catch (failure) {
      const detail = failure && typeof failure === 'object' && 'message' in failure && typeof failure.message === 'string'
        ? failure.message : 'Allow notifications in phone settings to save a reminder.';
      if (mounted.current) setNotificationError(detail);
      throw new Error(`Event not saved. ${detail}`);
    }
    // Permission dialogs can stay open long enough for the selected time to pass.
    validatePlan(input);
    if (!currentTasks.current.some(task => task.id === input.taskId && !task.archived)) {
      throw new Error('This task is no longer active.');
    }
    const existing = input.id ? current.current.find(plan => plan.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('This plan no longer exists. Create a new plan instead.');
    const plan: PlannedTask = {
      taskId: input.taskId, dueAt: input.dueAt, reminderMinutes: input.reminderMinutes,
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
      id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await commit(existing
      ? current.current.map(item => item.id === existing.id ? plan : item)
      : [...current.current, plan]);
  }), [mutate, commit]);

  const deletePlan = useCallback((id: string) => mutate(async () => {
    await commit(current.current.filter(plan => plan.id !== id));
  }), [mutate, commit]);

  const retryLoad = useCallback(() => {
    // Finish any pending native write before re-reading its committed result.
    setIsBusy(true);
    void withStartupDeadline(
      mutations.current.catch(() => undefined),
      'A save is still pending. Try again shortly.',
    ).then(() => {
      if (!mounted.current) return;
      setIsReady(false);
      setError(null);
      setLoadAttempt(attempt => attempt + 1);
    }).catch(() => {
      if (mounted.current) setError('A save is still pending. Your other tasks and history are unchanged. Try again shortly.');
    }).finally(() => { if (mounted.current) setIsBusy(false); });
  }, []);

  const value = useMemo(() => ({
    plans, isReady, error, notificationError, isBusy, savePlan, deletePlan, retryLoad, refreshNotifications,
  }), [plans, isReady, error, notificationError, isBusy, savePlan, deletePlan, retryLoad, refreshNotifications]);
  return <PlansContext.Provider value={value}>{children}</PlansContext.Provider>;
}

export function usePlans(): PlansValue {
  const value = useContext(PlansContext);
  if (!value) throw new Error('usePlans must be used within PlansProvider');
  return value;
}
