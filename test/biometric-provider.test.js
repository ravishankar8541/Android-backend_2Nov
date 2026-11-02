import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-face-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth',
  BIOMETRIC_PROVIDER: 'local', BIOMETRIC_ENCRYPTION_KEY: '1'.repeat(64),
  BIOMETRIC_FACE_DISTANCE_THRESHOLD: '1.1', BIOMETRIC_LIVENESS_MAX_SCORE: '0.2',
});
const { Employee } = await import('../src/models/Employee.js');
const { FaceTemplate } = await import('../src/models/FaceTemplate.js');
const { BiometricSession } = await import('../src/models/BiometricSession.js');
const { encryptFaceTemplate, decryptFaceTemplate, embeddingDistance } = await import('../src/services/biometric/template-crypto.js');
const { saveMyFaceEnrollment, createLocalVerification, verifyAttendanceSession, consumeAttendanceSession } = await import('../src/services/biometric/local-provider.js');
const vector = Array(192).fill(0); vector[0] = 1;
const other = Array(192).fill(0); other[1] = 1;
const employee = { id: 'employee-a', employmentStatus: 'active', faceEnrollmentStatus: 'enrolled', save: async () => {} };
const query = (value) => ({ select: async () => value });
afterEach(() => mock.restoreAll());

test('encrypted face templates round-trip and reject tampering or invalid vectors', () => {
  const encrypted = encryptFaceTemplate(vector);
  assert.deepEqual(decryptFaceTemplate(encrypted), vector);
  assert.notEqual(encrypted.ciphertext, JSON.stringify(vector));
  const damaged = { ...encrypted, authTag: Buffer.alloc(16).toString('base64') };
  assert.throws(() => decryptFaceTemplate(damaged));
  assert.throws(() => encryptFaceTemplate(Array(192).fill(0)));
  assert.equal(embeddingDistance(vector, vector), 0);
  assert(embeddingDistance(vector, other) > 1.1);
  assert.equal(embeddingDistance(vector, Array(192).fill(NaN)), Infinity);
});

test('re-enrollment rotates the template revision and revokes older unused proofs', async () => {
  mock.method(Employee, 'findById', async () => ({ ...employee }));
  let update; let revoked;
  mock.method(FaceTemplate, 'findOneAndUpdate', (_query, change) => { update = change.$set; return query({ enrolledAt: change.$set.enrolledAt }); });
  mock.method(BiometricSession, 'deleteMany', async (filter) => { revoked = filter; });
  await saveMyFaceEnrollment(employee.id, vector, true);
  assert.equal(typeof update.revision, 'string');
  assert.deepEqual(revoked, { employee: employee.id, usedAt: null, templateRevision: { $ne: update.revision } });
});

function setupMatch() {
  mock.method(Employee, 'findById', async () => ({ ...employee }));
  mock.method(FaceTemplate, 'findOne', () => query({ ...encryptFaceTemplate(vector), revision: 'revision-a' }));
  const created = [];
  mock.method(BiometricSession, 'create', async (value) => { created.push(value); return { ...value, id: value._id }; });
  return created;
}

test('matching creates a short-lived proof bound to employee, action and template revision', async () => {
  const created = setupMatch();
  const result = await createLocalVerification({ employeeId: employee.id, eventType: 'IN', embedding: vector, livenessPassed: true, livenessScore: 0.1 });
  assert.equal(created.length, 1);
  assert.equal(created[0].employee, employee.id);
  assert.equal(created[0].eventType, 'IN');
  assert.equal(created[0].templateRevision, 'revision-a');
  assert(result.expiresAt.getTime() > Date.now());
  assert(result.expiresAt.getTime() <= Date.now() + 120_000);
});

test('wrong faces and malformed liveness never create verification sessions', async () => {
  const created = setupMatch();
  const base = { employeeId: employee.id, eventType: 'IN', embedding: vector, livenessPassed: true, livenessScore: 0.1 };
  await assert.rejects(createLocalVerification({ ...base, embedding: other }), { code: 'FACE_MATCH_FAILED' });
  for (const livenessScore of [-1, NaN, Infinity, undefined, 0.21]) {
    await assert.rejects(createLocalVerification({ ...base, livenessScore }), { code: 'LIVENESS_CHECK_FAILED' });
  }
  await assert.rejects(createLocalVerification({ ...base, livenessPassed: false }), { code: 'LIVENESS_CHECK_FAILED' });
  assert.equal(created.length, 0);
});

test('proof validation rejects another employee, wrong action, expiry, reuse and replaced enrollment', async () => {
  const session = { id: 'proof-a', employee: employee.id, eventType: 'IN', usedAt: null, expiresAt: new Date(Date.now() + 60_000), templateRevision: 'revision-a', faceDistance: 0, livenessScore: 0.1 };
  mock.method(BiometricSession, 'findOne', async (filter) => filter.employee === session.employee && filter.eventType === session.eventType
    && session.usedAt === null && session.expiresAt > filter.expiresAt.$gt ? session : null);
  let currentRevision = 'revision-a';
  mock.method(FaceTemplate, 'exists', async (filter) => filter.revision === currentRevision);
  const input = { sessionId: session.id, employeeId: employee.id, eventType: 'IN' };
  assert.equal((await verifyAttendanceSession(input)).faceMatched, true);
  await assert.rejects(verifyAttendanceSession({ ...input, employeeId: 'employee-b' }), { code: 'FACE_SESSION_INVALID' });
  await assert.rejects(verifyAttendanceSession({ ...input, eventType: 'OUT' }), { code: 'FACE_SESSION_INVALID' });
  currentRevision = 'revision-b';
  await assert.rejects(verifyAttendanceSession(input), { code: 'FACE_SESSION_INVALID' });
  currentRevision = 'revision-a'; session.usedAt = new Date();
  await assert.rejects(verifyAttendanceSession(input), { code: 'FACE_SESSION_INVALID' });
  session.usedAt = null; session.expiresAt = new Date(0);
  await assert.rejects(verifyAttendanceSession(input), { code: 'FACE_SESSION_INVALID' });
});

test('a verification proof can be claimed only once', async () => {
  let claimed = false;
  mock.method(BiometricSession, 'updateOne', async () => { if (claimed) return { modifiedCount: 0 }; claimed = true; return { modifiedCount: 1 }; });
  const results = await Promise.allSettled([consumeAttendanceSession({ id: 'proof' }), consumeAttendanceSession({ id: 'proof' })]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
});
