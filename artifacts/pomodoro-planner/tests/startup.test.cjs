const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupHarness } = require('./helpers/startup-harness.cjs');

test('fonts open normally on success, or immediately on font failure', () => {
  for (const [loaded, error] of [[true, null], [false, new Error('Font unavailable')]]) {
    const h = startupHarness();
    const { useStartupFonts } = h.load('hooks/useStartupFonts.ts');
    assert.equal(h.mount(() => useStartupFonts(loaded, error)).pending, false);
    h.unmount();
  }
});

test('indefinitely pending fonts stop blocking at eight seconds, and late success does not block again', () => {
  const h = startupHarness();
  const { useStartupFonts } = h.load('hooks/useStartupFonts.ts');
  let loaded = false;
  assert.equal(h.mount(() => useStartupFonts(loaded, null)).pending, true);
  h.clock.advance(7999);
  assert.equal(h.render().pending, true);
  h.clock.advance(1);
  assert.equal(h.render().pending, false);
  assert.equal(h.result.timedOut, true);
  loaded = true;
  assert.equal(h.render().pending, false);
  h.unmount();
});

test('time spent before the font hook mounts counts toward the startup limit', () => {
  const h = startupHarness();
  const { useStartupFonts } = h.load('hooks/useStartupFonts.ts');
  h.clock.advance(8001);
  assert.equal(h.mount(() => useStartupFonts(false, null)).pending, false);
  h.unmount();
});

test('system-font fallback covers all Inter weights and preserves the loaded styles', () => {
  const h = startupHarness();
  const { fontStyleFor } = h.load('utils/fontFallback.ts');
  for (const [family, weight] of Object.entries({
    Inter_400Regular: '400', Inter_500Medium: '500', Inter_600SemiBold: '600', Inter_700Bold: '700',
  })) {
    const style = { fontFamily: family, fontSize: 14, color: 'green' };
    const fallback = fontStyleFor(style, false, 'sans-serif');
    assert.equal(fallback.fontFamily, 'sans-serif');
    assert.equal(fallback.fontWeight, weight);
    assert.equal(fallback.color, style.color);
    assert.equal(fontStyleFor(style, true, 'sans-serif'), style);
  }
  const icon = { fontFamily: 'Feather' };
  assert.equal(fontStyleFor(icon, false, 'sans-serif'), icon);
});

test('splash preparation rejection is handled and async hide failure falls back to synchronous hide', async () => {
  const h = startupHarness();
  const { holdSplashSafely, hideSplashSafely } = h.load('services/startup.ts');
  let hidden = 0;
  const api = {
    preventAutoHideAsync: async () => { throw new Error('Native unavailable'); },
    hideAsync: async () => { throw new Error('Bridge failed'); },
    hide: () => { hidden++; },
  };
  await holdSplashSafely(api);
  assert.equal(await hideSplashSafely(api), true);
  assert.equal(hidden, 1);
  assert.equal(await hideSplashSafely({ ...api, hide: () => { throw new Error('Unavailable'); } }), false);
});

test('an async splash hide that never settles cannot hold up the fallback', async () => {
  const h = startupHarness();
  const { hideSplashSafely } = h.load('services/startup.ts');
  let hidden = false;
  const request = hideSplashSafely({ hideAsync: () => new Promise(() => {}), hide: () => { hidden = true; } });
  h.clock.advance(1000);
  assert.equal(await request, true);
  assert.equal(hidden, true);
});

function storageHarness(read) {
  const writes = [];
  const storage = {
    getItem: read,
    setItem: async (key, value) => { writes.push({ key, value }); },
  };
  const h = startupHarness({
    '@react-native-async-storage/async-storage': storage,
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 1, Medium: 2 } },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Linking: {}, Platform: { OS: 'android' } },
    '@/services/timerAlerts': { syncTimerNotification: async () => {}, hasScheduledAlarm: () => true },
  });
  const { FocusProvider } = h.load('store/FocusContext.tsx');
  h.mount(() => FocusProvider({ children: 'app' }));
  return { h, writes, value: () => h.result.props.value };
}

const saved = {
  tasks: [{ id: 'task-1', title: 'Study', targetSessions: 3, repeatDays: [1, 3], createdAt: 1700000000000, archived: false }],
  sessions: [{ id: 'session-1', taskId: 'task-1', completedAt: 1699990000000, minutes: 25 }],
  timer: { mode: 'break', isRunning: true, remainingMs: 300000, totalMs: 300000, endsAt: 1700000300000, taskId: 'task-1' },
  alertsEnabled: true,
};

test('successful restore retains tasks, sessions, active timer, and alert preferences', async () => {
  const s = storageHarness(async () => JSON.stringify(saved));
  await s.h.settle();
  assert.equal(s.value().isReady, true);
  assert.deepEqual(JSON.parse(s.writes.at(-1).value), saved);
  assert.equal(s.value().tasks[0].title, saved.tasks[0].title);
  assert.equal(s.value().timer.endsAt, saved.timer.endsAt);
  assert.equal(s.value().alertsEnabled, true);
  s.h.unmount();
});

