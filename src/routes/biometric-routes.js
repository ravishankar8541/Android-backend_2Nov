import { Router } from 'express';
import { z } from 'zod';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { deleteEnrollment, enrollFace, getEnrollment, verifyFace } from '../controllers/biometric-controller.js';

const router = Router();
const embeddingSchema = z.array(z.number().finite().min(-1.1).max(1.1)).length(192).refine((embedding) => {
  const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  return norm >= 0.85 && norm <= 1.15;
}, 'Face embedding is invalid');
const enrollSchema = z.object({ embedding: embeddingSchema, consent: z.literal(true) });
const verifySchema = z.object({
  eventType: z.enum(['IN', 'OUT']),
  embedding: embeddingSchema,
  livenessPassed: z.literal(true),
  livenessScore: z.number().finite().min(0).max(1),
});

router.use(requireAuth, allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER));
router.get('/me', asyncHandler(getEnrollment));
router.post('/enroll', validate(enrollSchema), asyncHandler(enrollFace));
router.delete('/me', asyncHandler(deleteEnrollment));
router.post('/verify', validate(verifySchema), asyncHandler(verifyFace));

export default router;
