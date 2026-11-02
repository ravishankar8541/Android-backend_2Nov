import { Router } from 'express';
import { getSummary } from '../controllers/dashboard-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { MANAGER_ROLES } from '../constants/roles.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
router.get('/summary', requireAuth, allowRoles(...MANAGER_ROLES), asyncHandler(getSummary));
export default router;
