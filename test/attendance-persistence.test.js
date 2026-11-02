import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-attendance-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { Employee } = await import('../src/models/Employee.js');
const { Attendance } = await import('../src/models/Attendance.js');
const { FaceTemplate } = await import('../src/models/FaceTemplate.js');
const { BiometricSession } = await import('../src/models/BiometricSession.js');
const { markAttendance } = await import('../src/services/attendance-service.js');
afterEach(() => mock.restoreAll());

function setup(save) {
  const employee = { id: 'employee-a', employmentStatus: 'active', faceEnrollmentStatus: 'enrolled',
    office: { id: 'office-a', active: true, latitude: 0, longitude: 0, radiusMeters: 25 },
    shift: { active: true, startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, weeklyOffDays: [] } };
  const employeeQuery = { populate() { return this; }, then(resolve) { return Promise.resolve(employee).then(resolve); } };
  mock.method(Employee, 'findById', () => employeeQuery);
  const session = { id: 'proof-a', templateRevision: 'rev', faceDistance: 0, livenessScore: 0.1 };
  mock.method(BiometricSession, 'findOne', async () => session);
  mock.method(FaceTemplate, 'exists', async () => true);
  const claims = [];
  mock.method(BiometricSession, 'updateOne', async (filter, update) => { claims.push({ filter, update }); return { modifiedCount: 1 }; });
  const attendance = { events: [], dateKey: '2026-11-02', status: 'present', validate: async () => {}, save };
  mock.method(Attendance, 'findOne', async (filter) => filter.events ? null : attendance);
  return { attendance, claims };
}
const input = { auth: { employeeId: 'employee-a' }, type: 'IN', body: { verificationSessionId: 'proof-a', latitude: 0, longitude: 0, accuracyMeters: 5 } };

test('attendance uses optimistic concurrency and releases a proof after a definite write conflict', async () => {
  assert.equal(Attendance.schema.options.optimisticConcurrency, true);
  const { claims } = setup(async () => { const error = new Error('conflict'); error.name = 'VersionError'; throw error; });
  await assert.rejects(markAttendance(input), { code: 'ATTENDANCE_CONFLICT' });
  assert.equal(claims.length, 2);
  assert(claims[0].update.$set.usedAt instanceof Date);
  assert.equal(claims[1].update.$set.usedAt, null);
  assert.equal(claims[1].filter.usedAt, claims[0].update.$set.usedAt);
});

test('uncertain persistence errors never release a possibly committed biometric proof', async () => {
  const { claims } = setup(async () => { throw new Error('network write result unknown'); });
  await assert.rejects(markAttendance(input), /network write result unknown/);
  assert.equal(claims.length, 1);
});

test('a retry after a lost response returns the existing attendance without consuming again', async () => {
  const { attendance, claims } = setup(async () => {});
  mock.method(Attendance, 'findOne', async () => attendance);
  assert.equal(await markAttendance(input), attendance);
  assert.equal(claims.length, 0);
});

test('an invalid event sequence fails before consuming a biometric proof', async () => {
  const { attendance, claims } = setup(async () => {});
  attendance.events.push({ type: 'IN', occurredAt: new Date() });
  await assert.rejects(markAttendance(input), { code: 'INVALID_ATTENDANCE_SEQUENCE' });
  assert.equal(claims.length, 0);
});
