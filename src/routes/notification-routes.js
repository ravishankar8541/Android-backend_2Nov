import { Router } from 'express';
import { z } from 'zod';
import { listMyNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notification-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const listSchema = z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional() }).passthrough();

router.use(requireAuth);
router.get('/my', validate(listSchema, 'query'), asyncHandler(listMyNotifications));
router.patch('/read-all', asyncHandler(markAllNotificationsRead));
router.patch('/:id/read', asyncHandler(markNotificationRead));

export default router;
