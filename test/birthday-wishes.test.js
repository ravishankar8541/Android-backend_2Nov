import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-birthday-wishes-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { Employee } = await import('../src/models/Employee.js');
const { User } = await import('../src/models/User.js');
const { Notification } = await import('../src/models/Notification.js');
const { celebrantsOn, sendBirthdayWishes } = await import('../src/services/birthday-notifications.js');

afterEach(() => mock.restoreAll());

// 09:00 IST on 6 November 2026
const MORNING = new Date('2026-11-06T03:30:00.000Z');
const RAJU = { _id: 'e1', employeeId: 'VAM-01', firstName: 'Raju', lastName: 'Ali', department: 'Developer', dateOfBirth: new Date('1995-11-06T00:00:00.000Z') };
const OTHER = { _id: 'e2', employeeId: 'VAM-02', firstName: 'Shubham', lastName: 'Kumar', department: 'IT', dateOfBirth: new Date('1990-05-02T00:00:00.000Z') };
const ACCOUNTS = [{ _id: 'u1', employee: 'e1' }, { _id: 'u2', employee: 'e2' }, { _id: 'u3', employee: null }];

function chain(rows) {
  return { select: () => chain(rows), lean: async () => rows };
}

function wire({ employees = [RAJU, OTHER], exists = false } = {}) {
  const inserted = [];
  mock.method(Employee, 'find', () => chain(employees));
  mock.method(User, 'find', () => chain(ACCOUNTS));
  mock.method(Notification, 'exists', async () => exists);
  mock.method(Notification, 'insertMany', async (docs) => { inserted.push(...docs); return docs; });
  return inserted;
}

test('everyone except the birthday employee receives the wish', async () => {
  const inserted = wire();
  const result = await sendBirthdayWishes({ now: MORNING });
  assert.equal(result.sent, 1);
  assert.deepEqual(inserted.map((item) => item.recipient), ['u2', 'u3']);
  assert.equal(inserted[0].type, 'birthday_wish');
  assert.equal(inserted[0].title, "Today is Raju Ali's birthday");
  assert.match(inserted[0].message, /VAM-01/);
});

test('a birthday already announced today is not announced twice', async () => {
  const inserted = wire({ exists: true });
  const result = await sendBirthdayWishes({ now: MORNING });
  assert.equal(result.sent, 0);
  assert.equal(inserted.length, 0);
});

test('an employee whose birthday is another day gets nothing', async () => {
  const inserted = wire({ employees: [OTHER] });
  const result = await sendBirthdayWishes({ now: MORNING });
  assert.equal(result.sent, 0);
  assert.equal(inserted.length, 0);
});

test('a leap day birthday matches only when the calendar has that day', () => {
  const leapBorn = [{ _id: 'e9', employeeId: 'VAM-09', firstName: 'Leap', lastName: 'Day', dateOfBirth: new Date('2000-02-29T00:00:00.000Z') }];
  assert.equal(celebrantsOn('2028-02-29', leapBorn).length, 1);
  assert.equal(celebrantsOn('2027-02-28', leapBorn).length, 0);
});
