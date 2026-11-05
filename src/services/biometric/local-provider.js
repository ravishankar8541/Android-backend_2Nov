import crypto from 'node:crypto';
import { BiometricSession } from '../../models/BiometricSession.js';
import { Employee } from '../../models/Employee.js';
import { FaceTemplate } from '../../models/FaceTemplate.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';
import { decryptFaceTemplate, embeddingDistance, encryptFaceTemplate } from './template-crypto.js';
import { deleteEmployeePhoto, uploadAttendanceSelfie, uploadFaceCheck } from '../cloudinary.js';

function requireLocalProvider() {
  if (env.BIOMETRIC_PROVIDER !== 'local') {
    throw new HttpError(503, 'Local face verification is disabled by the server', 'BIOMETRIC_PROVIDER_UNAVAILABLE');
  }
}

function requireEmployeeId(employeeId) {
  if (!employeeId) throw new HttpError(403, 'This account is not linked to an employee profile', 'EMPLOYEE_PROFILE_REQUIRED');
  return employeeId;
}

export async function getMyFaceEnrollment(employeeId) {
  requireEmployeeId(employeeId);
  const [template, employee] = await Promise.all([
    FaceTemplate.findOne({ employee: employeeId }).select('enrolledAt'),
    Employee.findById(employeeId).select('faceEnrollmentStatus attendanceVerification faceCheck'),
  ]);
  const disabled = employee?.faceEnrollmentStatus === 'disabled';
  const verification = employee?.attendanceVerification ?? 'face';
  return {
    enrolled: Boolean(template) && !disabled,
    disabled,
    verification,
    selfieAvailable: Boolean(env.CLOUDINARY_URL),
    providerAvailable: env.BIOMETRIC_PROVIDER === 'local',
    enrolledAt: template && !disabled ? template.enrolledAt : null,
    faceCheck: {
      status: employee?.faceCheckState?.() ?? employee?.faceCheck?.status ?? 'approved',
      photoUrl: employee?.faceCheck?.photoUrl ?? null,
      source: employee?.faceCheck?.source ?? 'none',
      capturedAt: employee?.faceCheck?.capturedAt ?? null,
      reviewReason: employee?.faceCheck?.reviewReason ?? '',
    },
  };
}

export async function saveMyFaceEnrollment(employeeId, embedding, consent) {
  requireLocalProvider();
  requireEmployeeId(employeeId);
  if (consent !== true) throw new HttpError(400, 'Consent is required before face enrollment', 'FACE_CONSENT_REQUIRED');
  const employee = await Employee.findById(employeeId);
  if (!employee || employee.employmentStatus !== 'active') throw new HttpError(403, 'Your employee profile is inactive', 'EMPLOYEE_INACTIVE');
  if (employee.faceEnrollmentStatus === 'disabled') throw new HttpError(403, 'Face attendance is disabled for this employee. Contact HR.', 'FACE_ENROLLMENT_DISABLED');
  const encrypted = encryptFaceTemplate(embedding);
  const revision = crypto.randomUUID();
  const template = await FaceTemplate.findOneAndUpdate(
    { employee: employeeId },
    { $set: { ...encrypted, revision, enrolledAt: new Date(), consentAt: new Date(), consentVersion: 'attendance-face-v1' } },
    { upsert: true, new: true, runValidators: true },
  ).select('enrolledAt');
  await BiometricSession.deleteMany({ employee: employeeId, usedAt: null, templateRevision: { $ne: revision } });
  employee.faceEnrollmentStatus = 'enrolled';
  const reopened = employee.faceCheck?.status === 'rejected' ? { status: 'pending', reviewedBy: null, reviewedAt: null, reviewReason: '' } : {};
  employee.faceCheck = { ...(employee.faceCheck?.toObject?.() ?? {}), source: 'android', capturedAt: template.enrolledAt, ...reopened };
  await employee.save();
  return { enrolled: true, enrolledAt: template.enrolledAt };
}

