const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupHarness } = require('./helpers/startup-harness.cjs');

const MINUTE = 60000;
const legacy = { id: 'legacy', title: 'Read', targetSessions: 2, repeatDays: [], archived: false, createdAt: 1 };

function provider(tasks = [legacy], platform = 'android') {
  let saved;
  const alarms = [];
  let preparedAlarms = 0;
  const h = startupHarness({
    '@react-native-async-storage/async-storage': {
      getItem: async () => JSON.stringify({
        tasks, sessions: [],
        timer: { mode: 'focus', taskId: tasks[0]?.id ?? null, remainingMs: 25 * MINUTE, totalMs: 25 * MINUTE, isRunning: false, endsAt: null },
        alertsEnabled: true,
      }),
      setItem: async (_key, value) => { saved = JSON.parse(value); },
    },
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: {} },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Linking: {}, Platform: { OS: platform } },
    '@/services/timerAlerts': {
      syncTimerNotification: async (...args) => { alarms.push(args); },
      hasScheduledAlarm: () => true,
      prepareForegroundAlarm: () => { preparedAlarms += 1; },
    },
  });
  const { FocusProvider } = h.load('store/FocusContext.tsx');
  h.mount(() => FocusProvider({ children: null }));
  return { h, value: () => h.result.props.value, saved: () => saved, alarms, preparedAlarms: () => preparedAlarms };
}

test('automatic breaks are exactly one fifth, including fractional minutes; legacy tasks remain 25/5', () => {
  const api = startupHarness().load('utils/taskDuration.ts');
  assert.equal(api.focusMinutesFor(legacy), 25);
  assert.equal(api.breakMinutesFor(legacy), 5);
  for (const focus of [1, 27, 40, 50]) {
    const task = { ...legacy, focusMinutes: focus };
    assert.equal(api.breakMinutesFor(task), focus / 5);
    assert.equal(api.taskDurationMs('break', task), focus * MINUTE / 5);
  }
  assert.equal(api.breakMinutesFor({ ...legacy, focusMinutes: 40, breakMinutes: 7.5 }), 7.5);
  assert.equal(api.parseFocusMinutes('1.5'), null);
  assert.equal(api.parseFocusMinutes('0'), null);
  assert.equal(api.parseBreakMinutes('0'), null);
  assert.equal(api.parseBreakMinutes('7,5'), 7.5);
});

test('custom focus completes with its real minutes, then uses the automatic break and next focus length', async () => {
  const s = provider([]);
  await s.h.settle();
  s.value().addTask({ title: 'Study', targetSessions: 2, repeatDays: [], focusMinutes: 40 });
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 40 * MINUTE);
  s.value().startTimer();
  await s.h.settle();
  assert.equal(s.value().timer.breakDurationMs, 8 * MINUTE);
  assert.equal(s.alarms.at(-1)[3], 8);
  s.h.clock.advance(40 * MINUTE);
  await s.h.settle();
  assert.equal(s.value().sessions.length, 1);
  assert.equal(s.value().sessions[0].minutes, 40);
  assert.equal(s.value().timer.mode, 'break');
  assert.equal(s.value().timer.totalMs, 8 * MINUTE);
  s.value().startTimer();
  await s.h.settle();
  s.h.clock.advance(8 * MINUTE);
  await s.h.settle();
  assert.equal(s.value().timer.mode, 'focus');
  assert.equal(s.value().timer.totalMs, 40 * MINUTE);
  assert.equal(s.value().sessions.length, 1);
  assert.equal(s.saved().tasks[0].focusMinutes, 40);
  s.h.unmount();
});

test('starting a web timer primes its completion sound from the start action', async () => {
  const s = provider([legacy], 'web');
  await s.h.settle();
  s.value().startTimer();
  await s.h.settle();
  assert.equal(s.preparedAlarms(), 1);
  assert.equal(s.value().timer.isRunning, true);
  s.h.unmount();
});

