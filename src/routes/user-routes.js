import { Router } from 'express';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { createAdminUser, createAdminUserSchema, listAdminUsers, updateAdminUserStatus, updateUserStatusSchema } from '../controllers/user-controller.js';

const router = Router();
router.use(requireAuth, allowRoles(ROLES.SUPER_ADMIN));
router.get('/', asyncHandler(listAdminUsers));
router.post('/', validate(createAdminUserSchema), asyncHandler(createAdminUser));
router.patch('/:id/status', validate(updateUserStatusSchema), asyncHandler(updateAdminUserStatus));

export default router;