export async function removeMyFaceEnrollment(employeeId) {
  requireEmployeeId(employeeId);
  const employee = await Employee.findById(employeeId).select('faceEnrollmentStatus');
  if (employee?.faceEnrollmentStatus === 'disabled') throw new HttpError(403, 'Face attendance is disabled by HR. Contact HR to change this setting.', 'FACE_ENROLLMENT_DISABLED');
  await FaceTemplate.deleteOne({ employee: employeeId });
  await BiometricSession.deleteMany({ employee: employeeId, usedAt: null });
  await Employee.updateOne({ _id: employeeId }, { $set: { faceEnrollmentStatus: 'not_enrolled' } });
  return { enrolled: false };
}

/**
 * A new hire's one-time face check: the frame an admin compares with the employee photo before any
 * attendance is allowed. They may retake it while it waits or after a decline, but an approval is
 * final and must go back through HR.
 */
export async function saveFaceCheck({ employeeId, buffer }) {
  requireEmployeeId(employeeId);
  const employee = await Employee.findById(employeeId);
  if (!employee || employee.employmentStatus !== 'active') throw new HttpError(403, 'Your employee profile is inactive', 'EMPLOYEE_INACTIVE');
  if ((employee.faceCheckState?.() ?? employee.faceCheck?.status) === 'approved') throw new HttpError(409, 'Your face is already approved for daily attendance', 'FACE_CHECK_APPROVED');
  const photo = await uploadFaceCheck(buffer);
  const previousPublicId = employee.faceCheck?.photoPublicId ?? null;
  employee.faceCheck = {
    ...(employee.faceCheck?.toObject?.() ?? {}),
    photoUrl: photo.url,
    photoPublicId: photo.publicId,
    source: 'web',
    capturedAt: new Date(),
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    reviewReason: '',
  };
  await employee.save();
  if (previousPublicId && previousPublicId !== photo.publicId) await deleteEmployeePhoto(previousPublicId);
  return { status: 'pending', photoUrl: photo.url, capturedAt: employee.faceCheck.capturedAt };
}

export async function createLocalVerification({ employeeId, eventType, embedding, livenessPassed, livenessScore }) {
  requireLocalProvider();
  requireEmployeeId(employeeId);
  if (eventType !== 'IN' && eventType !== 'OUT') throw new HttpError(400, 'Invalid attendance event type', 'INVALID_EVENT_TYPE');
  const employee = await Employee.findById(employeeId);
  if (!employee || employee.employmentStatus !== 'active') throw new HttpError(403, 'Your employee profile is inactive', 'EMPLOYEE_INACTIVE');
  if (employee.faceEnrollmentStatus === 'disabled') throw new HttpError(403, 'Face attendance is disabled for this employee. Contact HR.', 'FACE_ENROLLMENT_DISABLED');
  const template = await FaceTemplate.findOne({ employee: employeeId }).select('+ciphertext +iv +authTag');
  if (!template) throw new HttpError(409, 'Enroll your face before recording attendance', 'FACE_NOT_ENROLLED');
  if (livenessPassed !== true || !Number.isFinite(livenessScore) || livenessScore < 0 || livenessScore > env.BIOMETRIC_LIVENESS_MAX_SCORE) {
    throw new HttpError(403, 'Liveness check did not pass. Hold the camera steady and try again.', 'LIVENESS_CHECK_FAILED');
  }

  const distance = embeddingDistance(embedding, decryptFaceTemplate(template));
  if (!Number.isFinite(distance) || distance > env.BIOMETRIC_FACE_DISTANCE_THRESHOLD) {
    throw new HttpError(403, 'The face does not match this employee profile', 'FACE_MATCH_FAILED');
  }

  const session = await BiometricSession.create({
    _id: crypto.randomUUID(),
    employee: employeeId,
    eventType,
    templateRevision: template.revision ?? null,
    faceDistance: distance,
    livenessScore,
    expiresAt: new Date(Date.now() + 2 * 60 * 1000),
  });
  return { verificationSessionId: session.id, expiresAt: session.expiresAt };
}

