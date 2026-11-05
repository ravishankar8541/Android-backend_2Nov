import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-leave-quota-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { allocateMonthlyLeave } = await import('../src/services/leave-quota.js');

const CONTEXT = { firstKey: '2026-09-01', lastKey: '2026-09-30', weeklyOffDays: [0, 6], holidayKeys: new Set() };

function request(startDate, endDate, status = 'approved', halfDay = false) {
  return { startDate: new Date(`${startDate}T00:00:00.000Z`), endDate: new Date(`${endDate}T00:00:00.000Z`), status, halfDay };
}

function allocate(requests, quota, overrides = {}) {
  return allocateMonthlyLeave({ requests, quota, ...CONTEXT, ...overrides });
}

test('leave up to the monthly quota is paid and the leftover days are unpaid', () => {
  const summary = allocate([request('2026-09-08', '2026-09-09'), request('2026-09-15', '2026-09-15')], 2);
  assert.deepEqual([...summary.paidKeys].sort(), ['2026-09-08', '2026-09-09']);
  assert.deepEqual([...summary.unpaidKeys], ['2026-09-15']);
  assert.equal(summary.used, 3);
  assert.equal(summary.remaining, 0);
});

test('a request that does not fit the remaining quota is unpaid as a whole', () => {
  const summary = allocate([request('2026-09-08', '2026-09-08'), request('2026-09-14', '2026-09-17')], 2);
  assert.deepEqual([...summary.paidKeys], ['2026-09-08']);
  assert.deepEqual([...summary.unpaidKeys].sort(), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);
  assert.equal(summary.used, 5);
});

test('weekly offs and holidays inside a leave do not spend the quota', () => {
  const fridayToMonday = allocate([request('2026-09-18', '2026-09-21')], 2);
  assert.deepEqual([...fridayToMonday.paidKeys].sort(), ['2026-09-18', '2026-09-21']);
  assert.equal(fridayToMonday.used, 2);
  const onlyOffDays = allocate([request('2026-09-26', '2026-09-27')], 2);
  assert.equal(onlyOffDays.used, 0);
  assert.equal(onlyOffDays.paidKeys.size, 0);
  assert.equal(onlyOffDays.unpaidKeys.size, 0);
  const onHoliday = allocate([request('2026-09-08', '2026-09-08')], 2, { holidayKeys: new Set(['2026-09-08']) });
  assert.equal(onHoliday.used, 0);
});

test('a half day spends half the quota and pending requests only wait for review', () => {
  const half = allocate([request('2026-09-08', '2026-09-08', 'approved', true)], 1);
  assert.equal(half.used, 0.5);
  assert.equal(half.remaining, 0.5);
  assert.deepEqual([...half.paidKeys], ['2026-09-08']);
  const pending = allocate([request('2026-09-08', '2026-09-10', 'pending')], 2);
  assert.equal(pending.used, 0);
  assert.equal(pending.pending, 3);
  assert.equal(pending.paidKeys.size, 0);
});

test('leave dated outside the month is counted only for the days it covers inside it', () => {
  const summary = allocate([request('2026-08-28', '2026-09-02')], 2);
  assert.deepEqual([...summary.paidKeys].sort(), ['2026-09-01', '2026-09-02']);
  assert.equal(summary.used, 2);
  assert.equal(allocate([request('2026-10-01', '2026-10-02')], 2).paidKeys.size, 0);
});
