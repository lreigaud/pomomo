const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupHarness } = require('./helpers/startup-harness.cjs');
const NOW = 1700000000000;
const task = { id: 'task', title: 'Study', archived: false };
const planned = { id: 'existing', taskId: task.id, dueAt: NOW + 3600000, reminderMinutes: 15, createdAt: NOW };

function store(saved = null) {
  let stored = saved;
  let failRead = false;
  let failWrite = false;
  let failSchedule = false;
  let deny = false;
  const calls = [];
  const focus = { tasks: [task], isReady: true };
  const h = startupHarness({
    '@react-native-async-storage/async-storage': {
      getItem: async () => { if (failRead) throw new Error('Read failed'); return stored; },
      setItem: async (key, data) => {
        if (failWrite) throw new Error('Write failed');
        assert.equal(key, 'focus-garden-plans-v1');
        stored = data;
      },
    },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    './FocusContext': { useFocus: () => focus },
    '@/services/plannedReminders': {
      validatePlan: input => {
        if (input.dueAt <= NOW || input.dueAt - input.reminderMinutes * 60000 <= NOW) throw new Error('Past reminder');
      },
      requestPlanPermission: async () => { if (deny) throw new Error('Permission denied'); },
      syncPlannedReminders: async (plans, tasks) => {
        calls.push({ plans: JSON.parse(JSON.stringify(plans)), tasks: JSON.parse(JSON.stringify(tasks)) });
        if (failSchedule) throw new Error('Native scheduling failed');
      },
    },
  });
  const { PlansProvider } = h.load('store/PlansContext.tsx');
  h.mount(() => PlansProvider({ children: null }));
  return {
    h, focus, calls, value: () => h.result.props.value, saved: () => stored,
    writeFails: value => { failWrite = value; },
    scheduleFails: value => { failSchedule = value; },
    deny: value => { deny = value; },
    readFails: value => { failRead = value; },
  };
}

test('plans create, edit and delete persist separately from tasks/history and survive reload', async () => {
  const s = store();
  await s.h.settle();
  assert.equal(s.value().isReady, true);
  await s.value().savePlan({ taskId: task.id, dueAt: planned.dueAt, reminderMinutes: 5 });
  await s.h.settle();
  const created = JSON.parse(s.saved())[0];
  assert.equal(created.reminderMinutes, 5);
  await s.value().savePlan({ ...created, reminderMinutes: 37 });
  await s.h.settle();
  assert.equal(JSON.parse(s.saved()).length, 1);
  assert.equal(JSON.parse(s.saved())[0].reminderMinutes, 37);
  const endAt = created.dueAt + 45 * 60000;
  await s.value().savePlan({ ...created, endAt, reminderMinutes: 37 });
  await s.h.settle();
  assert.equal(JSON.parse(s.saved())[0].endAt, endAt);
  const reopened = store(s.saved());
  await reopened.h.settle();
  assert.equal(reopened.value().plans[0].id, created.id);
  assert.equal(reopened.value().plans[0].endAt, endAt);
  await reopened.value().deletePlan(created.id);
  await reopened.h.settle();
  assert.deepEqual(JSON.parse(reopened.saved()), []);
  assert.equal(reopened.calls.at(-1).plans.length, 0);
  reopened.h.unmount();
  s.h.unmount();
});

test('invalid saved plans are never overwritten; denied permission cannot create a phantom plan', async () => {
  const broken = store('{bad json');
  await broken.h.settle();
  assert.equal(broken.value().isReady, false);
  assert.match(broken.value().error, /not been changed/);
  await assert.rejects(broken.value().savePlan(planned), /Load your saved plans/);
  assert.equal(broken.saved(), '{bad json');
  broken.h.unmount();
  const s = store();
  await s.h.settle();
  s.deny(true);
  await assert.rejects(s.value().savePlan({ ...planned, id: undefined }), /Event not saved.*Permission denied/);
  assert.equal(s.saved(), null);
  assert.equal(s.value().plans.length, 0);
  s.h.unmount();
});

test('a failed write leaves saved plans unchanged; scheduling failure leaves explicit retry feedback', async () => {
  const s = store(JSON.stringify([planned]));
  await s.h.settle();
  s.writeFails(true);
  await assert.rejects(s.value().deletePlan(planned.id), /could not be saved/);
  await s.h.settle();
  assert.deepEqual(JSON.parse(s.saved()), [planned]);
  assert.equal(s.value().plans.length, 1);
  assert.ok(s.value().error);
  s.h.unmount();
  const retry = store();
  await retry.h.settle();
  retry.scheduleFails(true);
  await retry.value().savePlan({ ...planned, id: undefined });
  await retry.h.settle();
  assert.equal(retry.value().plans.length, 1);
  assert.match(retry.value().notificationError, /scheduled/);
  retry.scheduleFails(false);
  await retry.value().refreshNotifications();
  await retry.h.settle();
  assert.equal(retry.value().notificationError, null);
  retry.h.unmount();
});

test('archiving/deleting tasks reconciles native reminders; archived tasks cannot gain new plans', async () => {
  const s = store(JSON.stringify([planned]));
  await s.h.settle();
  s.focus.tasks = [{ ...task, archived: true }];
  s.h.render();
  await s.h.settle();
  assert.equal(s.calls.at(-1).tasks[0].archived, true);
  await assert.rejects(s.value().savePlan({ ...planned, id: undefined }), /active task/);
  s.focus.tasks = [];
  s.h.render();
  await s.h.settle();
  assert.equal(s.calls.at(-1).tasks.length, 0);
  assert.deepEqual(JSON.parse(s.saved()), [planned]);
  s.h.unmount();
});
