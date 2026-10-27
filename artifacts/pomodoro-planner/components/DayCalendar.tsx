import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText as Text } from '@/components/AppText';
import { IconButton } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import {
  CalendarEvent, HOUR_HEIGHT, dayBounds, daySlots, formatClock, formatRange,
  layoutDayEvents, minutesIntoDay, parseDateKey, shiftDateKey, todayKey, weekKeys,
} from '@/utils/dayCalendar';

const GUTTER = 52;
const ADD_STRIP = 28; // right-hand strip kept free so slots stay tappable beside events
const VIEW_HEIGHT = 420;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type DayCalendarProps = {
  date: string;
  onDateChange: (date: string) => void;
  events: CalendarEvent[];
  onSelectSlot: (timestamp: number) => void;
  onSelectEvent: (id: string) => void;
  disabled?: boolean;
};

export function DayCalendar({ date, onDateChange, events, onSelectSlot, onSelectEvent, disabled }: DayCalendarProps) {
  const colors = useColors();
  const [now, setNow] = useState(Date.now());
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setNow(Date.now()); });
    return () => { clearInterval(t); sub.remove(); };
  }, []);

  const today = todayKey(now);
  const isToday = date === today;
  const d = parseDateKey(date) ?? new Date(now);
  const slots = useMemo(() => daySlots(date), [date]);
  const week = useMemo(() => weekKeys(date), [date]);
  const laid = useMemo(() => layoutDayEvents(events, date), [events, date]);
  const { start } = dayBounds(date);
  const nowTop = isToday ? (minutesIntoDay(now, date) / 60) * HOUR_HEIGHT : null;

  // Scroll to a sensible spot when the day changes: now, first event, or 8:00.
  const firstTop = laid[0]?.top;
  useEffect(() => {
    const y = isToday && nowTop !== null ? nowTop - 120 : firstTop !== undefined ? firstTop - 40 : 8 * HOUR_HEIGHT;
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false }), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const lane = Math.max(0, width - GUTTER - ADD_STRIP - 6);

  return (
    <View testID="day-calendar" style={[styles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={[styles.weekday, { color: colors.primary }]}>{isToday ? 'Today' : WEEKDAYS[d.getDay()]}</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{d.getDate()} {MONTHS[d.getMonth()]} {d.getFullYear()}</Text>
        </View>
        <IconButton icon="chevron-left" label="Previous day" testID="calendar-previous" onPress={() => onDateChange(shiftDateKey(date, -1))} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to today"
          accessibilityState={{ selected: isToday }}
          testID="calendar-today"
          onPress={() => onDateChange(today)}
          style={({ pressed }) => [styles.todayBtn, { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.todayText, { color: colors.secondaryForeground }]}>Today</Text>
        </Pressable>
        <IconButton icon="chevron-right" label="Next day" testID="calendar-next" onPress={() => onDateChange(shiftDateKey(date, 1))} />
      </View>

      <View style={styles.week}>
        {week.map((k) => {
          const wd = parseDateKey(k)!;
          const on = k === date;
          const isT = k === today;
          return (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={`${WEEKDAYS[wd.getDay()]} ${wd.getDate()} ${MONTHS[wd.getMonth()]}`}
              accessibilityState={{ selected: on }}
              testID={`calendar-day-${k}`}
              onPress={() => onDateChange(k)}
              style={[styles.weekDay, { backgroundColor: on ? colors.primary : 'transparent' }]}
            >
              <Text style={[styles.weekLetter, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>{DAY_LETTERS[wd.getDay()]}</Text>
              <Text style={[styles.weekNum, { color: on ? colors.primaryForeground : isT ? colors.primary : colors.foreground }]}>{wd.getDate()}</Text>
              <View style={[styles.dot, { backgroundColor: isT && !on ? colors.primary : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        style={[styles.scroller, { borderTopColor: colors.border }]}
        contentContainerStyle={{ height: 24 * HOUR_HEIGHT + 16 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        showsVerticalScrollIndicator
      >
        <View style={styles.timeline}>
          {slots.map((s) => {
            const label = s.valid ? `Add task at ${s.id.replace('-', ':')}` : `${s.id.replace('-', ':')} is skipped by a clock change`;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled: !!disabled || !s.valid }}
                disabled={disabled || !s.valid}
                testID={`calendar-slot-${s.id}`}
                onPress={() => onSelectSlot(s.timestamp)}
                style={({ pressed }) => [
                  styles.slot,
                  {
                    top: ((s.hour * 60 + s.minute) / 60) * HOUR_HEIGHT,
                    borderTopColor: colors.border,
                    borderStyle: s.minute === 0 ? 'solid' : 'dashed',
                    opacity: s.minute === 0 ? 1 : 0.7,
                    backgroundColor: pressed ? colors.secondary : 'transparent',
                  },
                ]}
              >
                {s.minute === 0 ? (
                  <Text style={[styles.hour, { color: colors.mutedForeground }]}>{s.id.replace('-', ':')}</Text>
                ) : null}
                {!disabled && s.valid ? <Feather name="plus" size={12} color={colors.mutedForeground} style={styles.plus} /> : null}
              </Pressable>
            );
          })}

          {nowTop !== null ? (
            <View pointerEvents="none" accessibilityLabel={`Current time ${formatClock(now)}`} style={[styles.nowLine, { top: nowTop }]}>
              <View style={[styles.nowDot, { backgroundColor: colors.destructive }]} />
              <View style={[styles.nowRule, { backgroundColor: colors.destructive }]} />
            </View>
          ) : null}

          {lane > 0 && laid.map((e) => {
            const w = lane / e.columns;
            const compact = e.height < 44;
            const prefix = e.clippedStart ? 'from previous day, ' : '';
            const suffix = e.clippedEnd ? ', continues next day' : '';
            const past = e.endAt <= now;
            return (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                accessibilityLabel={`${e.title}, ${prefix}${formatRange(e.startAt, e.endAt)}${suffix}${e.paused ? ', paused' : ''}`}
                testID={`calendar-event-${e.id}`}
                disabled={disabled}
                onPress={() => onSelectEvent(e.id)}
                style={({ pressed }) => [
                  styles.event,
                  {
                    top: e.top + 1,
                    height: e.height - 2,
                    left: GUTTER + e.column * w + 2,
                    width: w - 3,
                    backgroundColor: e.paused ? colors.muted : colors.secondary,
                    borderColor: e.paused ? colors.border : colors.primary,
                    borderStyle: e.paused ? 'dashed' : 'solid',
                    borderTopLeftRadius: e.clippedStart ? 2 : 10,
                    borderTopRightRadius: e.clippedStart ? 2 : 10,
                    borderBottomLeftRadius: e.clippedEnd ? 2 : 10,
                    borderBottomRightRadius: e.clippedEnd ? 2 : 10,
                    opacity: pressed ? 0.75 : past ? 0.7 : 1,
                  },
                ]}
              >
                <View style={[styles.eventRail, { backgroundColor: e.paused ? colors.mutedForeground : colors.primary }]} />
                <View style={[styles.eventBody, compact && styles.eventBodyRow]}>
                  <Text numberOfLines={compact ? 1 : 2} style={[styles.eventTitle, compact && styles.flexShrink, { color: e.paused ? colors.mutedForeground : colors.foreground }]}>
                    {e.title}
                  </Text>
                  <Text numberOfLines={1} style={[styles.eventTime, { color: e.paused ? colors.mutedForeground : colors.primary }]}>
                    {e.clippedStart ? '← ' : ''}{formatRange(Math.max(e.startAt, start), e.endAt)}{e.clippedEnd ? ' →' : ''}{e.paused ? ' · paused' : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        {disabled ? 'Planning is paused for now.' : 'Tap a half-hour to plan a focus block. Tap a block to edit it.'}
      </Text>
    </View>
  );
}

export default DayCalendar;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  wrap: { borderWidth: 1, borderRadius: 22, paddingTop: 14, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 2 },
  weekday: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 19, letterSpacing: -0.4, marginTop: 2 },
  todayBtn: { minHeight: 34, paddingHorizontal: 12, borderRadius: 12, justifyContent: 'center' },
  todayText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  week: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 10, gap: 4 },
  weekDay: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12, minHeight: 52 },
  weekLetter: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6 },
  weekNum: { fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },
  scroller: { height: VIEW_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth },
  timeline: { flex: 1, marginTop: 8 },
  slot: { position: 'absolute', left: 0, right: 0, height: HOUR_HEIGHT / 2, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  hour: { width: GUTTER, paddingLeft: 12, marginTop: -8, fontFamily: 'Inter_500Medium', fontSize: 10 },
  plus: { position: 'absolute', right: 9, top: 9 },
  nowLine: { position: 'absolute', left: GUTTER - 5, right: 0, height: 10, marginTop: -5, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 10, height: 10, borderRadius: 5 },
  nowRule: { flex: 1, height: 2 },
  event: { position: 'absolute', borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  eventRail: { width: 3 },
  eventBody: { flex: 1, paddingHorizontal: 7, paddingVertical: 4, gap: 1 },
  eventBodyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  eventTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 16 },
  eventTime: { fontFamily: 'Inter_500Medium', fontSize: 10.5 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 11, paddingHorizontal: 16, paddingVertical: 10 },
});
