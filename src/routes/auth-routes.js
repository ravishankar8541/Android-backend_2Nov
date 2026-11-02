import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { login, logout, refresh, getCurrentUser, changePassword, requestPasswordReset } from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, message: 'Too many sign-in attempts. Try again later.', code: 'RATE_LIMITED' } });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, message: 'Too many reset requests. Try again later.', code: 'RATE_LIMITED' } });
const forgotSchema = z.object({ email: z.string().trim().email().max(254) });
const loginSchema = z.object({
  email: z.string().trim().min(2).max(254).optional(),
  identifier: z.string().trim().min(2).max(254).optional(),
  password: z.string().min(1).max(200),
}).refine((body) => body.email || body.identifier, { message: 'Enter your work email or employee ID', path: ['identifier'] });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(login));
router.post('/forgot-password', forgotLimiter, validate(forgotSchema), asyncHandler(requestPasswordReset));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
router.post('/change-password', requireAuth, validate(changePasswordSchema), asyncHandler(changePassword));
router.get('/me', requireAuth, asyncHandler(getCurrentUser));

export default router;
