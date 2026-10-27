const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupHarness } = require('./helpers/startup-harness.cjs');

const task = { id: 'archived', title: 'Study French', archived: true, targetSessions: 2, repeatDays: [], createdAt: 1 };
const active = { ...task, id: 'active', title: 'Read', archived: false };
const original = {
  tasks: [task, active],
  sessions: [
    { id: 'one', taskId: task.id, completedAt: 1699999999000, minutes: 25 },
    { id: 'two', taskId: active.id, completedAt: 1699999999000, minutes: 25 },
  ],
  timer: { mode: 'break', taskId: task.id, isRunning: true, endsAt: 1700000300000, remainingMs: 300000, totalMs: 300000 },
  alertsEnabled: true,
};

function storeHarness(snapshot) {
  let stored = JSON.stringify(snapshot);
  const h = startupHarness({
    '@react-native-async-storage/async-storage': {
      getItem: async () => stored,
      setItem: async (_key, value) => { stored = value; },
    },
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: {} },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Linking: {}, Platform: { OS: 'android' } },
    '@/services/timerAlerts': { syncTimerNotification: async () => {}, hasScheduledAlarm: () => true },
  });
  const { FocusProvider } = h.load('store/FocusContext.tsx');
  h.mount(() => FocusProvider({ children: null }));
  return { h, value: () => h.result.props.value, saved: () => JSON.parse(stored) };
}

test('deleting an archived task persists removal without deleting session history or interrupting the break', async () => {
  const s = storeHarness(original);
  await s.h.settle();
  s.value().deleteTask(task.id);
  await s.h.settle();
  const saved = s.saved();
  assert.deepEqual(saved.tasks, [active]);
  assert.equal(saved.sessions.length, 2);
  assert.deepEqual(saved.sessions[0], { ...original.sessions[0], taskTitle: task.title });
  assert.deepEqual(saved.sessions[1], original.sessions[1]);
  assert.deepEqual(saved.timer, { ...original.timer, taskId: null });
  assert.equal(saved.alertsEnabled, true);
  const reopened = storeHarness(saved);
  await reopened.h.settle();
  assert.equal(reopened.value().tasks.some(item => item.id === task.id), false);
  assert.equal(reopened.value().sessions[0].taskTitle, task.title);
  reopened.h.unmount();
  s.h.unmount();
});

test('active or missing task IDs cannot be permanently deleted; repeated deletion is harmless', async () => {
  const s = storeHarness(original);
  await s.h.settle();
  for (const id of [active.id, 'missing']) {
    s.value().deleteTask(id);
    await s.h.settle();
    assert.deepEqual(s.saved(), original);
  }
  s.value().deleteTask(task.id);
  await s.h.settle();
  const firstDelete = s.saved();
  s.value().deleteTask(task.id);
  await s.h.settle();
  assert.deepEqual(s.saved(), firstDelete);
  s.h.unmount();
});

function find(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, predicate); if (match) return match; }
  } else if (node && typeof node === 'object') {
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
  }
}

test('Delete appears only in Archived; cancel and Android back preserve the task; confirm deletes once', () => {
  const calls = [];
  const archives = [];
  const state = {
    tasks: [task, active], sessions: [], isReady: true,
    archiveTask(id) { archives.push(id); }, updateTask() {},
    deleteTask(id) { calls.push(id); state.tasks = state.tasks.filter(item => item.id !== id); },
  };
  const h = startupHarness({
    'expo-router': { router: { push() {} } },
    'react-native': { Alert: {}, Pressable: 'Pressable', View: 'View', Modal: 'Modal', StyleSheet: { create: value => value, absoluteFill: {} } },
    '@expo/vector-icons': { Feather: 'Feather' },
    '@/components/AppText': { AppText: 'Text' },
    '@/components/AppUI': Object.fromEntries(['ActionButton', 'IconButton', 'Page', 'PageHeading', 'Surface'].map(name => [name, name])),
    '@/hooks/useColors': { useColors: () => ({}) },
    '@/store/FocusContext': { useFocus: () => state, getTaskSessionCount: () => 0, isTaskComplete: () => false, mondayFirstDay: () => 1 },
  });
  const Screen = h.load('app/(tabs)/tasks.tsx').default;
  h.mount(Screen);
  const byId = (tree, id) => find(tree, node => node.props?.testID === id);
  const card = () => find(h.result, node => node.type?.name === 'TaskCard');
  assert.equal(card().props.task.id, active.id);
  assert.equal(byId(card().type(card().props), `delete-task-${active.id}`), undefined);
  byId(card().type(card().props), `archive-task-${active.id}`).props.onPress();
  h.render();
  let archiveDialog = find(h.result, node => node.type?.name === 'ConfirmDialog');
  let archiveModal = archiveDialog.type(archiveDialog.props);
  assert.equal(archiveModal.props.visible, true);
  byId(archiveModal, 'archive-task-dialog-cancel').props.onPress();
  h.render();
  assert.equal(archives.length, 0);
  byId(card().type(card().props), `archive-task-${active.id}`).props.onPress();
  h.render();
  archiveDialog = find(h.result, node => node.type?.name === 'ConfirmDialog');
  archiveModal = archiveDialog.type(archiveDialog.props);
  byId(archiveModal, 'archive-task-dialog-confirm').props.onPress();
  h.render();
  assert.deepEqual(archives, [active.id]);
  byId(h.result, 'tasks-filter-archived').props.onPress();
  h.render();
  const open = () => {
    const element = card();
    byId(element.type(element.props), `delete-task-${task.id}`).props.onPress();
    h.render();
    const dialog = find(h.result, node => node.type?.name === 'DeleteTaskDialog');
    return dialog.type(dialog.props);
  };
  let modal = open();
  assert.equal(modal.type, 'Modal');
  assert.equal(modal.props.visible, true);
  assert.equal(calls.length, 0);
  byId(modal, 'cancel-delete-task').props.onPress();
  h.render();
  assert.equal(card().props.task.id, task.id);
  modal = open();
  modal.props.onRequestClose();
  h.render();
  assert.equal(calls.length, 0);
  modal = open();
  byId(modal, 'confirm-delete-task').props.onPress();
  h.render();
  assert.deepEqual(calls, [task.id]);
  assert.equal(card(), undefined);
  const closed = find(h.result, node => node.type?.name === 'DeleteTaskDialog');
  assert.equal(closed.type(closed.props).props.visible, false);
  h.unmount();
});