test('failed saved-data read blocks navigation and writes; retry can restore the same history', async () => {
  let fail = true;
  const s = storageHarness(async () => {
    if (fail) throw new Error('Storage unavailable');
    return JSON.stringify(saved);
  });
  await s.h.settle();
  assert.equal(s.value().isReady, false);
  assert.match(s.value().storageError, /not been changed/);
  assert.equal(s.writes.length, 0);
  fail = false;
  s.value().retryLoad();
  await s.h.settle();
  assert.equal(s.value().isReady, true);
  assert.equal(s.value().storageError, null);
  assert.deepEqual(JSON.parse(s.writes.at(-1).value), saved);
  s.h.unmount();
});

test('stalled read is bounded; its late result cannot overwrite a successful retry', async () => {
  let resolveOldRead;
  let attempt = 0;
  const s = storageHarness(() => {
    attempt++;
    return attempt === 1 ? new Promise((resolve) => { resolveOldRead = resolve; }) : Promise.resolve(JSON.stringify(saved));
  });
  await s.h.settle();
  s.h.clock.advance(8000);
  await s.h.settle();
  assert.equal(s.value().isReady, false);
  assert.ok(s.value().storageError);
  assert.equal(s.writes.length, 0);
  s.value().retryLoad();
  await s.h.settle();
  const writesBeforeLateRead = s.writes.length;
  resolveOldRead(JSON.stringify({ ...saved, tasks: [], sessions: [] }));
  await s.h.settle();
  assert.equal(s.value().tasks.length, 1);
  assert.equal(s.value().sessions.length, 1);
  assert.equal(s.writes.length, writesBeforeLateRead);
  s.h.unmount();
});

test('corrupt saved JSON and invalid data shape are never replaced with empty defaults', async () => {
  for (const invalid of ['{bad json', '{"tasks":[],"sessions":[]}', '{"timer":{},"tasks":null,"sessions":[]}']) {
    const s = storageHarness(async () => invalid);
    await s.h.settle();
    assert.equal(s.value().isReady, false);
    assert.ok(s.value().storageError);
    assert.equal(s.writes.length, 0);
    s.h.unmount();
  }
});

test('genuinely new storage can initialize normally, without waiting for a read timeout', async () => {
  const s = storageHarness(async () => null);
  await s.h.settle();
  assert.equal(s.value().isReady, true);
  assert.equal(s.value().tasks.length, 0);
  assert.equal(s.value().storageError, null);
  assert.equal(s.writes.length, 1);
  s.h.unmount();
});

test('late font completion preserves the mounted providers and route component', async () => {
  let loaded = false;
  let hides = 0;
  const storageState = { isReady: true, storageError: null, retryLoad() {} };
  const h = startupHarness({
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable' },
    '@tanstack/react-query': { QueryClient: class {}, QueryClientProvider: 'QueryClientProvider' },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureHandlerRootView' },
    'react-native-keyboard-controller': { KeyboardProvider: 'KeyboardProvider' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    '@/components/ErrorBoundary': { ErrorBoundary: 'ErrorBoundary' },
    '@expo-google-fonts/inter': { useFonts: () => [loaded, null] },
    'expo-router': { Stack: 'Stack' },
    'expo-splash-screen': { preventAutoHideAsync: async () => true, hideAsync: async () => { hides++; }, hide() {} },
    '@/store/FocusContext': { FocusProvider: 'FocusProvider', useFocus: () => storageState },
    '@/store/PlansContext': { PlansProvider: 'PlansProvider' },
    '@/components/AppText': { FontAvailability: { Provider: 'FontProvider' } },
    '@/components/StartupScreen': { StartupScreen: 'StartupScreen' },
    '@/hooks/useColors': { useColors: () => ({ accent: 'green', foreground: 'black' }) },
  });
  const { default: RootLayout } = h.load('app/_layout.tsx');
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat()) {
      const result = find(child, predicate);
      if (result) return result;
    }
  }
  h.mount(RootLayout);
  const startup = find(h.result, (node) => node.type?.name === 'StartupContent');
  assert.equal(startup.type(startup.props).type, 'StartupScreen');
  assert.equal(find(h.result, (node) => node.type === 'FontProvider').props.value, false);
  find(h.result, (node) => node.type === 'View' && node.props.onLayout).props.onLayout();
  await h.settle();
  assert.equal(hides, 1, 'The first visible loading frame dismisses the native splash even with pending fonts');
  h.clock.advance(8000);
  await h.settle();
  const before = find(h.result, (node) => node.type?.name === 'StartupContent');
  const routeBefore = before.type(before.props).type;
  const providerBefore = find(h.result, (node) => node.type === 'FocusProvider').type;
  loaded = true;
  h.render();
  const after = find(h.result, (node) => node.type?.name === 'StartupContent');
  assert.equal(after.type(after.props).type, routeBefore);
  assert.equal(find(h.result, (node) => node.type === 'FocusProvider').type, providerBefore);
  assert.equal(find(h.result, (node) => node.type === 'FontProvider').props.value, true);
  await h.settle();
  assert.equal(hides, 1, 'Late fonts do not restart splash dismissal');
  storageState.isReady = false;
  storageState.storageError = 'Saved data could not load.';
  h.render();
  const blocked = find(h.result, (node) => node.type?.name === 'StartupContent');
  const recovery = blocked.type(blocked.props);
  assert.equal(recovery.type, 'StartupScreen');
  assert.equal(recovery.props.error, storageState.storageError);
  assert.equal(recovery.props.onRetry, storageState.retryLoad);
  h.unmount();
  await h.settle();
});
