import React, { useEffect, useMemo } from 'react';
import { router, Href } from 'expo-router';
import {
  Pressable,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { AppText as Text } from '@/components/AppText';
import Svg, { Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { ActionButton, IconButton, Label, Page, PageHeading, Surface } from '@/components/AppUI';
import {
  getTaskSessionCount,
  isTaskComplete,
  mondayFirstDay,
  useFocus,
} from '@/store/FocusContext';
import { useColors } from '@/hooks/useColors';
import { breakMinutesFor, focusMinutesFor } from '@/utils/taskDuration';

function formatTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function FocusScreen() {
  const colors = useColors();
  const {
    tasks,
    sessions,
    timer,
    remainingMs,
    isReady,
    selectTask,
    startTimer,
    resetTimer,
    changeTimerMode,
    alertsEnabled,
    alertBusy,
    alertError,
    alertPermissionBlocked,
    enableAlerts,
    disableAlerts,
    testAlerts,
  } = useFocus();

  const today = new Date();
  const todayDay = mondayFirstDay(today);
  const availableTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          !task.archived &&
          (task.repeatDays.length === 0 || task.repeatDays.includes(todayDay)) &&
          (task.repeatDays.length > 0 || !isTaskComplete(task, sessions)),
      ),
    [tasks, sessions, todayDay],
  );
  const selectedTask =
    tasks.find((task) => task.id === timer.taskId && !task.archived) ?? availableTasks[0];
  useEffect(() => {
    if (timer.mode === 'focus' && !timer.isRunning && selectedTask && selectedTask.id !== timer.taskId) {
      selectTask(selectedTask.id);
    }
  }, [timer.mode, timer.isRunning, timer.taskId, selectedTask?.id, selectTask]);
  const focusMinutes = timer.mode === 'focus' && timer.taskId === selectedTask?.id
    ? timer.totalMs / 60_000 : focusMinutesFor(selectedTask);
  const breakMinutes = timer.mode === 'break'
    ? timer.totalMs / 60_000
    : timer.taskId === selectedTask?.id && timer.breakDurationMs !== undefined
      ? timer.breakDurationMs / 60_000 : breakMinutesFor(selectedTask);
  const totalToday = sessions.filter(
    (session) =>
      new Date(session.completedAt).toDateString() === today.toDateString(),
  ).length;
  const totalMinutes = sessions
    .filter(
      (session) =>
        new Date(session.completedAt).toDateString() === today.toDateString(),
    )
    .reduce((sum, session) => sum + session.minutes, 0);
  const progress =
    timer.totalMs > 0 ? 1 - remainingMs / timer.totalMs : 0;
  const diameter = 256;
  const stroke = 10;
  const radius = (diameter - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  if (!isReady) {
    return (
      <Page scroll={false}>
        <View style={styles.loading}>
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading your focus space…</Text>
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeading
        eyebrow={today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        title="Make room to focus."
        subtitle="One small session at a time."
        right={<IconButton icon="bar-chart-2" label="View progress" onPress={() => router.navigate('/(tabs)/insights' as Href)} />}
      />

      <Surface style={styles.timerCard}>
        <View style={styles.modePicker}>
          {(['focus', 'break'] as const).map((mode) => {
            const active = timer.mode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`timer-mode-${mode}`}
                disabled={timer.isRunning}
                onPress={() => changeTimerMode(mode)}
                style={[
                  styles.modeChip,
                  {
                    backgroundColor: active ? colors.primary : 'transparent',
                    opacity: timer.isRunning && !active ? 0.45 : 1,
                  },
                ]}
              >
                <Text style={[styles.modeText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                  {mode === 'focus' ? `Focus · ${focusMinutes} min` : `Short break · ${breakMinutes} min`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.clockWrap}>
          <Svg width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`}>
            <Circle
              cx={diameter / 2}
              cy={diameter / 2}
              r={radius}
              stroke={colors.muted}
              strokeWidth={stroke}
              fill="none"
            />
            <Circle
              cx={diameter / 2}
              cy={diameter / 2}
              r={radius}
              stroke={timer.mode === 'focus' ? colors.primary : colors.terracotta}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${diameter / 2} ${diameter / 2})`}
              fill="none"
            />
          </Svg>
          <View style={styles.clockText}>
            <Feather
              name={timer.mode === 'focus' ? 'sun' : 'coffee'}
              size={18}
              color={timer.mode === 'focus' ? colors.primary : colors.terracotta}
            />
            <Text
              accessibilityLabel={`${formatTime(remainingMs)} remaining`}
              style={[styles.clock, { color: colors.foreground }]}
            >
              {formatTime(remainingMs)}
            </Text>
            <Text style={[styles.clockCaption, { color: colors.mutedForeground }]}>
              {timer.isRunning ? 'In the zone' : timer.mode === 'focus' ? 'Ready when you are' : 'Take a breather'}
            </Text>
          </View>
        </View>

        {timer.mode === 'focus' ? (
          <View style={styles.currentTask}>
            <Label>WORKING ON</Label>
            {selectedTask ? (
              <>
                <Text numberOfLines={2} style={[styles.selectedTask, { color: colors.foreground }]}>
                  {selectedTask.title}
                </Text>
                <Text style={[styles.taskCount, { color: colors.mutedForeground }]}>
                  {getTaskSessionCount(selectedTask, sessions)} of {selectedTask.targetSessions} sessions
                </Text>
              </>
            ) : (
              <View style={styles.noTask}>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>A task makes the timer count.</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Add a task, set a session goal, and start your first focus block.
                </Text>
                <ActionButton
                  label="Create a task"
                  icon="plus"
                  onPress={() => router.push('/task' as Href)}
                  testID="create-first-task"
                />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.currentTask}>
            <Label>BREAK TIME</Label>
            <Text style={[styles.breakMessage, { color: colors.foreground }]}>
              Step away for a few minutes.
            </Text>
          </View>
        )}

        <View style={styles.controls}>
          <IconButton
            icon="rotate-ccw"
            label="Reset timer"
            onPress={resetTimer}
            disabled={timer.isRunning}
          />
          <ActionButton
            label={timer.isRunning ? 'Pause' : timer.mode === 'focus' ? 'Start focus' : 'Start break'}
            icon={timer.isRunning ? 'pause' : 'play'}
            onPress={() => startTimer(timer.mode === 'focus' ? selectedTask?.id : undefined)}
            disabled={timer.mode === 'focus' && !selectedTask}
            testID="timer-start-pause"
            style={styles.startButton}
          />
          <IconButton
            icon="skip-forward"
            label={timer.mode === 'focus' ? 'Switch to break' : 'Back to focus'}
            onPress={() => changeTimerMode(timer.mode === 'focus' ? 'break' : 'focus')}
            disabled={timer.isRunning}
          />
        </View>
      </Surface>

      {availableTasks.length > 0 && timer.mode === 'focus' ? (
        <View style={styles.taskSection}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Today's focus</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/tasks' as Href)}
              testID="manage-tasks"
            >
              <Text style={[styles.link, { color: colors.primary }]}>All tasks</Text>
            </Pressable>
          </View>
          <View style={styles.taskList}>
            {availableTasks.map((task) => {
              const active = task.id === selectedTask?.id;
              const done = isTaskComplete(task, sessions);
              const count = getTaskSessionCount(task, sessions);
              return (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  testID={`select-task-${task.id}`}
                  disabled={timer.isRunning}
                  onPress={() => selectTask(task.id)}
                  style={({ pressed }) => [
                    styles.taskRow,
                    {
                      backgroundColor: active ? colors.accent : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <View style={[styles.taskDot, { backgroundColor: done ? colors.terracotta : colors.primary }]} />
                  <View style={styles.taskCopy}>
                    <Text numberOfLines={1} style={[styles.taskRowTitle, { color: colors.foreground }]}>
                      {task.title}
                    </Text>
                    <Text style={[styles.taskRowMeta, { color: colors.mutedForeground }]}>
                      {count}/{task.targetSessions} sessions
                    </Text>
                  </View>
                  {active ? <Feather name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={[styles.todayStrip, { backgroundColor: colors.secondary }]}>
        <View style={styles.todayItem}>
          <Text style={[styles.todayValue, { color: colors.foreground }]}>{totalToday}</Text>
          <Text style={[styles.todayLabel, { color: colors.mutedForeground }]}>sessions today</Text>
        </View>
        <View style={[styles.todayDivider, { backgroundColor: colors.border }]} />
        <View style={styles.todayItem}>
          <Text style={[styles.todayValue, { color: colors.foreground }]}>{totalMinutes}</Text>
          <Text style={[styles.todayLabel, { color: colors.mutedForeground }]}>focused minutes</Text>
        </View>
      </View>
      <Surface>
        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sound & phone alerts</Text>
          <Feather name={alertsEnabled ? 'bell' : 'bell-off'} size={18} color={colors.primary} />
        </View>
        <Text style={[styles.emptyText, { color: colors.mutedForeground, textAlign: 'left', maxWidth: undefined }]}>
          {Platform.OS === 'web'
            ? 'Sound can be tested here. Lock-screen alerts and phone vibration need the Android app preview.'
            : alertsEnabled
              ? 'Focus and break endings use your phone’s notification sound and vibration. The lock screen shows the session and finish time, not a live seconds countdown.'
              : 'The app rings and vibrates while open. Enable phone alerts to hear both focus and break endings with the screen locked.'}
        </Text>
        {alertError ? (
          <Text accessibilityRole="alert" style={[styles.emptyText, { color: colors.destructive, textAlign: 'left', maxWidth: undefined }]}>
            {alertError}
          </Text>
        ) : null}
        {Platform.OS !== 'web' ? (
          <ActionButton
            label={alertBusy ? 'Please wait…' : alertsEnabled ? 'Disable phone alerts' : alertPermissionBlocked ? 'Open phone settings' : 'Enable phone alerts'}
            icon={alertsEnabled ? 'bell-off' : 'bell'}
            onPress={() => { if (alertsEnabled) disableAlerts(); else void enableAlerts(); }}
            secondary={alertsEnabled}
            disabled={alertBusy}
            testID="enable-phone-alerts"
          />
        ) : null}
        <ActionButton
          label="Test ring & vibration"
          icon="volume-2"
          onPress={() => { void testAlerts(); }}
          disabled={alertBusy}
          secondary
          testID="test-timer-alert"
        />
      </Surface>
    </Page>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  timerCard: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  modePicker: { width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  modeChip: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  modeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  clockWrap: { width: 256, height: 256, alignItems: 'center', justifyContent: 'center', marginVertical: 14 },
  clockText: { position: 'absolute', alignItems: 'center', gap: 6 },
  clock: { fontFamily: 'Inter_700Bold', fontSize: 48, letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  clockCaption: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  currentTask: { width: '100%', alignItems: 'center', gap: 5, minHeight: 68, justifyContent: 'center' },
  selectedTask: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'center' },
  taskCount: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  breakMessage: { fontFamily: 'Inter_600SemiBold', fontSize: 17, textAlign: 'center' },
  noTask: { alignItems: 'center', gap: 8, paddingVertical: 4 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 270 },
  controls: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  startButton: { flex: 1, marginHorizontal: 8 },
  taskSection: { gap: 11 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  taskList: { gap: 9 },
  taskRow: { minHeight: 66, borderWidth: 1, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskDot: { width: 9, height: 9, borderRadius: 5 },
  taskCopy: { flex: 1, gap: 3 },
  taskRowTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  taskRowMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  todayStrip: { borderRadius: 18, paddingVertical: 16, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  todayItem: { alignItems: 'center', gap: 4 },
  todayValue: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  todayLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  todayDivider: { width: 1, height: 32 },
});
