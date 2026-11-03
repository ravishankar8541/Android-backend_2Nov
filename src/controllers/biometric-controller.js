import { createLocalVerification, getMyFaceEnrollment, removeMyFaceEnrollment, saveMyFaceEnrollment } from '../services/biometric/local-provider.js';
import { createSelfieVerification } from '../services/biometric/provider.js';
import { HttpError } from '../utils/http-error.js';

export async function getEnrollment(req, res) {
  const data = await getMyFaceEnrollment(req.auth.employeeId);
  res.json({ success: true, message: 'Face enrollment status', data });
}

export async function enrollFace(req, res) {
  const data = await saveMyFaceEnrollment(req.auth.employeeId, req.body.embedding, req.body.consent);
  res.status(201).json({ success: true, message: 'Face enrollment saved', data });
}

export async function deleteEnrollment(req, res) {
  const data = await removeMyFaceEnrollment(req.auth.employeeId);
  res.json({ success: true, message: 'Face enrollment removed', data });
}

export async function verifyFace(req, res) {
  const data = await createLocalVerification({ employeeId: req.auth.employeeId, ...req.body });
  res.status(201).json({
    success: true,
    message: 'Face match and liveness check passed',
    data,
  });
}

export async function verifySelfie(req, res) {
  if (!req.file?.buffer) throw new HttpError(400, 'Attach the captured photo to the request', 'SELFIE_REQUIRED');
  const data = await createSelfieVerification({ employeeId: req.auth.employeeId, eventType: req.body.eventType, buffer: req.file.buffer });
  res.status(201).json({ success: true, message: 'Photo captured for attendance', data });
}
