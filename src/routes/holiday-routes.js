import { Router } from 'express';
import { z } from 'zod';
import { createHoliday, listHolidays, updateHoliday } from '../controllers/holiday-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date');
const listSchema = z.object({ from: dateSchema.optional(), to: dateSchema.optional() }).passthrough();
const createSchema = z.object({ name: z.string().trim().min(2).max(120), date: dateSchema, category: z.enum(['company', 'national', 'festival', 'optional']).default('company'), description: z.string().trim().max(500).optional(), active: z.boolean().default(true) });
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

router.use(requireAuth);
router.get('/', validate(listSchema, 'query'), asyncHandler(listHolidays));
router.post('/', allowRoles(...ADMIN_ROLES), validate(createSchema), asyncHandler(createHoliday));
router.patch('/:id', allowRoles(...ADMIN_ROLES), validate(updateSchema), asyncHandler(updateHoliday));

export default router;
