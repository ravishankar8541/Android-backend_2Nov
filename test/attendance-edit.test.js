import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-attendance-edit-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { applyAttendanceEdit } = await import('../src/services/attendance-edit.js');

const NOW = new Date('2026-11-03T18:00:00Z');
const employee = { shift: { breakMinutes: 60 } };
const stored = (id, type, occurredAt) => ({
  _id: id, type, occurredAt: new Date(occurredAt), method: 'face_liveness',
  verification: { faceMatched: true, livenessPassed: true, providerReference: `proof-${id}` },
  location: { latitude: 28.6, longitude: 77.2, accuracyMeters: 8, distanceMeters: 12 },
});
const sent = (id, type, occurredAt, overrides = {}) => ({
  _id: id, type, occurredAt, method: 'face_liveness', faceMatched: true, livenessPassed: true,
  latitude: 28.6, longitude: 77.2, accuracyMeters: 8, distanceMeters: 12, ...overrides,
});
const record = (events) => ({ employee: 'employee-a', office: 'office-a', dateKey: '2026-11-03', status: 'present', netWorkingMinutes: 0, events });
const edit = (attendance, payload) => applyAttendanceEdit({
  attendance, employee, actorId: 'admin-a', reason: 'Matched the register the employee signed',
  now: NOW, payload: { dateKey: attendance.dateKey, ...payload },
});

test('an edited check-out recalculates the worked minutes from the new times', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z'), stored('e2', 'OUT', '2026-11-03T12:00:00Z')]);
  const result = edit(attendance, { events: [sent('e1', 'IN', '2026-11-03T03:30:00Z'), sent('e2', 'OUT', '2026-11-03T09:30:00Z')] });
  assert.equal(attendance.netWorkingMinutes, 300);
  assert.equal(result.events.modified, 1);
  assert.equal(attendance.events[1].correctionReason, 'Matched the register the employee signed');
  assert.equal(attendance.events[1].correctedBy, 'admin-a');
});

test('every event keeps its stored proof reference, edited or not', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z'), stored('e2', 'OUT', '2026-11-03T09:30:00Z')]);
  edit(attendance, { events: [sent('e1', 'IN', '2026-11-03T03:35:00Z'), sent('e2', 'OUT', '2026-11-03T09:30:00Z')] });
  assert.equal(attendance.events[1].verification.providerReference, 'proof-e2');
  assert.equal(attendance.events[1].correctionReason, undefined);
  assert.equal(attendance.events[0].verification.providerReference, 'proof-e1');
  assert.equal(attendance.events[0].correctionReason, 'Matched the register the employee signed');
});

test('deleting the check-out leaves an open day with no worked minutes', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z'), stored('e2', 'OUT', '2026-11-03T09:30:00Z')]);
  const result = edit(attendance, { events: [sent('e1', 'IN', '2026-11-03T03:30:00Z')] });
  assert.equal(attendance.events.length, 1);
  assert.equal(result.events.removed, 1);
  assert.equal(attendance.netWorkingMinutes, 0);
});

test('a manual event added by an admin is stamped and counted', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z')]);
  const result = edit(attendance, { events: [sent('e1', 'IN', '2026-11-03T03:30:00Z'), sent(undefined, 'OUT', '2026-11-03T10:00:00Z', { method: 'manual', faceMatched: false, livenessPassed: false })] });
  const added = attendance.events.at(-1);
  assert.equal(result.events.added, 1);
  assert.equal(added.method, 'manual');
  assert.equal(added.correctedBy, 'admin-a');
  assert.equal(attendance.netWorkingMinutes, 330);
});

test('a day that no longer alternates in and out is refused', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z'), stored('e2', 'OUT', '2026-11-03T09:30:00Z')]);
  assert.throws(
    () => edit(attendance, { events: [sent('e1', 'IN', '2026-11-03T03:30:00Z'), sent('e2', 'IN', '2026-11-03T09:30:00Z')] }),
    { code: 'INVALID_ATTENDANCE_SEQUENCE' },
  );
});

test('two events cannot be edited onto the same instant', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z'), stored('e2', 'OUT', '2026-11-03T09:30:00Z')]);
  assert.throws(
    () => edit(attendance, { events: [sent('e1', 'IN', '2026-11-03T03:30:00Z'), sent('e2', 'OUT', '2026-11-03T03:30:00Z')] }),
    { code: 'DUPLICATE_ATTENDANCE_EVENT' },
  );
});

test('moving the record to another day carries the clock times with it', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z'), stored('e2', 'OUT', '2026-11-03T09:30:00Z')]);
  const result = edit(attendance, { dateKey: '2026-11-02' });
  assert.equal(attendance.dateKey, '2026-11-02');
  assert.equal(attendance.events[0].occurredAt.toISOString(), '2026-11-02T03:30:00.000Z');
  assert.equal(result.events.modified, 2);
  assert.deepEqual(result.changes.find((change) => change.field === 'dateKey'), { field: 'dateKey', before: '2026-11-03', after: '2026-11-02' });
});

test('an event that lands on a different day than the record is rejected', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z')]);
  assert.throws(() => edit(attendance, { events: [sent('e1', 'IN', '2026-11-04T02:00:00Z')] }), { code: 'ATTENDANCE_DATE_MISMATCH' });
});

test('attendance can never be edited into the future', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z')]);
  assert.throws(() => edit(attendance, { events: [sent('e1', 'IN', '2026-11-03T18:15:00Z')] }), { code: 'ATTENDANCE_IN_FUTURE' });
});

test('an explicit worked-minute figure survives the recalculation and is audited', () => {
  const attendance = record([stored('e1', 'IN', '2026-11-03T03:30:00Z'), stored('e2', 'OUT', '2026-11-03T09:30:00Z')]);
  attendance.netWorkingMinutes = 480;
  const result = edit(attendance, { netWorkingMinutes: 90, status: 'half_day', office: 'office-b', employee: 'employee-b' });
  assert.equal(attendance.netWorkingMinutes, 90);
  assert.equal(attendance.status, 'half_day');
  assert.equal(attendance.office, 'office-b');
  assert.equal(attendance.employee, 'employee-b');
  assert.deepEqual(result.changes.map((change) => change.field).sort(), ['employee', 'netWorkingMinutes', 'office', 'status']);
});
