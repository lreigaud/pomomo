import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '@/components/AppText';
import { Feather } from '@expo/vector-icons';
import { ActionButton, IconButton, Label, Page, PageHeading, Surface } from '@/components/AppUI';
import { FocusTask, useFocus } from '@/store/FocusContext';
import { useColors } from '@/hooks/useColors';
import { breakMinutesFor, focusMinutesFor, parseBreakMinutes, parseFocusMinutes } from '@/utils/taskDuration';

const days = [
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
  { value: 7, label: 'S' },
];

function TaskEditor({
  task,
}: {
  task?: FocusTask;
}) {
  const colors = useColors();
  const { addTask, updateTask, archiveTask } = useFocus();
  const [title, setTitle] = useState(task?.title ?? '');
  const [targetSessions, setTargetSessions] = useState(task?.targetSessions ?? 2);
  const [repeatDays, setRepeatDays] = useState<number[]>(task?.repeatDays ?? []);
  const [error, setError] = useState<string | null>(null);
  const [focusText, setFocusText] = useState(String(focusMinutesFor(task)));
  const [breakText, setBreakText] = useState(String(breakMinutesFor(task)));
  const [manualBreak, setManualBreak] = useState(task?.breakMinutes !== undefined);
  const [durationErrors, setDurationErrors] = useState<{ focus?: string; break?: string }>({});
  const focusMinutes = parseFocusMinutes(focusText);
  const shownBreak = manualBreak ? breakText : focusMinutes === null ? '' : String(focusMinutes / 5);

  function toggleDay(day: number) {
    setRepeatDays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  }

  function save() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Give this task a name before saving.');
      return;
    }
    const breakMinutes = parseBreakMinutes(shownBreak);
    const nextErrors = {
      focus: focusMinutes === null ? 'Enter whole minutes from 1 to 1,440.' : undefined,
      break: breakMinutes === null ? 'Enter 0.01 to 1,440 minutes, using at most two decimal places.' : undefined,
    };
    setDurationErrors(nextErrors);
    if (focusMinutes === null || breakMinutes === null) return;
    Keyboard.dismiss();
    const durations = { focusMinutes, breakMinutes: manualBreak ? breakMinutes : undefined };
    if (task) {
      updateTask({ ...task, title: cleanTitle, targetSessions, repeatDays, ...durations });
    } else {
      addTask({ title: cleanTitle, targetSessions, repeatDays, ...durations });
    }
    router.back();
  }

  function confirmArchive() {
    if (!task) return;
    Alert.alert(
      'Archive this task?',
      'Its completed focus history will stay in your progress.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            archiveTask(task.id);
            router.back();
          },
        },
      ],
    );
  }

  const allDays = repeatDays.length === 7;
  const weekdaysOnly =
    repeatDays.length === 5 &&
    [1, 2, 3, 4, 5].every((day) => repeatDays.includes(day));

  return (
    <Page keyboardAware>
      <PageHeading
        eyebrow={task ? 'Adjust your plan' : 'A fresh start'}
        title={task ? 'Edit task' : 'New task'}
        subtitle="Pick a focus goal and choose the days it belongs to."
        right={<IconButton icon="x" label="Close" onPress={() => router.back()} />}
      />

      <Surface style={styles.formCard}>
        <View style={styles.field}>
          <Label>SESSION LENGTH</Label>
          <View style={styles.durationRow}>
            <View style={styles.durationField}>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>Focus (minutes)</Text>
              <TextInput
                accessibilityLabel="Focus duration in minutes"
                testID="task-focus-minutes"
                value={focusText}
                keyboardType="number-pad"
                maxLength={5}
                onChangeText={value => { setFocusText(value); setDurationErrors({}); }}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: durationErrors.focus ? colors.destructive : colors.border }]}
              />
              {durationErrors.focus ? <Text testID="task-focus-error" style={[styles.errorText, { color: colors.destructive }]}>{durationErrors.focus}</Text> : null}
            </View>
            <View style={styles.durationField}>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>Short break (minutes)</Text>
              <TextInput
                accessibilityLabel="Short break duration in minutes"
                testID="task-break-minutes"
                value={shownBreak}
                keyboardType="decimal-pad"
                maxLength={8}
                onChangeText={value => { setManualBreak(true); setBreakText(value); setDurationErrors({}); }}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: durationErrors.break ? colors.destructive : colors.border }]}
              />
              {durationErrors.break ? <Text testID="task-break-error" style={[styles.errorText, { color: colors.destructive }]}>{durationErrors.break}</Text> : null}
            </View>
          </View>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            {manualBreak ? 'Custom break. Changing focus minutes keeps this break length.' : 'Automatic break: one-fifth of your focus time. Edit it to choose your own.'}
          </Text>
          {manualBreak ? (
            <Pressable accessibilityRole="button" testID="task-break-automatic" onPress={() => { setManualBreak(false); setDurationErrors({}); }} style={styles.autoBreakButton}>
              <Text style={[styles.helper, { color: colors.primary }]}>Use automatic 1/5 break</Text>
            </Pressable>
          ) : null}
          {task ? <Text style={[styles.helper, { color: colors.mutedForeground }]}>Running or paused sessions keep their current length. Changes apply to new sessions.</Text> : null}
        </View>

        <View style={styles.field}>
          <Label>TASK NAME</Label>
          <TextInput
            accessibilityLabel="Task name"
            autoFocus={!task}
            autoCapitalize="sentences"
            maxLength={80}
            placeholder="What would you like to work on?"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="done"
            testID="task-title"
            value={title}
            onChangeText={(value) => {
              setTitle(value);
              if (error) setError(null);
            }}
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.background,
                borderColor: error ? colors.destructive : colors.border,
              },
            ]}
          />
          {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
        </View>

        <View style={styles.field}>
          <View style={styles.sectionLabel}>
            <View style={styles.labelCopy}>
              <Label>SESSION GOAL</Label>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>How many {focusMinutes ?? 'focus'}-minute sessions?</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove one session"
                testID="session-goal-minus"
                disabled={targetSessions <= 1}
                onPress={() => setTargetSessions((value) => Math.max(1, value - 1))}
                style={[styles.stepButton, { backgroundColor: colors.secondary, opacity: targetSessions <= 1 ? 0.45 : 1 }]}
              >
                <Feather name="minus" size={16} color={colors.foreground} />
              </Pressable>
              <Text accessibilityLabel={`${targetSessions} sessions`} style={[styles.sessionNumber, { color: colors.foreground }]}>{targetSessions}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add one session"
                testID="session-goal-plus"
                onPress={() => setTargetSessions((value) => value + 1)}
                style={[styles.stepButton, { backgroundColor: colors.secondary }]}
              >
                <Feather name="plus" size={16} color={colors.foreground} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <View style={styles.labelCopy}>
            <Label>REPEAT</Label>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Repeating goals start fresh on each selected day.
            </Text>
          </View>
          <View style={styles.repeatPills}>
            {[
              { label: 'No repeat', selected: repeatDays.length === 0, action: () => setRepeatDays([]) },
              { label: 'Every day', selected: allDays, action: () => setRepeatDays(allDays ? [] : [1, 2, 3, 4, 5, 6, 7]) },
              { label: 'Weekdays', selected: weekdaysOnly, action: () => setRepeatDays(weekdaysOnly ? [] : [1, 2, 3, 4, 5]) },
            ].map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityState={{ selected: item.selected }}
                testID={`repeat-${item.label.toLowerCase().replace(' ', '-')}`}
                onPress={item.action}
                style={[
                  styles.repeatPill,
                  {
                    backgroundColor: item.selected ? colors.accent : colors.secondary,
                    borderColor: item.selected ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.repeatText, { color: item.selected ? colors.primary : colors.secondaryForeground }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.dayRow}>
            {days.map((day) => {
              const selected = repeatDays.includes(day.value);
              return (
                <Pressable
                  key={day.value}
                  accessibilityRole="button"
                  accessibilityLabel={`Repeat on ${['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day.value]}`}
                  accessibilityState={{ selected }}
                  testID={`repeat-day-${day.value}`}
                  onPress={() => toggleDay(day.value)}
                  style={[
                    styles.day,
                    {
                      backgroundColor: selected ? colors.primary : colors.secondary,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.dayText, { color: selected ? colors.primaryForeground : colors.mutedForeground }]}>{day.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.scheduleHint, { color: colors.mutedForeground }]}>
            {repeatDays.length
              ? `Repeats ${repeatDays.map((day) => ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][day]).join(', ')}`
              : 'One-time task · stays active until its goal is reached'}
          </Text>
        </View>
      </Surface>

      <ActionButton
        label={task ? 'Save changes' : 'Create task'}
        icon="check"
        testID="save-task"
        onPress={save}
      />
      {task ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Archive task"
          testID="archive-task-from-editor"
          onPress={confirmArchive}
          style={styles.archiveButton}
        >
          <Feather name="archive" size={15} color={colors.destructive} />
          <Text style={[styles.archiveText, { color: colors.destructive }]}>Archive this task</Text>
        </Pressable>
      ) : null}
    </Page>
  );
}

export default function TaskFormScreen() {
  const colors = useColors();
  const { tasks, isReady } = useFocus();
  const params = useLocalSearchParams<{ id?: string }>();
  if (!isReady) {
    return (
      <Page scroll={false}>
        <View style={styles.loading}>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Loading task…</Text>
        </View>
      </Page>
    );
  }
  const task = params.id ? tasks.find((item) => item.id === params.id) : undefined;
  if (params.id && !task) {
    return (
      <Page>
        <PageHeading title="Task not found" subtitle="It may have been archived or removed." right={<IconButton icon="x" label="Close" onPress={() => router.back()} />} />
      </Page>
    );
  }
  return <TaskEditor key={task?.id ?? 'new-task'} task={task} />;
}

const styles = StyleSheet.create({
  durationRow: { flexDirection: 'row', gap: 12 },
  durationField: { flex: 1, gap: 8 },
  autoBreakButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  formCard: { padding: 19, gap: 25 },
  field: { gap: 10 },
  sectionLabel: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  labelCopy: { gap: 5, flex: 1 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 14, minHeight: 52, paddingHorizontal: 14, fontFamily: 'Inter_500Medium', fontSize: 14 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepButton: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sessionNumber: { minWidth: 18, textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 18 },
  repeatPills: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  repeatPill: { borderWidth: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11 },
  repeatText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 5 },
  day: { width: 36, height: 36, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  scheduleHint: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  archiveButton: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  archiveText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
