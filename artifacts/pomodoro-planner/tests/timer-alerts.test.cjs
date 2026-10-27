const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real scheduling service with native device APIs replaced by
// recording adapters. A browser cannot test Android lock-screen delivery.
function service(platform = 'android', granted = true) {
  const calls = [];
  let now = 1700000000000;
  const presented = [];
  const notifications = {
    AndroidImportance: { HIGH: 4, LOW: 2 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    setNotificationHandler: (handler) => calls.push(['handler', handler]),
    setNotificationChannelAsync: async (...args) => {
      const [id, options] = args;
      if (id === 'focus-garden-alarms-v2') {
        assert.equal(options.enableVibrate, true);
        assert.equal(options.sound, undefined);
        assert.equal(options.vibrationPattern, undefined);
      }
      calls.push(['channel', ...args]);
    },
    getPermissionsAsync: async () => ({ granted, canAskAgain: true }),
    requestPermissionsAsync: async () => ({ granted, canAskAgain: true }),
    cancelScheduledNotificationAsync: async (id) => calls.push(['cancel', id]),
    getPresentedNotificationsAsync: async () => presented,
    dismissNotificationAsync: async (id) => calls.push(['dismiss', id]),
    scheduleNotificationAsync: async (request) => { calls.push(['schedule', request]); return request.identifier; },
  };
  const audio = {
    setAudioModeAsync: async () => calls.push(['audio-mode']),
    createAudioPlayer: () => ({
      muted: false,
      addListener: (_event, listener) => {
        audio.listener = listener;
        return { remove: () => calls.push(['remove-listener']) };
      },
      seekTo: async (time) => calls.push(['seek', time]),
      play: () => {
        calls.push(['play']);
        audio.listener?.({ playing: true });
      },
      pause: () => calls.push(['pause']),
    }),
  };
  class Clock extends Date { static now() { return now; } }
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../services/timerAlerts.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Date: Clock,
    require: (name) => {
      if (name === 'react-native') return { Platform: { OS: platform }, Vibration: { vibrate: (pattern) => calls.push(['vibrate', pattern]) } };
      if (name === './localNotifications') return notifications;
      if (name === 'expo-audio') return audio;
      if (name.endsWith('.wav')) return 1;
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const timer = {
    mode: 'focus', isRunning: true, endsAt: now + 60000,
    remainingMs: 60000, totalMs: 1500000, taskId: 'task-1',
  };
  return { api: exports, calls, presented, timer, clock: (value) => { now = value; } };
}

test('focus schedules silent ongoing status then audible, vibrating completion with the same ID', async () => {
  const s = service();
  await s.api.syncTimerNotification(s.timer, 'Study', true);
  const requests = s.calls.filter(([kind]) => kind === 'schedule').map(([, value]) => value);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].identifier, requests[1].identifier);
  assert.equal(requests[0].content.sticky, true);
  assert.equal(requests[0].content.sound, false);
  assert.match(requests[0].content.body, /Study.*Finishes at/);
  assert.equal(requests[1].content.sound, 'default');
  assert.ok(requests[1].content.vibrate.length > 1);
  assert.equal(requests[1].content.sticky, false);
  assert.equal(requests[1].trigger.date.getTime(), s.timer.endsAt);
  assert.equal(s.api.hasScheduledAlarm(s.timer.endsAt), true);
});

test('break uses its own completion message with sound and vibration', async () => {
  const s = service();
  await s.api.syncTimerNotification({ ...s.timer, mode: 'break' }, '', true);
  const completion = s.calls.filter(([kind]) => kind === 'schedule').at(-1)[1];
  assert.equal(completion.content.title, 'Break finished');
  assert.equal(completion.content.sound, 'default');
  assert.ok(completion.content.vibrate.length > 1);
});

test('focus completion notification describes the task-specific break length', async () => {
  const s = service();
  await s.api.syncTimerNotification(s.timer, 'Study', true, 9);
  const completion = s.calls.filter(([kind]) => kind === 'schedule').at(-1)[1];
  assert.match(completion.content.body, /9-minute break/);
  assert.equal(completion.trigger.date.getTime(), s.timer.endsAt);
});

test('pause cancels the alarm and removes running status, preserving completed alerts', async () => {
  const s = service();
  await s.api.syncTimerNotification(s.timer, 'Study', true);
  s.presented.push({ request: { identifier: s.api.TIMER_NOTIFICATION_ID, content: { data: { kind: 'running' } } } });
  await s.api.syncTimerNotification({ ...s.timer, isRunning: false, endsAt: null }, 'Study', true);
  assert.equal(s.api.hasScheduledAlarm(s.timer.endsAt), false);
  assert.ok(s.calls.some(([kind]) => kind === 'dismiss'));
  s.calls.length = 0;
  s.presented[0].request.content.data.kind = 'completion';
  await s.api.syncTimerNotification({ ...s.timer, isRunning: false, endsAt: null }, 'Study', true);
  assert.equal(s.calls.some(([kind]) => kind === 'dismiss'), false);
});

