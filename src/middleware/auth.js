import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { env } from '../config/env.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED');
  let claims;
  try {
    claims = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { issuer: 'vam-hrms-api', audience: 'vam-hrms-apps' });
  } catch {
    throw new HttpError(401, 'Your session has expired. Sign in again.', 'INVALID_TOKEN');
  }
  const user = await User.findById(claims.sub).select('email role employee active');
  if (!user?.active) throw new HttpError(401, 'This account is inactive', 'ACCOUNT_INACTIVE');
  req.auth = { userId: user.id, email: user.email, role: user.role, employeeId: user.employee?.toString() ?? null };
  next();
});

export function allowRoles(...roles) {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) return next(new HttpError(403, 'You do not have permission to do this', 'FORBIDDEN'));
    next();
  };
}
