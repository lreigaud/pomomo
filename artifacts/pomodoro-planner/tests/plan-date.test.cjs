const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupHarness } = require('./helpers/startup-harness.cjs');

test('plan date/time inputs use device-local time and reject impossible dates and times', () => {
  const h = startupHarness();
  const api = h.load('utils/planDate.ts');
  const result = api.parseLocalDateTime('2030-02-28', '09:05');
  assert.ok(result.ok);
  assert.equal(api.formatDateInput(result.value), '2030-02-28');
  assert.equal(api.formatTimeInput(result.value), '09:05');
  for (const [date, time] of [
    ['2030-02-30', '09:00'], ['2030-13-01', '09:00'], ['2030-2-1', '09:00'],
    ['2030-02-01', '24:00'], ['2030-02-01', '9:60'], ['2030-02-01', '-1:30'],
  ]) assert.equal(api.parseLocalDateTime(date, time).ok, false);
  assert.equal(api.parseLocalDateTime('2032-02-29', '09:00').ok, true);
});

test('custom reminder minutes require a safe positive whole number', () => {
  const api = startupHarness().load('utils/planDate.ts');
  assert.equal(api.parseReminderMinutes('15'), 15);
  assert.equal(api.parseReminderMinutes('45'), 45);
  for (const value of ['0', '1.5', '-3', '', 'five', '9007199254740992']) {
    assert.equal(api.parseReminderMinutes(value), null);
  }
});
