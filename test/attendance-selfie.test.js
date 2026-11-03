import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-selfie-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
  CLOUDINARY_URL: 'cloudinary://123456789012345:abcdefghijklmnopqrstuvwxz@test-cloud',
});
const cloudinaryPackage = (await import('cloudinary')).default;
const { Employee } = await import('../src/models/Employee.js');
const { Attendance } = await import('../src/models/Attendance.js');
const { BiometricSession } = await import('../src/models/BiometricSession.js');
const { createSelfieVerification, verifySelfieSession } = await import('../src/services/biometric/local-provider.js');
const { markAttendance } = await import('../src/services/attendance-service.js');
afterEach(() => mock.restoreAll());

const selfieSession = {
  id: 'proof-selfie', method: 'selfie', employee: 'employee-a', eventType: 'IN',
  photoUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/vam/attendance/abc.jpg',
  photoPublicId: 'vam/attendance/abc',
};

function stubUpload() {
  mock.method(cloudinaryPackage.v2.uploader, 'upload_stream', (options, done) => {
    done(null, { secure_url: selfieSession.photoUrl, public_id: selfieSession.photoPublicId });
    return { on() {}, end() {} };
  });
}

function employee(overrides) {
  const doc = {
    id: 'employee-a', employmentStatus: 'active', faceEnrollmentStatus: 'enrolled', attendanceVerification: 'face',
    office: { id: 'office-a', active: true, latitude: 0, longitude: 0, radiusMeters: 25 },
    shift: { active: true, startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, weeklyOffDays: [] },
    ...overrides,
  };
  const query = { populate() { return this; }, then(resolve) { return Promise.resolve(doc).then(resolve); } };
  mock.method(Employee, 'findById', () => query);
  return doc;
}

test('a selfie session is only opened for a profile HR switched to photo check-in', async () => {
  employee({ attendanceVerification: 'face' });
  await assert.rejects(createSelfieVerification({ employeeId: 'employee-a', eventType: 'IN', buffer: Buffer.from('x') }), { code: 'ATTENDANCE_VERIFICATION_MISMATCH' });
  employee({ employmentStatus: 'inactive', attendanceVerification: 'selfie' });
  await assert.rejects(createSelfieVerification({ employeeId: 'employee-a', eventType: 'IN', buffer: Buffer.from('x') }), { code: 'EMPLOYEE_INACTIVE' });
  await assert.rejects(createSelfieVerification({ employeeId: 'employee-a', eventType: 'MID' }), { code: 'INVALID_EVENT_TYPE' });
});

test('the selfie is stored as attendance evidence and opens the same single-use session as a face match', async () => {
  stubUpload();
  employee({ attendanceVerification: 'selfie' });
  const created = [];
  mock.method(BiometricSession, 'create', async (doc) => { created.push(doc); return { id: 'proof-selfie', expiresAt: doc.expiresAt }; });
  const data = await createSelfieVerification({ employeeId: 'employee-a', eventType: 'IN', buffer: Buffer.from('jpeg-bytes') });
  assert.equal(data.verificationSessionId, 'proof-selfie');
  assert.equal(data.photoUrl, selfieSession.photoUrl);
  assert.equal(created[0].method, 'selfie');
  assert.equal(created[0].photoPublicId, selfieSession.photoPublicId);
  assert(created[0].expiresAt instanceof Date);
});

test('a selfie session verifies on its own evidence and never claims a face match', async () => {
  mock.method(BiometricSession, 'findOne', async () => selfieSession);
  const verified = await verifySelfieSession({ sessionId: 'proof-selfie', employeeId: 'employee-a', eventType: 'IN' });
  assert.equal(verified.selfie, true);
  assert.equal(verified.photoUrl, selfieSession.photoUrl);
  assert.equal(verified.reference, 'selfie:proof-selfie');
  assert.equal(verified.faceMatched, undefined);

  mock.method(BiometricSession, 'findOne', async () => ({ ...selfieSession, photoUrl: null }));
  await assert.rejects(verifySelfieSession({ sessionId: 'proof-selfie', employeeId: 'employee-a', eventType: 'IN' }), { code: 'FACE_SESSION_INVALID' });

  mock.method(BiometricSession, 'findOne', async () => null);
  await assert.rejects(verifySelfieSession({ sessionId: 'proof-selfie', employeeId: 'employee-a', eventType: 'IN' }), { code: 'FACE_SESSION_INVALID' });
});

test('a selfie check-in records the photo as the verification method instead of a face match', async () => {
  employee({ attendanceVerification: 'selfie' });
  mock.method(BiometricSession, 'findOne', async () => selfieSession);
  mock.method(BiometricSession, 'updateOne', async () => ({ modifiedCount: 1 }));
  const attendance = { events: [], dateKey: '2026-11-02', status: 'present', validate: async () => {}, save: async () => {} };
  mock.method(Attendance, 'findOne', async (filter) => (filter.events ? null : attendance));
  await markAttendance({
    auth: { employeeId: 'employee-a' },
    type: 'IN',
    body: { verificationSessionId: 'proof-selfie', latitude: 0, longitude: 0, accuracyMeters: 5 },
  });
  const [event] = attendance.events;
  assert.equal(event.method, 'selfie_photo');
  assert.equal(event.verification.faceMatched, false);
  assert.equal(event.verification.livenessPassed, false);
  assert.equal(event.verification.photoUrl, selfieSession.photoUrl);
});

test('a stored selfie reaches the client without its Cloudinary public id', () => {
  const record = new Attendance({
    employee: 'employee-a',
    office: 'office-a',
    dateKey: '2026-11-02',
    events: [{
      type: 'IN',
      occurredAt: new Date(),
      method: 'selfie_photo',
      verification: { faceMatched: false, livenessPassed: false, providerReference: 'selfie:proof-selfie', photoUrl: selfieSession.photoUrl, photoPublicId: selfieSession.photoPublicId },
      location: { latitude: 0, longitude: 0, accuracyMeters: 5, distanceMeters: 3 },
    }],
  });
  const json = record.toJSON();
  assert.equal(json.events[0].verification.photoUrl, selfieSession.photoUrl);
  assert.equal(json.events[0].verification.photoPublicId, undefined);
  assert.equal(json.events[0].verification.providerReference, undefined);
});
