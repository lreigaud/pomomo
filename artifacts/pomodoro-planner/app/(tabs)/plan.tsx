import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { AppText as Text, AppTextInput as TextInput } from '@/components/AppText';
import { ActionButton, IconButton, Label, Page, PageHeading, Surface } from '@/components/AppUI';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DayCalendar } from '@/components/DayCalendar';
import { useColors } from '@/hooks/useColors';
import { useFocus } from '@/store/FocusContext';
import { PlannedTask, usePlans } from '@/store/PlansContext';
import { focusMinutesFor } from '@/utils/taskDuration';
import {
  REMINDER_PRESETS,
  formatDateInput,
  formatLead,
  formatPlanWhen,
  formatTimeInput,
  parseLocalDateTime,
  parseReminderMinutes,
} from '@/utils/planDate';

type Errors = { task?: string; date?: string; time?: string; endDate?: string; endTime?: string; minutes?: string; form?: string };

const isWeb = Platform.OS === 'web';

function defaultDue(): number {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d.getTime();
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function PlanScreen() {
  const colors = useColors();
  const { tasks, isReady: tasksReady } = useFocus();
  const {
    plans, isReady, error, notificationError, isBusy,
    savePlan, deletePlan, retryLoad, refreshNotifications,
  } = usePlans();

  const activeTasks = useMemo(() => tasks.filter((t) => !t.archived), [tasks]);
  const taskTitle = (id: string) => tasks.find((t) => t.id === id)?.title ?? 'Removed task';
  const taskIsActive = (id: string) => tasks.some((task) => task.id === id && !task.archived);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') setNow(Date.now());
    });
    return () => { clearInterval(interval); listener.remove(); };
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const initialDue = useMemo(defaultDue, []);
  const [dateText, setDateText] = useState(formatDateInput(initialDue));
  const [timeText, setTimeText] = useState(formatTimeInput(initialDue));
  const [endDateText, setEndDateText] = useState(formatDateInput(initialDue + 25 * 60000));
  const [endTimeText, setEndTimeText] = useState(formatTimeInput(initialDue + 25 * 60000));
  const [manualEnd, setManualEnd] = useState(false);
  const [calendarDate, setCalendarDate] = useState(formatDateInput(Date.now()));
  const [showForm, setShowForm] = useState(false);
  const [preset, setPreset] = useState<number | 'custom'>(15);
  const [customText, setCustomText] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PlannedTask | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const { upcoming, past } = useMemo(() => {
    const sorted = [...plans].sort((a, b) => a.dueAt - b.dueAt);
    return {
      upcoming: sorted.filter((p) => p.dueAt > now),
      past: sorted.filter((p) => p.dueAt <= now).reverse(),
    };
  }, [plans, now]);

  const locked = !isReady || !!error || isBusy;
  const editingPlan = editingId ? plans.find((p) => p.id === editingId) ?? null : null;
  const selectedTask = tasks.find((t) => t.id === taskId);
  const selectableTasks = useMemo(() => {
    if (selectedTask && selectedTask.archived) return [selectedTask, ...activeTasks];
    return activeTasks;
  }, [selectedTask, activeTasks]);

  function setEnd(timestamp: number) {
    setEndDateText(formatDateInput(timestamp));
    setEndTimeText(formatTimeInput(timestamp));
  }

  function updateAutomaticEnd(date: string, time: string, selectedId = taskId) {
    const parsed = parseLocalDateTime(date, time);
    if (!manualEnd && parsed.ok) {
      setEnd(parsed.value + focusMinutesFor(tasks.find(t => t.id === selectedId)) * 60000);
    }
  }

  function resetForm() {
    const due = defaultDue();
    setEditingId(null);
    setTaskId(null);
    setDateText(formatDateInput(due));
    setTimeText(formatTimeInput(due));
    setEnd(due + 25 * 60000);
    setManualEnd(false);
    setPreset(15);
    setCustomText('');
    setErrors({});
  }

  function startNew(timestamp?: number) {
    if (locked) return;
    resetForm();
    const selectedDay = parseLocalDateTime(calendarDate, '09:00');
    const due = timestamp ?? (calendarDate === formatDateInput(Date.now())
      ? defaultDue() : selectedDay.ok ? selectedDay.value : defaultDue());
    setDateText(formatDateInput(due));
    setTimeText(formatTimeInput(due));
    setCalendarDate(formatDateInput(due));
    const first = activeTasks[0];
    setTaskId(first?.id ?? null);
    setEnd(due + focusMinutesFor(first) * 60000);
    setSavedNote(null);
    setShowForm(true);
  }

  function startEdit(plan: PlannedTask) {
    setEditingId(plan.id);
    setTaskId(plan.taskId);
    setDateText(formatDateInput(plan.dueAt));
    setTimeText(formatTimeInput(plan.dueAt));
    setEnd(plan.endAt ?? plan.dueAt + focusMinutesFor(tasks.find(t => t.id === plan.taskId)) * 60000);
    setManualEnd(true);
    setCalendarDate(formatDateInput(plan.dueAt));
    setShowForm(true);
    if ((REMINDER_PRESETS as readonly number[]).includes(plan.reminderMinutes)) {
      setPreset(plan.reminderMinutes);
      setCustomText('');
    } else {
      setPreset('custom');
      setCustomText(String(plan.reminderMinutes));
    }
    setErrors({});
    setSavedNote(null);
  }

  async function submit() {
    if (locked) return;
    const next: Errors = {};
    const task = tasks.find((t) => t.id === taskId);
    if (!task) next.task = 'Choose a task to plan.';
    else if (task.archived) next.task = 'This task is archived. Restore it in Tasks or choose an active task.';
    const parsed = parseLocalDateTime(dateText, timeText);
    if (!parsed.ok) next[parsed.field] = parsed.message;
    const end = parseLocalDateTime(endDateText, endTimeText);
    if (!end.ok) next[end.field === 'date' ? 'endDate' : 'endTime'] = end.message;
    else if (parsed.ok && end.value <= parsed.value) next.endTime = 'End time must be after the start. For an overnight event, choose the next end date.';
    const minutes = preset === 'custom' ? parseReminderMinutes(customText) : preset;
    if (minutes === null) next.minutes = 'Enter a whole number of minutes greater than 0.';
    const now = Date.now();
    if (parsed.ok) {
      if (parsed.value <= now) next.time = 'That due time has already passed. Pick a later time.';
      else if (minutes !== null && parsed.value - minutes * 60000 <= now) {
        next.minutes = `A reminder ${formatLead(minutes)} would already be in the past. Shorten it or move the due time later.`;
      }
    }
    setErrors(next);
    if (Object.keys(next).length || !parsed.ok || !end.ok || minutes === null || !taskId) return;
    try {
      await savePlan({ id: editingId ?? undefined, taskId, dueAt: parsed.value, endAt: end.value, reminderMinutes: minutes });
      setSavedNote(editingId ? 'Plan updated.' : 'Plan saved.');
      setCalendarDate(formatDateInput(parsed.value));
      setShowForm(false);
      resetForm();
    } catch (e) {
      setErrors({ form: errMsg(e, 'Could not save this plan. Try again.') });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || isBusy) return;
    const target = pendingDelete;
    try {
      setDeleteError(null);
      await deletePlan(target.id);
      if (editingId === target.id) resetForm();
      setPendingDelete(null);
    } catch (e) {
      setPendingDelete(null);
      setDeleteError(errMsg(e, 'Could not cancel this plan. Try again.'));
    }
  }

  async function retryScheduling() {
    try {
      setRetryError(null);
      await refreshNotifications();
    } catch (e) {
      setRetryError(errMsg(e, 'Reminders still could not be scheduled.'));
    }
  }

  function openSettings() {
    Linking.openSettings().catch(() => setRetryError('Could not open settings. Open them from your phone and allow notifications for pomomo.'));
  }

  const heading = (
    <PageHeading
      eyebrow="Dated reminders"
      title="Plan"
      subtitle="Your day, one focus block at a time. Tap a time to plan a task."
    />
  );

  if (!tasksReady || (!isReady && !error)) {
    return (
      <Page>
        {heading}
        <Surface style={styles.center}>
          <View style={[styles.skeleton, { backgroundColor: colors.muted, width: '70%' }]} />
          <View style={[styles.skeleton, { backgroundColor: colors.muted, width: '45%' }]} />
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading your plans…</Text>
          <ActionButton label="Retry loading" icon="refresh-cw" secondary testID="plan-retry-loading" onPress={retryLoad} />
        </Surface>
      </Page>
    );
  }

  const minutesPreview = preset === 'custom' ? parseReminderMinutes(customText) : preset;
  const parsedPreview = parseLocalDateTime(dateText, timeText);

  return (
    <Page>
      {heading}

      <DayCalendar
        date={calendarDate}
        onDateChange={setCalendarDate}
        events={plans.map(plan => ({
          id: plan.id,
          title: taskTitle(plan.taskId),
          startAt: plan.dueAt,
          endAt: plan.endAt ?? plan.dueAt + focusMinutesFor(tasks.find(t => t.id === plan.taskId)) * 60000,
          paused: !taskIsActive(plan.taskId),
        }))}
        onSelectSlot={timestamp => { if (activeTasks.length) startNew(timestamp); }}
        onSelectEvent={id => { const plan = plans.find(p => p.id === id); if (plan) startEdit(plan); }}
        disabled={locked}
      />
      <ActionButton label="Add event" icon="plus" testID="plan-add-event" disabled={locked || activeTasks.length === 0} onPress={() => startNew()} />
      {savedNote ? <Text accessibilityLiveRegion="polite" testID="plan-saved-note" style={[styles.help, { color: colors.primary }]}>{savedNote}</Text> : null}

      {error ? (
        <View accessibilityRole="alert" testID="plan-load-error" style={[styles.banner, { backgroundColor: colors.accent, borderColor: colors.border }]}>
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <View style={styles.bannerBody}>
            <Text style={[styles.bannerText, { color: colors.foreground }]}>{error}</Text>
            <Text style={[styles.small, { color: colors.mutedForeground }]}>Planning is paused until your saved plans load, so nothing gets overwritten.</Text>
            <ActionButton label="Try again" icon="refresh-cw" secondary testID="plan-retry-load" onPress={retryLoad} />
          </View>
        </View>
      ) : null}

      {notificationError || retryError ? (
        <View accessibilityRole="alert" testID="plan-notification-error" style={[styles.banner, { backgroundColor: colors.accent, borderColor: colors.border }]}>
          <Feather name="bell-off" size={16} color={colors.destructive} />
          <View style={styles.bannerBody}>
            <Text style={[styles.bannerText, { color: colors.foreground }]}>{retryError ?? notificationError}</Text>
            <Text style={[styles.small, { color: colors.mutedForeground }]}>Phone reminders need attention. Check permissions, then save your plan or retry the reminders for saved plans.</Text>
            <View style={styles.row}>
              <ActionButton label="Retry reminders" icon="refresh-cw" secondary disabled={isBusy} testID="plan-retry-notifications" onPress={() => { void retryScheduling(); }} style={styles.flex} />
              {!isWeb ? <ActionButton label="Settings" icon="settings" secondary testID="plan-open-settings" onPress={openSettings} style={styles.flex} /> : null}
            </View>
          </View>
        </View>
      ) : null}

      {deleteError ? (
        <View accessibilityRole="alert" testID="plan-delete-error" style={[styles.banner, { backgroundColor: colors.accent, borderColor: colors.border }]}>
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <Text style={[styles.bannerText, styles.flex, { color: colors.foreground }]}>{deleteError}</Text>
          <IconButton icon="x" label="Dismiss" testID="plan-dismiss-delete-error" onPress={() => setDeleteError(null)} />
        </View>
      ) : null}

      {isWeb ? (
        <View testID="plan-web-note" style={[styles.tip, { backgroundColor: colors.secondary }]}>
          <Feather name="smartphone" size={16} color={colors.primary} />
          <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
            Reminder notifications only fire on Android and iOS. In the browser you can still plan and keep a record.
          </Text>
        </View>
      ) : null}

      {activeTasks.length === 0 && !editingId ? (
        <Surface style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
            <Feather name="calendar" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No active tasks to plan.</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Plans attach to a task. Add one, or restore an archived task, then come back to give it a date.</Text>
          <ActionButton label="Add a task" icon="plus" testID="plan-add-task" onPress={() => router.push('/task' as Href)} />
        </Surface>
      ) : null}
      {showForm ? <Modal
        testID="plan-event-modal"
        visible={showForm}
        animationType="slide"
        onRequestClose={() => { if (!isBusy) { setShowForm(false); resetForm(); } }}
      >
        <Page keyboardAware>
        <Surface style={styles.form}>
          <View style={styles.formHead}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>
              {editingPlan ? 'Edit event' : 'New event'}
            </Text>
            <IconButton icon="x" label="Close event editor" disabled={isBusy} testID="plan-close-editor" onPress={() => { setShowForm(false); resetForm(); }} />
          </View>

          <View style={styles.field}>
            <Label>Task</Label>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {selectableTasks.map((t) => {
                const on = t.id === taskId;
                return (
                  <Pressable
                    key={t.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: locked }}
                    disabled={locked}
                    testID={`plan-task-${t.id}`}
                    onPress={() => { setTaskId(t.id); updateAutomaticEnd(dateText, timeText, t.id); setErrors((e) => ({ ...e, task: undefined })); }}
                    style={[styles.chip, { backgroundColor: on ? colors.primary : colors.secondary, borderColor: on ? colors.primary : colors.border }]}
                  >
                    {on ? <Feather name="check" size={13} color={colors.primaryForeground} /> : null}
                    <Text numberOfLines={1} style={[styles.chipText, { color: on ? colors.primaryForeground : colors.secondaryForeground }]}>
                      {t.title}{t.archived ? ' (archived)' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {errors.task ? <FieldError id="plan-task-error" text={errors.task} /> : null}
          </View>

          <View style={styles.row}>
            <View style={[styles.field, styles.flex]}>
              <Label>Start date</Label>
              <TextInput
                testID="plan-date-input"
                accessibilityLabel="Due date, format year dash month dash day"
                value={dateText}
                onChangeText={(v) => { setDateText(v); updateAutomaticEnd(v, timeText); setErrors((e) => ({ ...e, date: undefined })); }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                editable={!locked}
                maxLength={10}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: errors.date ? colors.destructive : colors.input }]}
              />
              <Text style={[styles.help, { color: colors.mutedForeground }]}>YYYY-MM-DD</Text>
            </View>
            <View style={[styles.field, styles.timeField]}>
              <Label>Start time</Label>
              <TextInput
                testID="plan-time-input"
                accessibilityLabel="Due time, 24 hour, hours colon minutes"
                value={timeText}
                onChangeText={(v) => { setTimeText(v); updateAutomaticEnd(dateText, v); setErrors((e) => ({ ...e, time: undefined })); }}
                placeholder="HH:MM"
                placeholderTextColor={colors.mutedForeground}
                editable={!locked}
                maxLength={5}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: errors.time ? colors.destructive : colors.input }]}
              />
              <Text style={[styles.help, { color: colors.mutedForeground }]}>24-hour</Text>
            </View>
          </View>
          {errors.date ? <FieldError id="plan-date-error" text={errors.date} /> : null}
          {errors.time ? <FieldError id="plan-time-error" text={errors.time} /> : null}
          <View style={styles.row}>
            <View style={[styles.field, styles.flex]}>
              <Label>End date</Label>
              <TextInput testID="plan-end-date-input" accessibilityLabel="Event end date, year dash month dash day"
                value={endDateText} onChangeText={v => { setEndDateText(v); setManualEnd(true); setErrors(e => ({ ...e, endDate: undefined })); }}
                placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} editable={!locked}
                maxLength={10} keyboardType="numbers-and-punctuation" autoCorrect={false}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: errors.endDate ? colors.destructive : colors.input }]} />
            </View>
            <View style={[styles.field, styles.timeField]}>
              <Label>End time</Label>
              <TextInput testID="plan-end-time-input" accessibilityLabel="Event end time, 24 hour"
                value={endTimeText} onChangeText={v => { setEndTimeText(v); setManualEnd(true); setErrors(e => ({ ...e, endTime: undefined })); }}
                placeholder="HH:MM" placeholderTextColor={colors.mutedForeground} editable={!locked}
                maxLength={5} keyboardType="numbers-and-punctuation" autoCorrect={false}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: errors.endTime ? colors.destructive : colors.input }]} />
            </View>
          </View>
          {errors.endDate ? <FieldError id="plan-end-date-error" text={errors.endDate} /> : null}
          {errors.endTime ? <FieldError id="plan-end-time-error" text={errors.endTime} /> : null}
          <Text style={[styles.help, { color: colors.mutedForeground }]}>The default block is one focus session. Change its end time to reserve more time. Reminders arrive before the start.</Text>
          <Text style={[styles.help, { color: colors.mutedForeground }]}>Uses this device’s local time zone.</Text>

          <View style={styles.field}>
            <Label>Remind me</Label>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {[...REMINDER_PRESETS, 'custom' as const].map((p) => {
                const on = preset === p;
                return (
                  <Pressable
                    key={String(p)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: locked }}
                    disabled={locked}
                    testID={`plan-reminder-${p}`}
                    onPress={() => { setPreset(p); setErrors((e) => ({ ...e, minutes: undefined })); }}
                    style={[styles.chip, styles.leadChip, { backgroundColor: on ? colors.primary : colors.secondary, borderColor: on ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.chipText, { color: on ? colors.primaryForeground : colors.secondaryForeground }]}>
                      {p === 'custom' ? 'Custom' : `${p} min`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {preset === 'custom' ? (
              <View style={styles.customRow}>
                <TextInput
                  testID="plan-custom-minutes-input"
                  accessibilityLabel="Custom reminder minutes before due time"
                  value={customText}
                  onChangeText={(v) => { setCustomText(v); setErrors((e) => ({ ...e, minutes: undefined })); }}
                  placeholder="45"
                  placeholderTextColor={colors.mutedForeground}
                  editable={!locked}
                  keyboardType="number-pad"
                  maxLength={5}
                  style={[styles.input, styles.customInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: errors.minutes ? colors.destructive : colors.input }]}
                />
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>minutes before due time</Text>
              </View>
            ) : null}
            {errors.minutes ? <FieldError id="plan-minutes-error" text={errors.minutes} /> : null}
            {parsedPreview.ok && minutesPreview ? (
              <Text testID="plan-reminder-preview" style={[styles.help, { color: colors.mutedForeground }]}>
                Reminder at {formatPlanWhen(parsedPreview.value - minutesPreview * 60000)}
              </Text>
            ) : null}
          </View>

          <View style={[styles.tip, { backgroundColor: colors.secondary }]}>
            <Feather name="info" size={15} color={colors.primary} />
            <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
              One-time reminder for this date only. The task’s repeat days stay exactly as they are.
            </Text>
          </View>

          {errors.form ? <FieldError id="plan-form-error" text={errors.form} /> : null}

          <ActionButton
            label={isBusy ? 'Saving…' : editingId ? 'Update event' : 'Save event'}
            icon="calendar"
            disabled={locked}
            testID="plan-save"
            onPress={() => { void submit(); }}
          />
          {editingPlan ? (
            <ActionButton
              label="Cancel this plan"
              icon="trash-2"
              secondary
              disabled={locked}
              testID="plan-delete-editing"
              onPress={() => { setShowForm(false); setPendingDelete(editingPlan); }}
            />
          ) : null}
        </Surface>
        </Page>
      </Modal> : null}

      <PlanSection
        title="Upcoming"
        plans={upcoming}
        empty="Nothing dated yet. Your next planned focus block will appear here."
        taskTitle={taskTitle}
        taskIsActive={taskIsActive}
        editingId={editingId}
        disabled={locked}
        onEdit={startEdit}
        onDelete={setPendingDelete}
        upcoming
      />
      <PlanSection
        title="Past"
        plans={past}
        empty="Past plans collect here as a quiet record."
        taskTitle={taskTitle}
        taskIsActive={taskIsActive}
        editingId={editingId}
        disabled={locked}
        onEdit={startEdit}
        onDelete={setPendingDelete}
      />

      {pendingDelete ? <ConfirmDialog
        visible={pendingDelete !== null}
        heading={pendingDelete && pendingDelete.dueAt > Date.now() ? 'Cancel this plan?' : 'Delete this record?'}
        message={pendingDelete
          ? `${taskTitle(pendingDelete.taskId)} on ${formatPlanWhen(pendingDelete.dueAt)}. Any pending reminder is removed. The task itself and its repeat days are not changed.`
          : ''}
        confirmLabel={pendingDelete && pendingDelete.dueAt > Date.now() ? 'Cancel plan' : 'Delete record'}
        disabled={isBusy}
        testID="plan-delete-dialog"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { void confirmDelete(); }}
      /> : null}
    </Page>
  );
}