test('advancing to the next phase cannot cancel a native alarm that has just become due', async () => {
  const s = service();
  await s.api.syncTimerNotification(s.timer, 'Study', true);
  s.calls.length = 0;
  s.clock(s.timer.endsAt);
  await s.api.syncTimerNotification({ ...s.timer, mode: 'break', isRunning: false, endsAt: null }, 'Study', true);
  assert.equal(s.calls.some(([kind]) => kind === 'cancel'), false);
});

test('rapid start/pause requests run in order and end with no scheduled alarm', async () => {
  const s = service();
  await Promise.all([
    s.api.syncTimerNotification(s.timer, 'Study', true),
    s.api.syncTimerNotification({ ...s.timer, isRunning: false, endsAt: null }, 'Study', true),
  ]);
  assert.equal(s.api.hasScheduledAlarm(s.timer.endsAt), false);
  assert.equal(s.calls.at(-1)[0], 'cancel');
});

test('disabled notifications clean up their own timer without scheduling new alerts', async () => {
  const s = service();
  await s.api.syncTimerNotification(s.timer, 'Study', false);
  assert.equal(s.calls.some(([kind]) => kind === 'schedule'), false);
  assert.ok(s.calls.some(([kind, id]) => kind === 'cancel' && id === s.api.TIMER_NOTIFICATION_ID));
});

test('denied permission fails explicitly and does not schedule a notification', async () => {
  const s = service('android', false);
  await assert.rejects(s.api.syncTimerNotification(s.timer, 'Study', true), /blocked/);
  assert.equal(s.calls.some(([kind]) => kind === 'schedule'), false);
});

test('web never invokes native notification APIs', async () => {
  const s = service('web');
  await s.api.syncTimerNotification(s.timer, 'Study', true);
  assert.equal(s.calls.length, 0);
});

test('foreground fallback plays the bundled chime and a vibration pattern', async () => {
  const s = service();
  await s.api.playForegroundAlarm();
  assert.ok(s.calls.some(([kind]) => kind === 'vibrate'));
  assert.ok(s.calls.some(([kind]) => kind === 'seek'));
  assert.ok(s.calls.some(([kind]) => kind === 'play'));
});

test('web alarm prepares the bundled chime silently during the user gesture', () => {
  const s = service('web');
  s.api.prepareForegroundAlarm();
  assert.ok(s.calls.some(([kind]) => kind === 'play'));
  assert.ok(s.calls.some(([kind]) => kind === 'pause'));
  assert.ok(s.calls.some(([kind]) => kind === 'remove-listener'));
});

test('test alert uses a separate ID, leaving the real timer alarm untouched', async () => {
  const s = service();
  await s.api.syncTimerNotification(s.timer, 'Study', true);
  await s.api.testPhoneAlert(true);
  const request = s.calls.filter(([kind]) => kind === 'schedule').at(-1)[1];
  assert.notEqual(request.identifier, s.api.TIMER_NOTIFICATION_ID);
  assert.equal(s.api.hasScheduledAlarm(s.timer.endsAt), true);
});

test('local notification entry points never load Expo Go-incompatible remote push registration', () => {
  const adapterPath = path.join(__dirname, '../services/localNotifications.ts');
  const adapter = ts.transpileModule(fs.readFileSync(adapterPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const entryPoints = [...adapter.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(entryPoints.length > 0);
  const visited = new Set();
  function inspect(modulePath) {
    if (visited.has(modulePath)) return;
    visited.add(modulePath);
    assert.doesNotMatch(modulePath, /(?:TokenEmitter|PushToken|DevicePushTokenAutoRegistration|warnOfExpoGoPushUsage)/);
    const source = ts.createSourceFile(modulePath, fs.readFileSync(modulePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue;
      const dependency = statement.moduleSpecifier?.text;
      if (!dependency) continue;
      assert.notEqual(dependency, 'expo-notifications', 'Do not load the remote-push barrel');
      if (!dependency.startsWith('.')) continue;
      const base = path.resolve(path.dirname(modulePath), dependency);
      const resolved = [base + '.android.js', base + '.native.js', base + '.js', path.join(base, 'index.js')].find((file) => fs.existsSync(file));
      assert.ok(resolved, `Cannot inspect notification dependency ${dependency}`);
      inspect(resolved);
    }
  }
  for (const entryPoint of entryPoints) inspect(require.resolve(entryPoint));
});
