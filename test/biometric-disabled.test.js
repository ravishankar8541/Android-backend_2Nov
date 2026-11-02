import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-face-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'disabled',
});
const { saveMyFaceEnrollment, createLocalVerification, verifyAttendanceSession } = await import('../src/services/biometric/local-provider.js');

test('disabled provider blocks enrollment and both verification steps before database access', async () => {
  await assert.rejects(saveMyFaceEnrollment('employee', [], true), { code: 'BIOMETRIC_PROVIDER_UNAVAILABLE' });
  await assert.rejects(createLocalVerification({ employeeId: 'employee' }), { code: 'BIOMETRIC_PROVIDER_UNAVAILABLE' });
  await assert.rejects(verifyAttendanceSession({ employeeId: 'employee' }), { code: 'BIOMETRIC_PROVIDER_UNAVAILABLE' });
});
