const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupHarness } = require('./helpers/startup-harness.cjs');
const NOW = 1700000000000;
const task = { id: 'task', title: 'Study', archived: false };
const plan = { id: 'plan', taskId: task.id, dueAt: NOW + 3600000, reminderMinutes: 15, createdAt: NOW };

function service(platform = 'android') {
  const scheduled = new Map();
  const calls = [];
  let permission = { granted: true, canAskAgain: true };
  let fail = false;
  let failChannel = false;
  const notifications = {
    AndroidImportance: { HIGH: 4 }, AndroidNotificationVisibility: { PUBLIC: 1 },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    setNotificationChannelAsync: async (...args) => {
      calls.push(['channel', ...args]);
      if (failChannel) throw new Error("ExpoNotificationChannelManager.setNotificationChannelAsync has been rejected");
    },
    getPermissionsAsync: async () => permission,
    requestPermissionsAsync: async () => { calls.push(['request']); return permission; },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    cancelScheduledNotificationAsync: async id => { calls.push(['cancel', id]); scheduled.delete(id); },
    scheduleNotificationAsync: async request => {
      if (fail) throw new Error('Native scheduling failed');
      calls.push(['schedule', request]);
      scheduled.set(request.identifier, request);
      return request.identifier;
    },
  };
  const h = startupHarness({ 'react-native': { Platform: { OS: platform } }, './localNotifications': notifications });
  return { h, api: h.load('services/plannedReminders.ts'), scheduled, calls,
    channelFails: value => { failChannel = value; },
    deny: () => { permission = { granted: false, canAskAgain: false }; },
    fail: value => { fail = value; } };
}

test('5, 15, 30 and personalized minute reminders schedule at the exact chosen lead time, with sound and vibration', async () => {
  for (const minutes of [5, 15, 30, 47]) {
    const s = service();
    const input = { ...plan, reminderMinutes: minutes };
    s.api.validatePlan(input);
    await s.api.requestPlanPermission();
    await s.api.syncPlannedReminders([input], [task]);
    const request = [...s.scheduled.values()][0];
    assert.equal(request.trigger.date.getTime(), plan.dueAt - minutes * 60000);
    assert.equal(request.content.sound, 'default');
    assert.ok(request.content.vibrate.length > 1);
    assert.match(request.content.body, /Study/);
    assert.equal(request.content.data.kind, 'task-reminder');
  }
});

test('Android reminder channels use native sound/vibration defaults and failures remain explicit and retryable', async () => {
  const s = service();
  await s.api.requestPlanPermission();
  const [, channelId, options] = s.calls.find(([kind]) => kind === 'channel');
  assert.equal(channelId, 'focus-garden-reminders-v2');
  assert.equal(options.enableVibrate, true);
  assert.equal(options.sound, undefined);
  assert.equal(options.vibrationPattern, undefined);
  s.channelFails(true);
  await assert.rejects(s.api.requestPlanPermission(), /Android could not set up reminder alerts.*setNotificationChannelAsync/);
  await assert.rejects(s.api.syncPlannedReminders([plan], [task]), /Android could not set up/);
  assert.equal(s.scheduled.size, 0);
  s.channelFails(false);
  await s.api.syncPlannedReminders([plan], [task]);
  assert.equal(s.scheduled.size, 1);
});

test('existing reminders migrate to the compatible channel once without duplicates', async () => {
  const s = service();
  await s.api.syncPlannedReminders([plan], [task]);
  delete [...s.scheduled.values()][0].content.data.channelId;
  const before = s.calls.filter(([kind]) => kind === 'schedule').length;
  await s.api.syncPlannedReminders([plan], [task]);
  assert.equal(s.calls.filter(([kind]) => kind === 'schedule').length, before + 1);
  assert.equal(s.scheduled.size, 1);
  assert.equal([...s.scheduled.values()][0].trigger.channelId, 'focus-garden-reminders-v2');
  await s.api.syncPlannedReminders([plan], [task]);
  assert.equal(s.calls.filter(([kind]) => kind === 'schedule').length, before + 1);
});

