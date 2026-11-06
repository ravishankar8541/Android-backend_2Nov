import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-quota-enforcement-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
  DEFAULT_MONTHLY_LEAVES: '0',
});
const { Employee } = await import('../src/models/Employee.js');
const { LeaveQuota } = await import('../src/models/LeaveQuota.js');
const { LeaveRequest } = await import('../src/models/LeaveRequest.js');
const { Holiday } = await import('../src/models/Holiday.js');
const { findQuotaOverage } = await import('../src/services/leave-quota.js');

afterEach(() => mock.restoreAll());

const RAMESH = { _id: 'e1', id: 'e1', employeeId: 'VAM-01', shift: { weeklyOffDays: [0, 6] } };

function date(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function request(_id, startDate, endDate, status = 'approved') {
  return { _id, employee: 'e1', startDate: date(startDate), endDate: date(endDate), status, halfDay: false };
}

function wire({ quotas = {}, requests = [], holidays = [] } = {}) {
  mock.method(Employee, 'findById', () => ({ populate: () => Promise.resolve(RAMESH) }));
  mock.method(LeaveQuota, 'find', (filter) => ({ select: () => Promise.resolve([{ employee: 'e1', days: quotas[filter.monthKey] ?? 0 }]) }));
  mock.method(LeaveRequest, 'find', () => ({ select: () => Promise.resolve(requests) }));
  mock.method(Holiday, 'find', () => ({ select: () => Promise.resolve(holidays.map((key) => ({ date: key }))) }));
}

function overage(startDate, endDate, extra = {}) {
  return findQuotaOverage({ employeeId: 'e1', startDate: date(startDate), endDate: date(endDate), ...extra });
}

test('a request that still fits the assigned days is allowed', async () => {
  wire({ quotas: { '2026-09': 2 } });
  assert.equal(await overage('2026-09-08', '2026-09-09'), null);
});

test('a request that needs more than the assigned days is refused with what is left', async () => {
  wire({ quotas: { '2026-09': 1 }, requests: [request('r1', '2026-09-08', '2026-09-08')] });
  assert.deepEqual(await overage('2026-09-15', '2026-09-16'), {
    monthKey: '2026-09', assigned: 1, used: 1, pending: 0, requested: 2, available: 0,
  });
});

test('a pending request already holds its days so one assigned day is never promised twice', async () => {
  wire({ quotas: { '2026-09': 2 }, requests: [request('r1', '2026-09-14', '2026-09-15', 'pending')] });
  assert.equal((await overage('2026-09-21', '2026-09-21')).available, 0);
});

test('reviewing a pending request ignores the days that request itself is holding', async () => {
  wire({ quotas: { '2026-09': 2 }, requests: [request('r1', '2026-09-14', '2026-09-15', 'pending')] });
  assert.equal(await overage('2026-09-21', '2026-09-21', { excludeRequestId: 'r1' }), null);
});

test('weekly offs and holidays inside a request never run into the quota', async () => {
  wire({ quotas: { '2026-09': 0 } });
  assert.equal(await overage('2026-09-05', '2026-09-06'), null);
  wire({ quotas: { '2026-09': 0 }, holidays: ['2026-09-08'] });
  assert.equal(await overage('2026-09-08', '2026-09-08'), null);
});

test('a half day is measured as half a day against what is left', async () => {
  wire({ quotas: { '2026-09': 1 }, requests: [request('r1', '2026-09-08', '2026-09-08')] });
  const result = await overage('2026-09-15', '2026-09-15', { halfDay: true });
  assert.equal(result.requested, 0.5);
  assert.equal(result.available, 0);
});

test('a request spanning two months is refused by the month that runs out first', async () => {
  wire({ quotas: { '2026-11': 1, '2026-12': 0 } });
  const result = await overage('2026-11-30', '2026-12-02');
  assert.equal(result.monthKey, '2026-12');
  assert.equal(result.requested, 2);
  assert.equal(result.assigned, 0);
});

test('a request dated backwards is not an overage the employee has to be told about', async () => {
  wire({ quotas: { '2026-09': 0 } });
  assert.equal(await overage('2026-09-16', '2026-09-15'), null);
});
