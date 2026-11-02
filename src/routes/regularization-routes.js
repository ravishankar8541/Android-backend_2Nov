import { Router } from 'express';
import { z } from 'zod';
import { createRegularization, createRegularizationSchema, listMyRegularizations, listRegularizations, regularizationReviewSchema, reviewRegularization } from '../controllers/regularization-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { MANAGER_ROLES, ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const listSchema = z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(), status: z.enum(['pending', 'approved', 'rejected', 'all']).optional() }).passthrough();

router.use(requireAuth);
router.post('/', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), validate(createRegularizationSchema), asyncHandler(createRegularization));
router.get('/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(listMyRegularizations));
router.get('/', allowRoles(...MANAGER_ROLES), validate(listSchema, 'query'), asyncHandler(listRegularizations));
router.patch('/:id/review', allowRoles(...MANAGER_ROLES), validate(regularizationReviewSchema), asyncHandler(reviewRegularization));

export default router;
