import { Router } from 'express';
import { z } from 'zod';
import { assignLeaveQuota, assignLeaveQuotaForTeam, cancelLeaveRequest, createLeaveRequest, createLeaveSchema, getMyLeaveBalances, getMyLeaveQuota, listLeaveQuotas, listLeaveRequests, listMyLeaveRequests, listLeaveTypes, reviewLeaveRequest } from '../controllers/leave-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES, MANAGER_ROLES, ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const reviewSchema = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().trim().max(1000).optional() });
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const filtersSchema = z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(), status: z.enum(['all', 'pending', 'approved', 'rejected', 'cancelled']).optional(), employee: objectIdSchema.optional() }).passthrough();
const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use the YYYY-MM month format').optional() }).passthrough();
const assignSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use the YYYY-MM month format'), days: z.coerce.number().min(0).max(31) });

router.use(requireAuth);
router.get('/types', asyncHandler(listLeaveTypes));
router.get('/quotas', allowRoles(...ADMIN_ROLES), validate(monthSchema, 'query'), asyncHandler(listLeaveQuotas));
router.put('/quotas', allowRoles(...ADMIN_ROLES), validate(assignSchema), asyncHandler(assignLeaveQuotaForTeam));
router.put('/quotas/:employeeId', allowRoles(...ADMIN_ROLES), validate(assignSchema), asyncHandler(assignLeaveQuota));
router.get('/quotas/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), validate(monthSchema, 'query'), asyncHandler(getMyLeaveQuota));
router.get('/balances/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(getMyLeaveBalances));
router.post('/', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), validate(createLeaveSchema), asyncHandler(createLeaveRequest));
router.get('/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(listMyLeaveRequests));
router.get('/', allowRoles(...MANAGER_ROLES, ROLES.EMPLOYEE), validate(filtersSchema, 'query'), asyncHandler(listLeaveRequests));
router.patch('/:id/review', allowRoles(...MANAGER_ROLES), validate(reviewSchema), asyncHandler(reviewLeaveRequest));
router.delete('/:id', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(cancelLeaveRequest));

export default router;
