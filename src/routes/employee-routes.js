import { Router } from 'express';
import { z } from 'zod';
import { createEmployee, getEmployee, listEmployees, resetEmployeePassword, updateEmployee } from '../controllers/employee-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES, MANAGER_ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const monthlyAmount = z.number().min(0).max(10000000);
const salarySchema = z.object({
  currency: z.string().trim().toUpperCase().length(3).optional(),
  basic: monthlyAmount.optional(),
  hra: monthlyAmount.optional(),
  specialAllowance: monthlyAmount.optional(),
  bonus: monthlyAmount.optional(),
  pfPercentage: z.number().min(0).max(100).optional(),
  tds: monthlyAmount.optional(),
  otherDeductions: monthlyAmount.optional(),
  pan: z.string().trim().max(10).optional(),
  aadhaar: z.string().trim().max(12).optional(),
  bankAccount: z.string().trim().max(34).optional(),
  ifsc: z.string().trim().max(11).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one salary field');
const createSchema = z.object({
  employeeId: z.string().trim().min(2).max(30),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().email().max(254),
  phone: z.string().max(30).optional(),
  department: z.string().trim().max(80).optional(),
  designation: z.string().trim().max(100).optional(),
  manager: z.string().optional(),
  office: z.string().optional(),
  shift: z.string().optional(),
  salary: salarySchema.optional(),
  role: z.enum(['employee', 'manager']).default('employee'),
  temporaryPassword: z.string().min(5).max(200),
});
const updateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().max(30).optional(),
  department: z.string().trim().max(80).optional(),
  designation: z.string().trim().max(100).optional(),
  manager: z.string().nullable().optional(),
  office: z.string().nullable().optional(),
  shift: z.string().nullable().optional(),
  salary: salarySchema.optional(),
  employmentStatus: z.enum(['active', 'inactive']).optional(),
  faceEnrollmentStatus: z.enum(['not_enrolled', 'pending', 'enrolled', 'disabled']).optional(),
}).refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');
const resetPasswordSchema = z.object({ temporaryPassword: z.string().min(5).max(200) });

router.use(requireAuth);
router.get('/', allowRoles(...MANAGER_ROLES), asyncHandler(listEmployees));
router.post('/', allowRoles(...ADMIN_ROLES), validate(createSchema), asyncHandler(createEmployee));
router.get('/:id', allowRoles(...MANAGER_ROLES), asyncHandler(getEmployee));
router.patch('/:id', allowRoles(...ADMIN_ROLES), validate(updateSchema), asyncHandler(updateEmployee));
router.post('/:id/reset-password', allowRoles(...ADMIN_ROLES), validate(resetPasswordSchema), asyncHandler(resetEmployeePassword));

export default router;
