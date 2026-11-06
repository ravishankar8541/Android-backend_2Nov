import { Router } from 'express';
import { z } from 'zod';
import { checkIn, checkOut, correctAttendance, editAttendance, getToday, listAttendance, listMyAttendance, attendanceEditSchema, attendanceEventSchema, attendanceIdSchema, correctionSchema } from '../controllers/attendance-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES, MANAGER_ROLES, ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date');
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const filtersSchema = z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional(), date: dateSchema.optional(), from: dateSchema.optional(), to: dateSchema.optional(), status: z.enum(['all', 'present', 'late', 'half_day', 'absent', 'early_leave', 'overtime', 'manual_review', 'on_leave']).optional(), office: objectIdSchema.optional(), shift: objectIdSchema.optional(), department: z.string().optional(), employee: z.string().optional() }).passthrough().refine(({ from, to }) => !from || !to || from <= to, { message: 'From date must be on or before the end date', path: ['to'] });

router.use(requireAuth);
router.post('/check-in', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), validate(attendanceEventSchema), asyncHandler(checkIn));
router.post('/check-out', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), validate(attendanceEventSchema), asyncHandler(checkOut));
router.get('/today', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(getToday));
router.get('/my', allowRoles(ROLES.EMPLOYEE, ROLES.MANAGER), asyncHandler(listMyAttendance));
router.get('/', allowRoles(...MANAGER_ROLES), validate(filtersSchema, 'query'), asyncHandler(listAttendance));
router.patch('/:id/correction', allowRoles(...ADMIN_ROLES), validate(correctionSchema), asyncHandler(correctAttendance));
router.patch('/:id', allowRoles(...ADMIN_ROLES), validate(attendanceIdSchema, 'params'), validate(attendanceEditSchema), asyncHandler(editAttendance));

export default router;
