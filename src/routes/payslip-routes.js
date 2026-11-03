import { Router } from 'express';
import { z } from 'zod';
import {
  deletePayslip,
  getMyPayslip,
  getPayslip,
  getPayslipPdf,
  listMyPayslips,
  listPayslips,
  recallPayslip,
  releaseMonth,
  releasePayslip,
  runPayroll,
  updatePayslip,
} from '../controllers/payslip-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES, ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const EARNING_KEYS = ['basic', 'hra', 'specialAllowance', 'bonus'];
const DEDUCTION_KEYS = ['lop', 'pf', 'tds', 'other'];
const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the YYYY-MM month format');
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid payslip id');
const amount = z.number().min(0).max(10000000);
const runSchema = z.object({ monthKey: monthKeySchema, force: z.boolean().default(false), reason: z.string().trim().max(500).optional() });
const releaseMonthSchema = z.object({ monthKey: monthKeySchema });
const idParamSchema = z.object({ id: objectIdSchema });
const monthParamSchema = z.object({ monthKey: monthKeySchema });
const updateSchema = z.object({
  earnings: z.array(z.object({ key: z.enum(EARNING_KEYS), amount })).min(1).optional(),
  deductions: z.array(z.object({ key: z.enum(DEDUCTION_KEYS), amount })).min(1).optional(),
  attendance: z.object({
    totalDays: z.number().min(0).max(31),
    paidDays: z.number().min(0).max(31),
    lopDays: z.number().min(0).max(31),
  }).partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one day count').optional(),
  statutory: z.object({
    pan: z.string().trim().max(10),
    aadhaar: z.string().trim().max(12),
    bankAccount: z.string().trim().max(34),
    ifsc: z.string().trim().max(11),
  }).partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one value').optional(),
  reason: z.string().trim().min(3).max(500),
}).refine((value) => value.earnings || value.deductions || value.attendance || value.statutory, 'Provide at least one value to change');
const filtersSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  monthKey: monthKeySchema.optional(),
  status: z.enum(['all', 'draft', 'released']).optional(),
  employee: objectIdSchema.optional(),
  q: z.string().trim().max(80).optional(),
}).passthrough();

router.use(requireAuth);
router.post('/run', allowRoles(...ADMIN_ROLES), validate(runSchema), asyncHandler(runPayroll));
router.post('/release-month', allowRoles(...ADMIN_ROLES), validate(releaseMonthSchema), asyncHandler(releaseMonth));
router.get('/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(listMyPayslips));
router.get('/my/:monthKey', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), validate(monthParamSchema, 'params'), asyncHandler(getMyPayslip));
router.get('/', allowRoles(...ADMIN_ROLES), validate(filtersSchema, 'query'), asyncHandler(listPayslips));
router.get('/:id', allowRoles(...ADMIN_ROLES, ROLES.EMPLOYEE, ROLES.MANAGER), validate(idParamSchema, 'params'), asyncHandler(getPayslip));
router.get('/:id/pdf', allowRoles(...ADMIN_ROLES, ROLES.EMPLOYEE, ROLES.MANAGER), validate(idParamSchema, 'params'), asyncHandler(getPayslipPdf));
router.patch('/:id', allowRoles(...ADMIN_ROLES), validate(idParamSchema, 'params'), validate(updateSchema), asyncHandler(updatePayslip));
router.post('/:id/release', allowRoles(...ADMIN_ROLES), validate(idParamSchema, 'params'), asyncHandler(releasePayslip));
router.post('/:id/recall', allowRoles(...ADMIN_ROLES), validate(idParamSchema, 'params'), asyncHandler(recallPayslip));
router.delete('/:id', allowRoles(...ADMIN_ROLES), validate(idParamSchema, 'params'), asyncHandler(deletePayslip));

export default router;
