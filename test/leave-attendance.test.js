import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-leave-attendance-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { Employee } = await import('../src/models/Employee.js');
const { Holiday } = await import('../src/models/Holiday.js');
const { Attendance } = await import('../src/models/Attendance.js');
const { markLeaveAttendance } = await import('../src/services/leave-attendance.js');

afterEach(() => mock.restoreAll());

const EMPLOYEE_ID = '507f1f77bcf86cd799439011';
const OFFICE_ID = '507f1f77bcf86cd799439012';

function date(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function wire({ office = OFFICE_ID, rows = {}, holidays = [] } = {}) {
  const created = [];
  const saved = [];
  mock.method(Employee, 'findById', () => ({
    select: () => ({ populate: () => Promise.resolve({ _id: EMPLOYEE_ID, id: EMPLOYEE_ID, office, shift: { weeklyOffDays: [0, 6] } }) }),
  }));
  mock.method(Holiday, 'find', () => ({ select: () => Promise.resolve(holidays.map((key) => ({ date: key }))) }));
  mock.method(Attendance, 'findOne', async (filter) => rows[filter.dateKey] ?? null);
  mock.method(Attendance, 'create', async (doc) => {
    created.push(doc);
    return doc;
  });
  for (const row of Object.values(rows)) mock.method(row, 'save', async () => { saved.push(row); });
  return { created, saved };
}

test('an approved leave writes one on_leave row for every working day it covers', async () => {
  const { created } = wire();
  const marked = await markLeaveAttendance({ employeeId: EMPLOYEE_ID, startDate: date('2026-09-05'), endDate: date('2026-09-09') });
  assert.equal(marked, 3);
  assert.deepEqual(created.map(({ dateKey }) => dateKey), ['2026-09-07', '2026-09-08', '2026-09-09']);
  assert.deepEqual(created.map(({ status }) => status), ['on_leave', 'on_leave', 'on_leave']);
  assert.equal(created[0].office, OFFICE_ID);
});

test('the leave register skips weekly offs and declared holidays', async () => {
  const { created } = wire({ holidays: ['2026-09-08'] });
  const marked = await markLeaveAttendance({ employeeId: EMPLOYEE_ID, startDate: date('2026-09-08'), endDate: date('2026-09-09') });
  assert.equal(marked, 1);
  assert.deepEqual(created.map(({ dateKey }) => dateKey), ['2026-09-09']);
});

test('a day the employee actually checked into keeps its real attendance', async () => {
  const checkedIn = { status: 'present', events: [{ type: 'IN' }, { type: 'OUT' }], save: async () => {} };
  const { created, saved } = wire({ rows: { '2026-09-08': checkedIn } });
  const marked = await markLeaveAttendance({ employeeId: EMPLOYEE_ID, startDate: date('2026-09-08'), endDate: date('2026-09-08') });
  assert.equal(marked, 0);
  assert.equal(created.length, 0);
  assert.equal(saved.length, 0);
  assert.equal(checkedIn.status, 'present');
});

test('an empty placeholder row is re-stamped so a revoked absence stops cutting salary', async () => {
  const empty = { status: 'absent', events: [], save: async () => {} };
  const { created } = wire({ rows: { '2026-09-08': empty } });
  const marked = await markLeaveAttendance({ employeeId: EMPLOYEE_ID, startDate: date('2026-09-08'), endDate: date('2026-09-08') });
  assert.equal(marked, 1);
  assert.equal(empty.status, 'on_leave');
  assert.equal(created.length, 0);
});

test('a profile with no office yet has no register to write into', async () => {
  const { created } = wire({ office: null });
  assert.equal(await markLeaveAttendance({ employeeId: EMPLOYEE_ID, startDate: date('2026-09-08'), endDate: date('2026-09-09') }), 0);
  assert.equal(created.length, 0);
});

test('the written rows are register-legal because on_leave is now a real status', async () => {
  const { created } = wire();
  await markLeaveAttendance({ employeeId: EMPLOYEE_ID, startDate: date('2026-09-08'), endDate: date('2026-09-08') });
  assert.ok(!new Attendance(created[0]).validateSync());
  assert.ok(new Attendance({ employee: EMPLOYEE_ID, office: OFFICE_ID, dateKey: '2026-09-08', status: 'leave' }).validateSync());
});
