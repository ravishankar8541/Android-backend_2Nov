import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-face-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'disabled',
});
const { BiometricSession } = await import('../src/models/BiometricSession.js');
const { saveMyFaceEnrollment, createLocalVerification, verifyAttendanceSession } = await import('../src/services/biometric/local-provider.js');
const provider = await import('../src/services/biometric/provider.js');
afterEach(() => mock.restoreAll());

test('disabled provider blocks enrollment and both verification steps before database access', async () => {
  await assert.rejects(saveMyFaceEnrollment('employee', [], true), { code: 'BIOMETRIC_PROVIDER_UNAVAILABLE' });
  await assert.rejects(createLocalVerification({ employeeId: 'employee' }), { code: 'BIOMETRIC_PROVIDER_UNAVAILABLE' });
  await assert.rejects(verifyAttendanceSession({ employeeId: 'employee' }), { code: 'BIOMETRIC_PROVIDER_UNAVAILABLE' });
});

test('a selfie session still verifies while face verification is disabled', async () => {
  mock.method(BiometricSession, 'findOne', async () => ({ id: 'proof-selfie', method: 'selfie', eventType: 'IN', photoUrl: 'https://res.cloudinary.com/cloud/image/upload/v1/vam/attendance/abc.jpg' }));
  const verified = await provider.verifyAttendanceSession({ sessionId: 'proof-selfie', employeeId: 'employee-a', eventType: 'IN' });
  assert.equal(verified.selfie, true);
  assert.equal(verified.reference, 'selfie:proof-selfie');
});
