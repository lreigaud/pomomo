import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/AppText';
import { Feather } from '@expo/vector-icons';
import { IconButton, Label, Page, PageHeading, Surface } from '@/components/AppUI';
import { FocusSession, localDateKey, useFocus } from '@/store/FocusContext';
import { useColors } from '@/hooks/useColors';

type Range = 'week' | 'month';

function dayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function mondayStart(date: Date): Date {
  const result = dayStart(date);
  const day = result.getDay() === 0 ? 7 : result.getDay();
  result.setDate(result.getDate() - day + 1);
  return result;
}

function getRangeDays(anchor: Date, range: Range): Date[] {
  if (range === 'week') {
    const monday = mondayStart(anchor);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(date.getDate() + i);
      return date;
    });
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const count = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), i + 1));
}

function stepAnchor(anchor: Date, range: Range, direction: number): Date {
  const next = new Date(anchor);
  if (range === 'week') next.setDate(next.getDate() + direction * 7);
  else {
    next.setDate(1);
    next.setMonth(next.getMonth() + direction);
  }
  return next;
}

function titleForRange(days: Date[], range: Range): string {
  if (range === 'month') {
    return days[0]?.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) ?? '';
  }
  const start = days[0]?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) ?? '';
  const end = days[6]?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) ?? '';
  return `${start} – ${end}`;
}