/**
 * iPhone, iPad and browsers cannot load the Android face model, so they capture a selfie instead.
 * Any active profile may use this path regardless of its attendanceVerification setting; the same
 * single-use session record backs both, which keeps replay protection identical, and the photo
 * itself is the evidence an admin reviews.
 */
export async function createSelfieVerification({ employeeId, eventType, buffer }) {
  requireEmployeeId(employeeId);
  if (eventType !== 'IN' && eventType !== 'OUT') throw new HttpError(400, 'Invalid attendance event type', 'INVALID_EVENT_TYPE');
  const employee = await Employee.findById(employeeId);
  if (!employee || employee.employmentStatus !== 'active') throw new HttpError(403, 'Your employee profile is inactive', 'EMPLOYEE_INACTIVE');
  const photo = await uploadAttendanceSelfie(buffer);
  const session = await BiometricSession.create({
    _id: crypto.randomUUID(),
    employee: employeeId,
    eventType,
    method: 'selfie',
    photoUrl: photo.url,
    photoPublicId: photo.publicId,
    expiresAt: new Date(Date.now() + 2 * 60 * 1000),
  });
  return { verificationSessionId: session.id, expiresAt: session.expiresAt, photoUrl: photo.url };
}

export async function isSelfieSession(sessionId) {
  if (!sessionId) return false;
  const session = await BiometricSession.findOne({ _id: sessionId });
  return session?.method === 'selfie';
}

export async function verifySelfieSession({ sessionId, employeeId, eventType }) {
  if (!sessionId || !employeeId) throw new HttpError(400, 'A verified attendance session is required', 'FACE_SESSION_REQUIRED');
  const session = await BiometricSession.findOne({
    _id: sessionId,
    employee: employeeId,
    eventType,
    method: 'selfie',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!session) throw new HttpError(403, 'Verification expired or was already used. Try again.', 'FACE_SESSION_INVALID');
  if (!session.photoUrl) throw new HttpError(403, 'The photo was not stored. Capture it again.', 'FACE_SESSION_INVALID');
  return { session, selfie: true, photoUrl: session.photoUrl, photoPublicId: session.photoPublicId, reference: `selfie:${session.id}` };
}

export async function verifyAttendanceSession({ sessionId, employeeId, eventType }) {
  requireLocalProvider();
  if (!sessionId || !employeeId) throw new HttpError(400, 'A verified face session is required', 'FACE_SESSION_REQUIRED');
  const session = await BiometricSession.findOne({
    _id: sessionId,
    employee: employeeId,
    eventType,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!session) throw new HttpError(403, 'Face verification expired or was already used. Verify again.', 'FACE_SESSION_INVALID');
  if (!await FaceTemplate.exists({ employee: employeeId, revision: session.templateRevision ?? null })) {
    throw new HttpError(403, 'Face enrollment changed. Verify again.', 'FACE_SESSION_INVALID');
  }
  return {
    session,
    selfie: false,
    faceMatched: Number.isFinite(session.faceDistance) && session.faceDistance >= 0 && session.faceDistance <= env.BIOMETRIC_FACE_DISTANCE_THRESHOLD,
    livenessPassed: Number.isFinite(session.livenessScore) && session.livenessScore >= 0 && session.livenessScore <= env.BIOMETRIC_LIVENESS_MAX_SCORE,
    reference: `local:${session.id}`,
  };
}

export async function consumeAttendanceSession(session) {
  const claimedAt = new Date();
  const result = await BiometricSession.updateOne(
    { _id: session.id, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: claimedAt } },
  );
  if (result.modifiedCount !== 1) throw new HttpError(409, 'Verification was already used. Try again.', 'FACE_SESSION_ALREADY_USED');
  return claimedAt;
}

export async function releaseAttendanceSession(session, claimedAt) {
  await BiometricSession.updateOne({ _id: session.id, usedAt: claimedAt }, { $set: { usedAt: null } });
}
