import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-attendance-edit-api-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { Attendance } = await import('../src/models/Attendance.js');
const { Employee } = await import('../src/models/Employee.js');
const { Office } = await import('../src/models/Office.js');
const { AuditLog } = await import('../src/models/AuditLog.js');
const { editAttendance } = await import('../src/controllers/attendance-controller.js');
afterEach(() => mock.restoreAll());

// Times stay on a day in the past so the controller's real-clock future guard never fires.
function setup({ save } = {}) {
  const attendance = {
    _id: 'aaaa7eac095d000000000001', id: 'aaaa7eac095d000000000001', employee: 'employee-a', office: 'office-a',
    dateKey: '2026-11-02', status: 'present', netWorkingMinutes: 480,
    events: [
      { _id: 'bbbb7eac095d000000000001', type: 'IN', occurredAt: new Date('2026-11-02T03:30:00Z'), method: 'face_liveness', verification: { faceMatched: true, livenessPassed: true, providerReference: 'proof-1' }, location: { latitude: 28.6, longitude: 77.2, accuracyMeters: 8, distanceMeters: 12 } },
      { _id: 'cccc7eac095d000000000001', type: 'OUT', occurredAt: new Date('2026-11-02T06:30:00Z'), method: 'face_liveness', verification: { faceMatched: true, livenessPassed: true, providerReference: 'proof-2' }, location: { latitude: 28.6, longitude: 77.2, accuracyMeters: 8, distanceMeters: 12 } },
    ],
    save,
  };
  mock.method(Attendance, 'findById', async () => attendance);
  const employee = { _id: 'employee-a', shift: { breakMinutes: 60 } };
  mock.method(Employee, 'findById', () => ({ populate: async () => employee }));
  mock.method(Office, 'exists', async () => true);
  const audits = [];
  mock.method(AuditLog, 'create', async (entry) => { audits.push(entry); return entry; });
  const responses = [];
  const res = { json: (body) => responses.push(body) };
  const req = {
    auth: { userId: 'admin-a', role: 'hr_admin' }, ip: '127.0.0.1',
    validatedParams: { id: attendance._id },
    body: { dateKey: '2026-11-02', status: 'late', reason: 'The signed register shows a 09:05 check-in' },
  };
  return { attendance, audits, responses, req, res };
}

const sent = (event, occurredAt) => ({
  _id: event._id, type: event.type, occurredAt, method: event.method,
  faceMatched: true, livenessPassed: true, latitude: 28.6, longitude: 77.2, accuracyMeters: 8, distanceMeters: 12,
});

test('an admin edit saves the record, audits the diff and returns the updated day', async () => {
  const saved = [];
  const context = setup({ save: async () => { saved.push(1); } });
  context.req.body.events = [sent(context.attendance.events[0], new Date('2026-11-02T03:35:00Z')), sent(context.attendance.events[1], new Date('2026-11-02T06:30:00Z'))];
  await editAttendance(context.req, context.res);
  assert.equal(saved.length, 1);
  assert.equal(context.attendance.events[0].correctedBy, 'admin-a');
  assert.equal(context.attendance.events[0].verification.providerReference, 'proof-1');
  assert.equal(context.attendance.events[1].correctedBy, undefined);
  assert.equal(context.responses[0].data.attendance.status, 'late');
  const audit = context.audits[0];
  assert.equal(audit.action, 'attendance.edited');
  assert.deepEqual(audit.metadata.events, { added: 0, removed: 0, modified: 1 });
  assert.deepEqual(audit.metadata.changes.map((change) => change.field).sort(), ['netWorkingMinutes', 'status']);
});

test('a write clash on save becomes a conflict instead of a server error', async () => {
  const duplicate = setup({ save: async () => { throw Object.assign(new Error('duplicate key'), { code: 11000 }); } });
  await assert.rejects(editAttendance(duplicate.req, duplicate.res), { status: 409, code: 'ATTENDANCE_DUPLICATE' });
  assert.equal(duplicate.audits.length, 0);

  const stale = setup({ save: async () => { throw Object.assign(new Error('Version failed'), { name: 'VersionError' }); } });
  await assert.rejects(editAttendance(stale.req, stale.res), { status: 409, code: 'ATTENDANCE_CONFLICT' });
  assert.equal(stale.audits.length, 0);
});

test('unknown records, employees and offices are refused before anything is written', async () => {
  const missing = setup();
  mock.method(Attendance, 'findById', async () => null);
  await assert.rejects(editAttendance(missing.req, missing.res), { status: 404, code: 'ATTENDANCE_NOT_FOUND' });

  const badEmployee = setup();
  mock.method(Employee, 'findById', () => ({ populate: async () => null }));
  await assert.rejects(editAttendance(badEmployee.req, badEmployee.res), { status: 422, code: 'EMPLOYEE_NOT_FOUND' });

  const badOffice = setup();
  mock.method(Office, 'exists', async () => null);
  badOffice.req.body.office = 'office-z';
  await assert.rejects(editAttendance(badOffice.req, badOffice.res), { status: 422, code: 'OFFICE_NOT_FOUND' });
  assert.equal(badOffice.audits.length, 0);
});
