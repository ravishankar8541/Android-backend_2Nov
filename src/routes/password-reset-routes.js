import { Router } from 'express';
import { z } from 'zod';
import { listPasswordResets, reviewPasswordReset } from '../controllers/password-reset-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const listSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
}).passthrough();
const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  temporaryPassword: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(5).max(200).optional()),
  reason: z.preprocess((value) => (value === '' ? undefined : value), z.string().trim().min(3).max(300).optional()),
}).refine((body) => body.status !== 'rejected' || Boolean(body.reason), { message: 'Please provide a reason for declining', path: ['reason'] });

router.use(requireAuth);
router.get('/', allowRoles(...ADMIN_ROLES), validate(listSchema, 'query'), asyncHandler(listPasswordResets));
router.patch('/:id/review', allowRoles(...ADMIN_ROLES), validate(reviewSchema), asyncHandler(reviewPasswordReset));

export default router;
