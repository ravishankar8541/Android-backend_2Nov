import { Router } from 'express';
import { z } from 'zod';
import { createLeaveRequest, createLeaveSchema, createLeaveType, updateLeaveType, getMyLeaveBalances, listLeaveRequests, listMyLeaveRequests, listLeaveTypes, reviewLeaveRequest, cancelLeaveRequest } from '../controllers/leave-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES, MANAGER_ROLES, ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const createTypeSchema = z.object({ name: z.string().trim().min(2).max(80), code: z.string().trim().min(2).max(12), annualAllowance: z.number().min(0).max(365), paid: z.boolean().default(true), carryForward: z.boolean().default(false), halfDayAllowed: z.boolean().default(true), attachmentRequired: z.boolean().default(false) });
const updateTypeSchema = createTypeSchema.partial().extend({ active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
const reviewSchema = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().trim().max(1000).optional() });
const filtersSchema = z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(), status: z.string().optional(), employee: z.string().optional() }).passthrough();

router.use(requireAuth);
router.get('/types', asyncHandler(listLeaveTypes));
router.post('/types', allowRoles(...ADMIN_ROLES), validate(createTypeSchema), asyncHandler(createLeaveType));
router.patch('/types/:id', allowRoles(...ADMIN_ROLES), validate(updateTypeSchema), asyncHandler(updateLeaveType));
router.get('/balances/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(getMyLeaveBalances));
router.post('/', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), validate(createLeaveSchema), asyncHandler(createLeaveRequest));
router.get('/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(listMyLeaveRequests));
router.get('/', allowRoles(...MANAGER_ROLES, ROLES.EMPLOYEE), validate(filtersSchema, 'query'), asyncHandler(listLeaveRequests));
router.patch('/:id/review', allowRoles(...MANAGER_ROLES), validate(reviewSchema), asyncHandler(reviewLeaveRequest));
router.delete('/:id', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(cancelLeaveRequest));

export default router;
