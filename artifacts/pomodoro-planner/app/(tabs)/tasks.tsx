import React, { useMemo, useState } from 'react';
import { router, Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { DeleteTaskDialog } from '@/components/DeleteTaskDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Feather } from '@expo/vector-icons';
import { ActionButton, IconButton, Page, PageHeading, Surface } from '@/components/AppUI';
import {
  FocusTask,
  getTaskSessionCount,
  isTaskComplete,
  mondayFirstDay,
  useFocus,
} from '@/store/FocusContext';
import { useColors } from '@/hooks/useColors';
import { breakMinutesFor, focusMinutesFor } from '@/utils/taskDuration';

const weekdays = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function repeatLabel(days: number[]): string {
  if (days.length === 0) return 'One time';
  if (days.length === 7) return 'Every day';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) {
    return 'Weekdays';
  }
  return days.map((day) => weekdays[day]).join(' · ');
}

function TaskCard({ task, onDelete, onArchiveRequest }: {
  task: FocusTask;
  onDelete: (task: FocusTask) => void;
  onArchiveRequest: (task: FocusTask) => void;
}) {
  const colors = useColors();
  const { sessions, updateTask } = useFocus();
  const recurring = task.repeatDays.length > 0;
  const sessionCount = getTaskSessionCount(task, sessions);
  const complete = isTaskComplete(task, sessions);
  const progress = Math.min(1, sessionCount / task.targetSessions);
  const today = mondayFirstDay(new Date());
  const dueToday = !recurring || task.repeatDays.includes(today);
  const isCompletedToday = recurring && dueToday && complete;
  const title = task.title;

  function archive() {
    if (task.archived) {
      updateTask({ ...task, archived: false });
      return;
    }
    onArchiveRequest(task);
  }

  return (
    <Surface style={styles.taskCard}>
      <View style={styles.taskTop}>
        <View style={[styles.taskMark, { backgroundColor: complete ? colors.terracotta : colors.primary }]}>
          <Feather name={complete ? 'check' : 'circle'} size={15} color={colors.primaryForeground} />
        </View>
        <View style={styles.taskDetails}>
          <Text numberOfLines={2} style={[styles.taskTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.taskSub, { color: colors.mutedForeground }]}>
            {repeatLabel(task.repeatDays)} · {task.targetSessions} {task.targetSessions === 1 ? 'session' : 'sessions'}
          </Text>
          <Text style={[styles.taskSub, { color: colors.mutedForeground }]}>
            {focusMinutesFor(task)} min focus · {breakMinutesFor(task)} min break
          </Text>
        </View>
        <IconButton
          icon="edit-2"
          label={`Edit ${title}`}
          testID={`edit-task-${task.id}`}
          onPress={() => router.push(`/task?id=${task.id}` as Href)}
        />
        <IconButton
          icon={task.archived ? 'refresh-cw' : 'archive'}
          label={`${task.archived ? 'Restore' : 'Archive'} ${title}`}
          testID={`archive-task-${task.id}`}
          onPress={archive}
          color={colors.mutedForeground}
        />
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: complete ? colors.terracotta : colors.primary }]} />
      </View>
      <View style={styles.taskFooter}>
        <Text style={[styles.taskCount, { color: colors.mutedForeground }]}>
          {sessionCount} of {task.targetSessions} sessions{recurring ? ' today' : ''}
        </Text>
        <Text style={[styles.dueLabel, { color: isCompletedToday || (complete && !recurring) ? colors.terracotta : dueToday ? colors.primary : colors.mutedForeground }]}>
          {isCompletedToday || (complete && !recurring) ? 'Goal reached' : dueToday ? 'On today’s list' : 'Upcoming'}
        </Text>
      </View>
      {task.archived ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${title}`}
          testID={`delete-task-${task.id}`}
          onPress={() => onDelete(task)}
          style={styles.deleteButton}
        >
          <Feather name="trash-2" size={15} color={colors.destructive} />
          <Text style={[styles.deleteText, { color: colors.destructive }]}>Delete task</Text>
        </Pressable>
      ) : null}
    </Surface>
  );
}

export default function TasksScreen() {
  const colors = useColors();
  const { tasks, isReady, deleteTask, archiveTask } = useFocus();
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FocusTask | null>(null);
  const [pendingArchive, setPendingArchive] = useState<FocusTask | null>(null);
  const visibleTasks = useMemo(
    () => tasks.filter((task) => task.archived === showArchived),
    [tasks, showArchived],
  );

  if (!isReady) {
    return (
      <Page scroll={false}>
        <View style={styles.loading}>
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading your tasks…</Text>
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeading
        eyebrow="Your plans"
        title="Tasks"
        subtitle="Give each task a session goal and a rhythm."
        right={
          <IconButton
            icon="plus"
            label="Add task"
            testID="add-task"
            onPress={() => router.push('/task' as Href)}
          />
        }
      />

      <View style={[styles.filter, { backgroundColor: colors.secondary }]}>
        {[
          { value: false, label: 'Active' },
          { value: true, label: 'Archived' },
        ].map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityState={{ selected: showArchived === item.value }}
            testID={`tasks-filter-${item.label.toLowerCase()}`}
            onPress={() => setShowArchived(item.value)}
            style={[
              styles.filterOption,
              showArchived === item.value && { backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.filterText, { color: showArchived === item.value ? colors.foreground : colors.mutedForeground }]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {visibleTasks.length ? (
        <View style={styles.list}>
          {visibleTasks.map((task) => (
            <TaskCard key={task.id} task={task} onDelete={setPendingDelete} onArchiveRequest={setPendingArchive} />
          ))}
        </View>
      ) : showArchived ? (
        <Surface style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
            <Feather name="archive" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing tucked away.</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Archived tasks will stay here, with their focus history intact.
          </Text>
        </Surface>
      ) : (
        <Surface style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
            <Feather name="check-square" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Start with one thing.</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Choose a task, decide how many focus sessions it needs, and set the days it repeats.
          </Text>
          <ActionButton
            label="Add your first task"
            icon="plus"
            testID="add-first-task"
            onPress={() => router.push('/task' as Href)}
          />
        </Surface>
      )}

      <ConfirmDialog
        visible={pendingArchive !== null}
        heading="Archive this task?"
        message={`Archive “${pendingArchive?.title ?? ''}”? Its completed focus history will stay in Progress. Planned reminders are paused while it is archived.`}
        confirmLabel="Archive"
        testID="archive-task-dialog"
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => {
          if (pendingArchive) archiveTask(pendingArchive.id);
          setPendingArchive(null);
        }}
      />
      <DeleteTaskDialog
        title={pendingDelete?.title ?? null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteTask(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      {!showArchived && visibleTasks.length > 0 ? (
        <View style={[styles.tip, { backgroundColor: colors.secondary }]}>
          <Feather name="repeat" size={16} color={colors.primary} />
          <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
            Repeating goals count fresh focus sessions for each scheduled day.
          </Text>
        </View>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  filter: { borderRadius: 15, padding: 4, flexDirection: 'row', gap: 4 },
  filterOption: { flex: 1, minHeight: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  filterText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  list: { gap: 12 },
  taskCard: { padding: 15, gap: 11 },
  taskTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskMark: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  taskDetails: { flex: 1, gap: 4, paddingHorizontal: 4 },
  taskTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21 },
  taskSub: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  progressTrack: { height: 6, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  taskFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, minHeight: 44, paddingHorizontal: 4 },
  deleteText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  taskCount: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  dueLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  emptyCard: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24 },
  emptyIcon: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  emptyText: { maxWidth: 280, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 14, borderRadius: 16 },
  tipText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
});