test('editing a running/paused task preserves this cycle and records its original duration', async () => {
  const task = { ...legacy, focusMinutes: 27, breakMinutes: 7.5 };
  const s = provider([task]);
  await s.h.settle();
  s.value().startTimer();
  await s.h.settle();
  s.h.clock.advance(MINUTE);
  await s.h.settle();
  s.value().pauseTimer();
  await s.h.settle();
  const remaining = s.value().timer.remainingMs;
  s.value().updateTask({ ...task, focusMinutes: 45, breakMinutes: 9 });
  await s.h.settle();
  assert.equal(s.value().timer.remainingMs, remaining);
  s.value().startTimer();
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 27 * MINUTE);
  assert.equal(s.value().timer.breakDurationMs, 7.5 * MINUTE);
  s.h.clock.advance(remaining);
  await s.h.settle();
  assert.equal(s.value().sessions[0].minutes, 27);
  assert.equal(s.value().timer.totalMs, 7.5 * MINUTE);
  s.value().startTimer();
  await s.h.settle();
  s.h.clock.advance(7.5 * MINUTE);
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 45 * MINUTE);
  assert.equal(s.value().timer.breakDurationMs, 9 * MINUTE);
  s.h.unmount();
});

test('reset, mode changes and choosing another task use the correct task settings', async () => {
  const s = provider([legacy, { ...legacy, id: 'other', focusMinutes: 50, breakMinutes: 12 }]);
  await s.h.settle();
  s.value().selectTask('other');
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 50 * MINUTE);
  s.value().changeTimerMode('break');
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 12 * MINUTE);
  s.value().startTimer();
  await s.h.settle();
  s.value().selectTask(legacy.id);
  await s.h.settle();
  assert.equal(s.value().timer.taskId, 'other');
  s.value().pauseTimer();
  await s.h.settle();
  s.value().resetTimer();
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 12 * MINUTE);
  s.value().selectTask(legacy.id);
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 5 * MINUTE);
  s.value().changeTimerMode('focus');
  await s.h.settle();
  assert.equal(s.value().timer.totalMs, 25 * MINUTE);
  s.h.unmount();
});

function find(node, id) {
  if (Array.isArray(node)) {
    for (const child of node) { const result = find(child, id); if (result) return result; }
  } else if (node && typeof node === 'object') {
    if (node.props?.testID === id) return node;
    return find(node.props?.children, id);
  }
}

test('task editor updates automatic breaks live, preserves overrides and lets users return to automatic', () => {
  const added = [];
  const h = startupHarness({
    'expo-router': { router: { back() {} }, useLocalSearchParams: () => ({}) },
    'react-native': { Alert: {}, Keyboard: { dismiss() {} }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: value => value } },
    '@expo/vector-icons': { Feather: 'Feather' },
    '@/components/AppText': { AppText: 'Text', AppTextInput: 'TextInput' },
    '@/components/AppUI': Object.fromEntries(['ActionButton', 'IconButton', 'Label', 'Page', 'PageHeading', 'Surface'].map(name => [name, name])),
    '@/hooks/useColors': { useColors: () => ({}) },
    '@/store/FocusContext': { useFocus: () => ({ isReady: true, tasks: [], addTask: task => added.push(task), updateTask() {}, archiveTask() {} }) },
  });
  const Screen = h.load('app/task.tsx').default;
  const editor = Screen();
  h.mount(() => editor.type(editor.props));
  const change = (id, value) => { find(h.result, id).props.onChangeText(value); h.render(); };
  change('task-title', 'Study');
  change('task-focus-minutes', '40');
  assert.equal(find(h.result, 'task-break-minutes').props.value, '8');
  change('task-break-minutes', '12');
  change('task-focus-minutes', '50');
  assert.equal(find(h.result, 'task-break-minutes').props.value, '12');
  find(h.result, 'save-task').props.onPress();
  assert.equal(added[0].focusMinutes, 50);
  assert.equal(added[0].breakMinutes, 12);
  find(h.result, 'task-break-automatic').props.onPress();
  h.render();
  assert.equal(find(h.result, 'task-break-minutes').props.value, '10');
  find(h.result, 'save-task').props.onPress();
  assert.equal(added[1].breakMinutes, undefined);
  change('task-focus-minutes', '0');
  find(h.result, 'save-task').props.onPress();
  h.render();
  assert.ok(find(h.result, 'task-focus-error'));
  assert.equal(added.length, 2);
  h.unmount();
});
