import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-face-check-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
  CLOUDINARY_URL: 'cloudinary://123456789012345:abcdefghijklmnopqrstuvwxz@test-cloud',
});
const cloudinaryPackage = (await import('cloudinary')).default;
const { Employee } = await import('../src/models/Employee.js');
const { FaceTemplate } = await import('../src/models/FaceTemplate.js');
const { BiometricSession } = await import('../src/models/BiometricSession.js');
const { getMyFaceEnrollment, saveFaceCheck, saveMyFaceEnrollment } = await import('../src/services/biometric/local-provider.js');
const { markAttendance } = await import('../src/services/attendance-service.js');
afterEach(() => mock.restoreAll());

const vector = Array(192).fill(0);
vector[0] = 1;
const faceCheckPhotoUrl = 'https://res.cloudinary.com/test-cloud/image/upload/v1/vam/face-checks/new.jpg';

// Mongoose always hydrates the faceCheck subdocument, so the stand-in carries toObject like a real one.
function faceCheck(values) {
  const doc = { status: 'approved', photoUrl: null, photoPublicId: null, source: 'none', capturedAt: null, reviewReason: '', ...values };
  return { ...doc, toObject: () => ({ ...doc }) };
}

function employee(overrides = {}) {
  const doc = {
    id: 'employee-a',
    employeeId: 'VAM-001',
    employmentStatus: 'active',
    faceEnrollmentStatus: 'not_enrolled',
    attendanceVerification: 'face',
    faceCheck: faceCheck({}),
    faceCheckState() { return Employee.prototype.faceCheckState.call(this); },
    office: { id: 'office-a', active: true, latitude: 0, longitude: 0, radiusMeters: 25 },
    shift: { active: true, startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, weeklyOffDays: [] },
    save: async () => {},
    ...overrides,
  };
  const query = { populate() { return this; }, select() { return this; }, then(resolve) { return Promise.resolve(doc).then(resolve); } };
  mock.method(Employee, 'findById', () => query);
  return doc;
}

function stubFaceCheckUpload() {
  mock.method(cloudinaryPackage.v2.uploader, 'upload_stream', (_options, done) => {
    done(null, { secure_url: faceCheckPhotoUrl, public_id: 'vam/face-checks/new' });
    return { on() {}, end() {} };
  });
}

const checkIn = () => markAttendance({ auth: { employeeId: 'employee-a' }, type: 'IN', body: { verificationSessionId: 'proof', latitude: 0, longitude: 0, accuracyMeters: 5 } });

test('attendance waits for the admin tick and a declined check never unlocks', async () => {
  employee({ faceCheck: faceCheck({ status: 'pending' }) });
  await assert.rejects(checkIn(), { code: 'FACE_CHECK_PENDING' });
  employee({ faceCheck: faceCheck({ status: 'rejected', reviewReason: 'Face was not visible' }) });
  await assert.rejects(checkIn(), { code: 'FACE_CHECK_REJECTED' });
});

test('a ticked face check leaves the remaining attendance rules untouched', async () => {
  employee({ faceCheck: faceCheck({ status: 'approved', source: 'web', photoUrl: faceCheckPhotoUrl }), office: null });
  await assert.rejects(checkIn(), { code: 'OFFICE_NOT_ASSIGNED' });
});

test('the web face check stores the frame and keeps the profile waiting', async () => {
  stubFaceCheckUpload();
  const doc = employee({ faceCheck: faceCheck({ status: 'pending' }) });
  const data = await saveFaceCheck({ employeeId: 'employee-a', buffer: Buffer.from('jpeg-bytes') });
  assert.equal(data.status, 'pending');
  assert.equal(doc.faceCheck.status, 'pending');
  assert.equal(doc.faceCheck.source, 'web');
  assert.equal(doc.faceCheck.photoUrl, faceCheckPhotoUrl);
  assert(doc.faceCheck.capturedAt instanceof Date);
});

test('an approved face is not captured over, while a declined one may be retaken', async () => {
  stubFaceCheckUpload();
  employee({ faceCheck: faceCheck({ status: 'approved', source: 'web', photoUrl: faceCheckPhotoUrl }) });
  await assert.rejects(saveFaceCheck({ employeeId: 'employee-a', buffer: Buffer.from('x') }), { code: 'FACE_CHECK_APPROVED' });
  const doc = employee({ faceCheck: faceCheck({ status: 'rejected', reviewReason: 'Face was not visible' }) });
  await saveFaceCheck({ employeeId: 'employee-a', buffer: Buffer.from('x') });
  assert.equal(doc.faceCheck.status, 'pending');
  assert.equal(doc.faceCheck.reviewReason, '');
});

test('a profile with no face evidence waits for one even when the stored default says approved', async () => {
  employee({ faceCheck: faceCheck({ status: 'approved' }) });
  await assert.rejects(checkIn(), { code: 'FACE_CHECK_PENDING' });
});

test('an Android template enrolled before the face check field keeps attendance open', async () => {
  employee({ faceEnrollmentStatus: 'enrolled', office: null });
  await assert.rejects(checkIn(), { code: 'OFFICE_NOT_ASSIGNED' });
});

test('an evidence-less profile may submit its first face photo', async () => {
  stubFaceCheckUpload();
  const doc = employee({ faceCheck: faceCheck({ status: 'approved' }) });
  const data = await saveFaceCheck({ employeeId: 'employee-a', buffer: Buffer.from('jpeg-bytes') });
  assert.equal(data.status, 'pending');
  assert.equal(doc.faceCheck.source, 'web');
});

test('enrolling in the Android app records the channel without unlocking attendance', async () => {
  const doc = employee({ faceCheck: faceCheck({ status: 'pending' }) });
  mock.method(FaceTemplate, 'findOneAndUpdate', (_query, change) => ({ select: () => ({ enrolledAt: change.$set.enrolledAt }) }));
  mock.method(BiometricSession, 'deleteMany', async () => {});
  await saveMyFaceEnrollment('employee-a', vector, true);
  assert.equal(doc.faceEnrollmentStatus, 'enrolled');
  assert.equal(doc.faceCheck.source, 'android');
  assert.equal(doc.faceCheck.status, 'pending');
});

test('the enrollment summary carries the approval state but never the storage id', async () => {
  employee({ faceCheck: faceCheck({ status: 'pending', photoUrl: faceCheckPhotoUrl, photoPublicId: 'vam/face-checks/new', source: 'web', capturedAt: new Date() }) });
  mock.method(FaceTemplate, 'findOne', () => ({ select: async () => null }));
  const data = await getMyFaceEnrollment('employee-a');
  assert.equal(data.faceCheck.status, 'pending');
  assert.equal(data.faceCheck.photoUrl, faceCheckPhotoUrl);
  assert.equal(data.faceCheck.photoPublicId, undefined);
  assert.equal(data.faceCheck.reviewedBy, undefined);
});