function FieldError({ id, text }: { id: string; text: string }) {
  const colors = useColors();
  return (
    <View accessibilityRole="alert" testID={id} style={styles.errorRow}>
      <Feather name="alert-circle" size={13} color={colors.destructive} />
      <Text style={[styles.errorText, { color: colors.destructive }]}>{text}</Text>
    </View>
  );
}

function PlanSection({
  title, plans, empty, taskTitle, taskIsActive, editingId, disabled, onEdit, onDelete, upcoming,
}: {
  title: string;
  plans: PlannedTask[];
  empty: string;
  taskTitle: (id: string) => string;
  taskIsActive: (id: string) => boolean;
  editingId: string | null;
  disabled: boolean;
  onEdit: (p: PlannedTask) => void;
  onDelete: (p: PlannedTask) => void;
  upcoming?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.section} testID={`plan-section-${title.toLowerCase()}`}>
      <View style={styles.sectionHead}>
        <Label>{title}</Label>
        <Text style={[styles.small, { color: colors.mutedForeground }]}>{plans.length}</Text>
      </View>
      {plans.length === 0 ? (
        <View style={[styles.emptyRow, { borderColor: colors.border }]}>
          <Feather name={upcoming ? 'calendar' : 'clock'} size={16} color={colors.mutedForeground} />
          <Text style={[styles.tipText, { color: colors.mutedForeground }]}>{empty}</Text>
        </View>
      ) : (
        plans.map((p) => {
          const editing = p.id === editingId;
          const remindAt = p.dueAt - p.reminderMinutes * 60000;
          return (
            <Surface key={p.id} style={[styles.planCard, editing && { borderColor: colors.primary }]}>
              <View style={[styles.rail, { backgroundColor: upcoming ? colors.primary : colors.muted }]} />
              <View style={styles.flex}>
                <Text numberOfLines={2} style={[styles.planTitle, { color: upcoming ? colors.foreground : colors.mutedForeground }]}>{taskTitle(p.taskId)}</Text>
                <Text style={[styles.planWhen, { color: upcoming ? colors.primary : colors.mutedForeground }]}>{formatPlanWhen(p.dueAt)}</Text>
                <Text style={[styles.small, { color: colors.mutedForeground }]}>
                  {!taskIsActive(p.taskId) && upcoming
                    ? 'Reminder paused — task archived or removed'
                    : upcoming
                    ? `Reminder ${formatLead(p.reminderMinutes)}${remindAt <= Date.now() ? ' (reminder time passed)' : ''}`
                    : `Was due · reminder ${formatLead(p.reminderMinutes)}`}
                  {editing ? ' · editing' : ''}
                </Text>
              </View>
              {upcoming ? (
                <IconButton icon="edit-2" label={`Edit plan for ${taskTitle(p.taskId)}`} disabled={disabled} testID={`plan-edit-${p.id}`} onPress={() => onEdit(p)} />
              ) : null}
              <IconButton
                icon={upcoming ? 'x-circle' : 'trash-2'}
                label={`${upcoming ? 'Cancel' : 'Delete'} plan for ${taskTitle(p.taskId)}`}
                color={colors.mutedForeground}
                disabled={disabled}
                testID={`plan-delete-${p.id}`}
                onPress={() => onDelete(p)}
              />
            </Surface>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  center: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 22 },
  skeleton: { height: 12, borderRadius: 6 },
  muted: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  small: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  banner: { borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  bannerBody: { flex: 1, gap: 8 },
  bannerText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 14 },
  tipText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  emptyIcon: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  emptyText: { maxWidth: 280, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  form: { gap: 14 },
  formHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  formTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 13, paddingVertical: 8 },
  field: { gap: 7 },
  timeField: { width: 108 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, maxWidth: '100%', borderRadius: 12, borderWidth: 1, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 },
  leadChip: { minWidth: 70, justifyContent: 'center' },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, flexShrink: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontFamily: 'Inter_500Medium', fontSize: 16 },
  help: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customInput: { width: 90 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, padding: 14 },
  planCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingLeft: 12 },
  rail: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  planTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
  planWhen: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 2 },
});