test('event end time is validated independently and reminders still use its start time', async () => {
  const s = service();
  assert.doesNotThrow(() => s.api.validatePlan({ ...plan, endAt: plan.dueAt + 60000 }));
  for (const endAt of [plan.dueAt, plan.dueAt - 1, NaN, Infinity]) {
    assert.throws(() => s.api.validatePlan({ ...plan, endAt }), /end date and time/);
  }
  await s.api.syncPlannedReminders([{ ...plan, endAt: plan.dueAt + 3600000 }], [task]);
  assert.equal([...s.scheduled.values()][0].trigger.date.getTime(), plan.dueAt - 15 * 60000);
});

test('editing replaces the same reminder and reconciliation does not duplicate it', async () => {
  const s = service();
  await s.api.syncPlannedReminders([plan], [task]);
  await s.api.syncPlannedReminders([plan], [task]);
  assert.equal(s.calls.filter(([kind]) => kind === 'schedule').length, 1);
  const changed = { ...plan, dueAt: plan.dueAt + 3600000, reminderMinutes: 30 };
  await s.api.syncPlannedReminders([changed], [task]);
  assert.equal(s.scheduled.size, 1);
  assert.equal([...s.scheduled.values()][0].trigger.date.getTime(), changed.dueAt - 1800000);
});

test('cancellation, archive and deleted tasks remove only task reminders, never Pomodoro alarms', async () => {
  for (const tasks of [[{ ...task, archived: true }], []]) {
    const s = service();
    s.scheduled.set('focus-garden-timer', { identifier: 'focus-garden-timer', content: {} });
    await s.api.syncPlannedReminders([plan], [task]);
    await s.api.syncPlannedReminders([plan], tasks);
    assert.equal(s.scheduled.size, 1);
    assert.ok(s.scheduled.has('focus-garden-timer'));
  }
  const s = service();
  await s.api.syncPlannedReminders([plan], [task]);
  await s.api.syncPlannedReminders([], [task]);
  assert.equal(s.scheduled.size, 0);
});

test('an alert just becoming due is not canceled, and expired alerts are never replayed', async () => {
  const s = service();
  await s.api.syncPlannedReminders([plan], [task]);
  s.h.clock.advance(3600000);
  await s.api.syncPlannedReminders([plan], [task]);
  assert.equal(s.calls.some(([kind]) => kind === 'cancel'), false);
  s.scheduled.clear(); // Native delivery consumed the pending alert.
  await s.api.syncPlannedReminders([plan], [task]);
  assert.equal(s.scheduled.size, 0);
  assert.equal(s.calls.filter(([kind]) => kind === 'schedule').length, 1);
});

test('past deadlines, past reminder times, and invalid custom amounts fail explicitly', () => {
  const s = service();
  for (const input of [
    { ...plan, dueAt: NOW - 1 }, { ...plan, reminderMinutes: 61 },
    { ...plan, reminderMinutes: 0 }, { ...plan, reminderMinutes: 1.5 },
  ]) assert.throws(() => s.api.validatePlan(input));
});

test('denied permissions and native failures are visible; queue can recover on retry', async () => {
  const s = service();
  s.deny();
  await assert.rejects(s.api.requestPlanPermission(), /Allow notifications/);
  await assert.rejects(s.api.syncPlannedReminders([plan], [task]), /blocked/);
  assert.equal(s.scheduled.size, 0);
  const retry = service();
  retry.fail(true);
  await assert.rejects(retry.api.syncPlannedReminders([plan], [task]), /Native scheduling failed/);
  retry.fail(false);
  await retry.api.syncPlannedReminders([plan], [task]);
  assert.equal(retry.scheduled.size, 1);
});

test('web planning does not pretend to deliver native alerts or call native APIs', async () => {
  const s = service('web');
  await s.api.requestPlanPermission();
  await s.api.syncPlannedReminders([plan], [task]);
  assert.equal(s.calls.length, 0);
});
