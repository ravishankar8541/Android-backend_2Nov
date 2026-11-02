import { Router } from 'express';
import { z } from 'zod';
import { createAnnouncement, listAnnouncements } from '../controllers/announcement-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  message: z.string().trim().min(5).max(4000),
  audienceType: z.enum(['everyone', 'department', 'employees']),
  department: z.string().trim().max(80).optional(),
  employees: z.array(z.string().regex(/^[a-f\d]{24}$/i, 'Choose valid employee records')).max(500).optional(),
});

router.use(requireAuth);
router.get('/', asyncHandler(listAnnouncements));
router.post('/', allowRoles(...ADMIN_ROLES), validate(createSchema), asyncHandler(createAnnouncement));

export default router;
