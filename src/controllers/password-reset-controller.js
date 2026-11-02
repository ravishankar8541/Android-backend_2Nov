import { PasswordResetRequest } from '../models/PasswordResetRequest.js';
import { Notification } from '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/http-error.js';

export async function listPasswordResets(req, res) {
  const query = req.validatedQuery ?? req.query;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const filter = query.status && query.status !== 'all' ? { status: query.status } : {};
  const [items, total, pending] = await Promise.all([
    PasswordResetRequest.find(filter).populate({ path: 'user', select: 'email role employee', populate: { path: 'employee', select: 'employeeId firstName lastName department' } }).populate('reviewedBy', 'email role').sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
    PasswordResetRequest.countDocuments(filter),
    PasswordResetRequest.countDocuments({ status: 'pending' }),
  ]);
  res.json({ success: true, message: 'Password reset requests', data: { items, pending, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function reviewPasswordReset(req, res) {
  const request = await PasswordResetRequest.findById(req.params.id).populate('user', 'email role employee active');
  if (!request) throw new HttpError(404, 'Password reset request not found', 'RESET_REQUEST_NOT_FOUND');
  if (request.status !== 'pending') throw new HttpError(409, 'This request has already been reviewed', 'RESET_REQUEST_REVIEWED');
  const decision = req.body.status;
  if (decision === 'approved') {
    if (!request.user) throw new HttpError(409, 'The sign-in account no longer exists', 'USER_NOT_FOUND');
    if (!request.user.active) throw new HttpError(409, 'This account is inactive, so a reset cannot be approved', 'ACCOUNT_INACTIVE');
    if (req.body.temporaryPassword) {
      const user = await User.findById(request.user.id).select('+passwordHash +refreshTokenHash');
      await user.setPassword(req.body.temporaryPassword);
      user.refreshTokenHash = null;
      await user.save({ validateBeforeSave: false });
    }
  }
  request.status = decision;
  request.reviewedBy = req.auth.userId;
  request.reviewedAt = new Date();
  request.reason = decision === 'rejected' ? req.body.reason.trim() : '';
  await request.save();
  if (request.user) {
    await Notification.create({
      recipient: request.user.id,
      type: decision === 'approved' ? 'password_reset_approved' : 'password_reset_rejected',
      title: decision === 'approved' ? 'Password reset approved' : 'Password reset declined',
      message: decision === 'approved'
        ? 'Your password reset request was approved. Sign in with the temporary password your HR admin shared, then set your own from the account menu.'
        : `Your password reset request was declined. Reason: ${request.reason}`,
      data: { requestId: request.id },
    });
  }
  await AuditLog.create({
    actor: req.auth.userId,
    action: `password_reset.${decision}`,
    entityType: 'PasswordResetRequest',
    entityId: request.id,
    reason: request.reason,
    metadata: { targetEmail: request.requestedBy, passwordSet: Boolean(req.body.temporaryPassword) },
    ipAddress: req.ip ?? '',
  });
  res.json({ success: true, message: decision === 'approved' ? 'Request approved' : 'Request declined', data: { request } });
}
