const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupHarness } = require('./helpers/startup-harness.cjs');

test('calendar navigation uses local calendar days and half-hour slot times', () => {
  const api = startupHarness().load('utils/dayCalendar.ts');
  assert.equal(api.shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(api.shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(api.parseDateKey('2026-02-30'), null);
  assert.deepEqual(Array.from(api.weekKeys('2026-10-21')), [
    '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
  ]);
  const slots = api.daySlots('2026-10-21');
  assert.equal(slots.length, 48);
  assert.equal(slots[19].id, '09-30');
  assert.equal(api.formatClock(slots[19].timestamp), '09:30');
  assert.equal(api.toDateKey(slots[19].timestamp), '2026-10-21');
  assert.equal(api.minutesIntoDay(slots[19].timestamp, '2026-10-21'), 570);
});

test('calendar event blocks retain exact times, assign overlapping columns and clip overnight events', () => {
  const api = startupHarness().load('utils/dayCalendar.ts');
  const key = '2026-10-21';
  const at = (h, m = 0) => api.slotTimestamp(key, h, m);
  const event = (id, startAt, endAt) => ({ id, title: id, startAt, endAt });
  const blocks = api.layoutDayEvents([
    event('first', at(9), at(10)),
    event('overlap', at(9, 30), at(10, 30)),
    event('later', at(11), at(12)),
    event('overnight', at(23, 30), api.slotTimestamp('2026-10-22', 1, 0)),
    event('outside', api.slotTimestamp('2026-10-22', 9, 0), api.slotTimestamp('2026-10-22', 10, 0)),
  ], key);
  assert.equal(blocks.length, 4);
  const first = blocks.find(b => b.id === 'first');
  const overlap = blocks.find(b => b.id === 'overlap');
  assert.equal(first.top, 9 * 64);
  assert.equal(first.height, 64);
  assert.equal(first.columns, 2);
  assert.notEqual(first.column, overlap.column);
  assert.equal(blocks.find(b => b.id === 'later').columns, 1);
  const overnight = blocks.find(b => b.id === 'overnight');
  assert.equal(overnight.clippedEnd, true);
  assert.equal(overnight.height, 32);
  const continuation = api.layoutDayEvents([overnight], '2026-10-22')[0];
  assert.equal(continuation.top, 0);
  assert.equal(continuation.height, 64);
  assert.equal(continuation.clippedStart, true);
});

test('calendar dates follow daylight-saving days and skipped times are not tappable', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Europe/Zurich';
  try {
    const api = startupHarness().load('utils/dayCalendar.ts');
    const spring = api.dayBounds('2026-03-29');
    const autumn = api.dayBounds('2026-10-25');
    assert.equal(spring.end - spring.start, 23 * 3600000);
    assert.equal(autumn.end - autumn.start, 25 * 3600000);
    assert.equal(api.shiftDateKey('2026-03-29', 1), '2026-03-30');
    assert.equal(api.daySlots('2026-03-29').find(s => s.id === '02-30').valid, false);
    assert.equal(api.daySlots('2026-03-29').find(s => s.id === '03-30').valid, true);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

function find(tree, id) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.props?.testID === id || tree.props?.id === id) return tree;
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

test('tapping a calendar slot creates a dated event; editing preserves reminder and duration, invalid end is blocked', async () => {
  const saved = [];
  const plans = [];
  const task = { id: 'study', title: 'Study', archived: false, focusMinutes: 40 };
  const h = startupHarness({
    'react-native': {
      AppState: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'web' }, Linking: {}, Modal: 'Modal', View: 'View', Pressable: 'Pressable',
      StyleSheet: { create: s => s },
    },
    'expo-router': { router: {} },
    '@expo/vector-icons': { Feather: 'Feather' },
    '@/components/AppText': { AppText: 'Text', AppTextInput: 'Input' },
    '@/components/AppUI': { ActionButton: 'Button', IconButton: 'Icon', Label: 'Label', Page: 'Page', PageHeading: 'Heading', Surface: 'Surface' },
    '@/components/DayCalendar': { DayCalendar: 'Calendar' },
    '@/components/ConfirmDialog': { ConfirmDialog: 'Confirm' },
    '@/hooks/useColors': { useColors: () => ({}) },
    '@/store/FocusContext': { useFocus: () => ({ tasks: [task], isReady: true }) },
    '@/store/PlansContext': {
      usePlans: () => ({
        plans, isReady: true, error: null, isBusy: false,
        savePlan: async value => {
          saved.push(value);
          const p = { ...value, id: value.id ?? 'created', createdAt: 1 };
          const idx = plans.findIndex(other => other.id === p.id);
          if (idx < 0) plans.push(p); else plans[idx] = p;
        },
      }),
    },
  });
  const Screen = h.load('app/(tabs)/plan.tsx').default;
  h.mount(Screen);
  const calendar = () => {
    const traverse = tree => {
      if (!tree || typeof tree !== 'object') return null;
      if (tree.type === 'Calendar') return tree;
      for (const child of [tree.props?.children].flat(Infinity)) {
        const found = traverse(child); if (found) return found;
      }
      return null;
    };
    return traverse(h.result);
  };
  const change = (id, value) => { find(h.result, id).props.onChangeText(value); h.render(); };
  const due = new Date(2026, 10, 5, 9, 30).getTime();
  calendar().props.onSelectSlot(due);
  h.render();
  assert.ok(find(h.result, 'plan-event-modal'));
  assert.equal(find(h.result, 'plan-date-input').props.value, '2026-11-05');
  assert.equal(find(h.result, 'plan-time-input').props.value, '09:30');
  assert.equal(find(h.result, 'plan-end-time-input').props.value, '10:10');
  find(h.result, 'plan-reminder-30').props.onPress();
  h.render();
  change('plan-end-time-input', '10:30');
  await find(h.result, 'plan-save').props.onPress();
  await h.settle();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].dueAt, due);
  assert.equal(saved[0].endAt, due + 60 * 60000);
  assert.equal(saved[0].reminderMinutes, 30);
  assert.equal(find(h.result, 'plan-event-modal'), null, 'saved editor must be unmounted, not leave an animated overlay');
  calendar().props.onSelectEvent('created');
  h.render();
  assert.equal(find(h.result, 'plan-end-time-input').props.value, '10:30');
  change('plan-end-time-input', '08:30');
  await find(h.result, 'plan-save').props.onPress();
  await h.settle();
  assert.equal(saved.length, 1);
  assert.ok(find(h.result, 'plan-end-time-error'));
  change('plan-date-input', '2026-11-06');
  change('plan-end-date-input', '2026-11-06');
  change('plan-end-time-input', '11:00');
  await find(h.result, 'plan-save').props.onPress();
  await h.settle();
  assert.equal(saved.length, 2);
  assert.equal(saved[1].id, 'created');
  assert.equal(saved[1].reminderMinutes, 30);
  h.unmount();
});
