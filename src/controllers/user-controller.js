import { z } from 'zod';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { HttpError } from '../utils/http-error.js';
import { ROLES } from '../constants/roles.js';

export const createAdminUserSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum([ROLES.SUPER_ADMIN, ROLES.HR_ADMIN]),
  temporaryPassword: z.string().min(12).max(200),
});

export const updateUserStatusSchema = z.object({ active: z.boolean() });

export async function listAdminUsers(_req, res) {
  const items = await User.find({ role: { $in: [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN] } })
    .select('email role active createdAt updatedAt')
    .sort({ createdAt: -1 });
  res.json({ success: true, message: 'Admin accounts', data: { items } });
}

export async function createAdminUser(req, res) {
  const email = req.body.email.toLowerCase();
  if (await User.exists({ email })) throw new HttpError(409, 'An account already uses this email', 'EMAIL_ALREADY_IN_USE');
  const user = new User({ email, role: req.body.role, employee: null });
  await user.setPassword(req.body.temporaryPassword);
  await user.save();
  await AuditLog.create({ actor: req.auth.userId, action: 'user.admin_account_created', entityType: 'User', entityId: user.id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: 'Admin account created', data: { user: { id: user.id, email: user.email, role: user.role, active: user.active } } });
}

export async function updateAdminUserStatus(req, res) {
  const user = await User.findById(req.params.id).select('+refreshTokenHash');
  if (!user || ![ROLES.SUPER_ADMIN, ROLES.HR_ADMIN].includes(user.role)) throw new HttpError(404, 'Admin account not found', 'ADMIN_ACCOUNT_NOT_FOUND');
  if (user.id === req.auth.userId && !req.body.active) throw new HttpError(409, 'You cannot deactivate your own account', 'CANNOT_DEACTIVATE_SELF');
  if (!req.body.active && user.role === ROLES.SUPER_ADMIN) {
    const activeSuperAdmins = await User.countDocuments({ role: ROLES.SUPER_ADMIN, active: true });
    if (activeSuperAdmins <= 1) throw new HttpError(409, 'At least one active Super Admin account must remain', 'LAST_SUPER_ADMIN');
  }
  user.active = req.body.active;
  if (!user.active) user.refreshTokenHash = null;
  await user.save({ validateBeforeSave: false });
  await AuditLog.create({ actor: req.auth.userId, action: `user.admin_account_${user.active ? 'activated' : 'deactivated'}`, entityType: 'User', entityId: user.id, ipAddress: req.ip });
  res.json({ success: true, message: `Admin account ${user.active ? 'activated' : 'deactivated'}`, data: { user: { id: user.id, email: user.email, role: user.role, active: user.active } } });
}