function bucketSessions(sessions: FocusSession[], days: Date[]): number[] {
  const byDay = new Map<string, number>();
  for (const session of sessions) {
    const key = localDateKey(new Date(session.completedAt));
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return days.map((date) => byDay.get(localDateKey(date)) ?? 0);
}

export default function InsightsScreen() {
  const colors = useColors();
  const { tasks, sessions, isReady } = useFocus();
  const [range, setRange] = useState<Range>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const days = useMemo(() => getRangeDays(anchor, range), [anchor, range]);
  const bucketed = useMemo(() => bucketSessions(sessions, days), [sessions, days]);
  const min = days[0] ? dayStart(days[0]).getTime() : 0;
  const endExclusive = days.length ? dayStart(days[days.length - 1]) : new Date(0);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const max = endExclusive.getTime();
  const rangeSessions = sessions.filter(
    (session) => session.completedAt >= min && session.completedAt < max,
  );
  const maxCount = Math.max(1, ...bucketed);
  const totalMinutes = rangeSessions.reduce((sum, session) => sum + session.minutes, 0);
  const minutesText = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    : `${totalMinutes}m`;
  const nextAnchor = stepAnchor(anchor, range, 1);
  const canGoForward =
    (range === 'week' ? mondayStart(nextAnchor) : new Date(nextAnchor.getFullYear(), nextAnchor.getMonth(), 1)).getTime() <=
    (range === 'week' ? mondayStart(new Date()) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)).getTime();

  const taskTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const session of rangeSessions) {
      totals.set(session.taskId, (totals.get(session.taskId) ?? 0) + 1);
    }
    return [...totals.entries()]
      .map(([taskId, count]) => ({
        taskId,
        title: tasks.find((item) => item.id === taskId)?.title
          ?? rangeSessions.find((session) => session.taskId === taskId && session.taskTitle)?.taskTitle
          ?? 'Deleted task',
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [rangeSessions, tasks]);

  if (!isReady) {
    return (
      <Page scroll={false}>
        <View style={styles.loading}>
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading your history…</Text>
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeading
        eyebrow="Your progress"
        title="Look how far."
        subtitle="Every finished focus session, right here."
      />

      <View style={[styles.rangeSwitch, { backgroundColor: colors.secondary }]}>
        {(['week', 'month'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: range === value }}
            testID={`insights-range-${value}`}
            onPress={() => {
              setRange(value);
              setAnchor(new Date());
            }}
            style={[styles.rangeOption, range === value && { backgroundColor: colors.card }]}
          >
            <Text style={[styles.rangeText, { color: range === value ? colors.foreground : colors.mutedForeground }]}>
              {value === 'week' ? 'Week' : 'Month'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Surface style={styles.summaryCard}>
        <View style={styles.periodRow}>
          <IconButton
            icon="chevron-left"
            label="Previous period"
            testID="insights-previous"
            onPress={() => setAnchor((current) => stepAnchor(current, range, -1))}
          />
          <Text style={[styles.periodTitle, { color: colors.foreground }]}>{titleForRange(days, range)}</Text>
          <IconButton
            icon="chevron-right"
            label="Next period"
            testID="insights-next"
            onPress={() => setAnchor((current) => stepAnchor(current, range, 1))}
            disabled={!canGoForward}
          />
        </View>
        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={[styles.metricValue, { color: colors.foreground }]}>{rangeSessions.length}</Text>
            <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>sessions</Text>
          </View>
          <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
          <View style={styles.metric}>
            <Text style={[styles.metricValue, { color: colors.foreground }]}>{minutesText}</Text>
            <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>focused</Text>
          </View>
          <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
          <View style={styles.metric}>
            <Text style={[styles.metricValue, { color: colors.foreground }]}>{taskTotals.length}</Text>
            <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>tasks</Text>
          </View>
        </View>
      </Surface>

      <Surface style={styles.chartCard}>
        <View style={styles.cardHeading}>
          <View style={styles.cardHeadingCopy}>
            <Label>FOCUS SESSIONS</Label>
            <Text style={[styles.chartTitle, { color: colors.foreground }]}>
              {range === 'week' ? 'A week in focus' : 'Your month, day by day'}
            </Text>
          </View>
          <Feather name="activity" size={19} color={colors.primary} />
        </View>

        {range === 'week' ? (
          <View style={styles.weekChart}>
            {days.map((date, index) => {
              const count = bucketed[index] ?? 0;
              const barHeight = count === 0 ? 5 : Math.max(12, (count / maxCount) * 112);
              return (
                <View key={localDateKey(date)} style={styles.weekColumn}>
                  <Text style={[styles.barCount, { color: count ? colors.foreground : colors.mutedForeground }]}>
                    {count || ''}
                  </Text>
                  <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
                    <View style={[styles.barFill, { height: barHeight, backgroundColor: count ? colors.primary : colors.muted }]} />
                  </View>
                  <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>
                    {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.monthGrid}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
              <Text key={`${day}-${index}`} style={[styles.weekdayLabel, { color: colors.mutedForeground }]}>{day}</Text>
            ))}
            {Array.from({ length: ((days[0]?.getDay() ?? 1) + 6) % 7 }, (_, i) => (
              <View key={`blank-${i}`} style={styles.monthBlank} />
            ))}
            {days.map((date, index) => {
              const count = bucketed[index] ?? 0;
              const opacity = count === 0 ? 0.16 : 0.28 + (count / maxCount) * 0.72;
              return (
                <View key={localDateKey(date)} style={styles.monthCell}>
                  <View
                    style={[
                      styles.monthDot,
                      {
                        backgroundColor: count ? colors.primary : colors.muted,
                        opacity,
                      },
                    ]}
                  />
                  <Text style={[styles.monthDate, { color: colors.mutedForeground }]}>{date.getDate()}</Text>
                </View>
              );
            })}
          </View>
        )}
      </Surface>

      <View style={styles.taskBreakdown}>
        <View style={styles.breakdownHeading}>
          <View>
            <Label>WHAT YOU WORKED ON</Label>
            <Text style={[styles.chartTitle, { color: colors.foreground, marginTop: 5 }]}>Tasks in this period</Text>
          </View>
        </View>
        {taskTotals.length ? (
          <View style={styles.breakdownList}>
            {taskTotals.map(({ taskId, title, count }, index) => (
              <View key={taskId} style={styles.breakdownRow}>
                <View style={[styles.rank, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.rankText, { color: colors.primary }]}>{index + 1}</Text>
                </View>
                <View style={styles.breakdownCopy}>
                  <Text numberOfLines={1} style={[styles.taskName, { color: colors.foreground }]}>
                    {title}
                  </Text>
                  <Text style={[styles.taskSessions, { color: colors.mutedForeground }]}>
                    {count} {count === 1 ? 'session' : 'sessions'}
                  </Text>
                </View>
                <Text style={[styles.taskCount, { color: colors.primary }]}>{count}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Surface style={styles.emptyCard}>
            <Feather name="feather" size={20} color={colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>A fresh page.</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Finish a Pomodoro and your work will show up here.
            </Text>
          </Surface>
        )}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  rangeSwitch: { flexDirection: 'row', padding: 4, borderRadius: 15 },
  rangeOption: { flex: 1, minHeight: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rangeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  summaryCard: { paddingVertical: 14, gap: 16 },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -8 },
  periodTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  metric: { alignItems: 'center', gap: 3 },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  metricLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  metricDivider: { height: 32, width: 1 },
  chartCard: { padding: 17, gap: 16 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeadingCopy: { gap: 5 },
  chartTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  weekChart: { height: 166, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  weekColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 5, height: '100%' },
  barCount: { height: 15, fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  barTrack: { height: 112, width: '72%', borderRadius: 9, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 9 },
  barLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  monthBlank: { width: '14.2857%' },
  weekdayLabel: { width: '14.2857%', textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 10, marginBottom: 4 },
  monthCell: { width: '14.2857%', alignItems: 'center', gap: 3 },
  monthDot: { width: 25, height: 25, borderRadius: 9 },
  monthDate: { fontFamily: 'Inter_400Regular', fontSize: 9 },
  taskBreakdown: { gap: 12 },
  breakdownHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  breakdownList: { gap: 6 },
  breakdownRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  rank: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  breakdownCopy: { flex: 1, gap: 3 },
  taskName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  taskSessions: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  taskCount: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  emptyCard: { alignItems: 'center', padding: 23 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center' },
});
