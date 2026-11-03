import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Employee } from '../models/Employee.js';
import { Notification } from '../models/Notification.js';
import { PasswordResetRequest } from '../models/PasswordResetRequest.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { HttpError } from '../utils/http-error.js';
import { env } from '../config/env.js';

const COOKIE_NAME = 'vam_refresh';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/api/auth' });
}

function createAccessToken(user) {
  return jwt.sign({ role: user.role, employeeId: user.employee?.toString() ?? null }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: 'vam-hrms-api',
    audience: 'vam-hrms-apps',
  });
}

async function rotateRefreshToken(user, res) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  user.refreshTokenHash = sha256(refreshToken);
  await user.save({ validateBeforeSave: false });
  setRefreshCookie(res, refreshToken);
  return { accessToken: createAccessToken(user), refreshToken };
}

export async function login(req, res) {
  const identifier = (req.body.identifier || req.body.email).trim().toLowerCase();
  let email = identifier;
  if (!identifier.includes('@')) {
    const employee = await Employee.findOne({ employeeId: identifier.toUpperCase() }).select('email');
    if (!employee) throw new HttpError(401, 'Email/employee ID or password is incorrect', 'INVALID_CREDENTIALS');
    email = employee.email;
  }
  const user = await User.findOne({ email }).select('+passwordHash +refreshTokenHash');
  if (!user || !(await user.verifyPassword(req.body.password))) throw new HttpError(401, 'Email or password is incorrect', 'INVALID_CREDENTIALS');
  if (!user.active) throw new HttpError(403, 'This account is inactive', 'ACCOUNT_INACTIVE');
  const { accessToken, refreshToken } = await rotateRefreshToken(user, res);
  const employeeProfile = user.employee ? (await user.populate('employee')).employee : null;
  res.json({ success: true, message: 'Signed in successfully', data: {
    accessToken,
    ...(req.get('x-client-platform') === 'native' ? { refreshToken } : {}),
    user: { id: user.id, email: user.email, role: user.role, employee: employeeProfile ? {
      id: employeeProfile.id,
      employeeId: employeeProfile.employeeId,
      firstName: employeeProfile.firstName,
      lastName: employeeProfile.lastName,
    } : null },
  } });
}

export async function refresh(req, res) {
  const isNative = req.get('x-client-platform') === 'native';
  const token = isNative ? req.body?.refreshToken : req.cookies?.[COOKIE_NAME];
  if (!token) throw new HttpError(401, 'Sign in to continue', 'REFRESH_TOKEN_MISSING');
  const hash = sha256(token);
  const user = await User.findOne({ refreshTokenHash: hash }).select('+refreshTokenHash');
  if (!user?.active) {
    clearRefreshCookie(res);
    throw new HttpError(401, 'Your session has expired. Sign in again.', 'INVALID_REFRESH_TOKEN');
  }
  const { accessToken, refreshToken } = await rotateRefreshToken(user, res);
  res.json({ success: true, message: 'Session refreshed', data: { accessToken, ...(isNative ? { refreshToken } : {}) } });
}

export async function logout(req, res) {
  const token = req.get('x-client-platform') === 'native' ? req.body?.refreshToken : req.cookies?.[COOKIE_NAME];
  if (token) await User.updateOne({ refreshTokenHash: sha256(token) }, { $set: { refreshTokenHash: null } });
  clearRefreshCookie(res);
  res.json({ success: true, message: 'Signed out successfully', data: null });
}

export async function changePassword(req, res) {
  const user = await User.findById(req.auth.userId).select('+passwordHash +refreshTokenHash');
  if (!user || !(await user.verifyPassword(req.body.currentPassword))) {
    throw new HttpError(401, 'Your current password is incorrect', 'CURRENT_PASSWORD_INCORRECT');
  }
  await user.setPassword(req.body.newPassword);
  const { accessToken, refreshToken } = await rotateRefreshToken(user, res);
  res.json({ success: true, message: 'Password updated', data: { accessToken, ...(req.get('x-client-platform') === 'native' ? { refreshToken } : {}) } });
}

export async function requestPasswordReset(req, res) {
  const requestedBy = req.body.email.trim().toLowerCase();
  const acknowledged = { success: true, message: 'If that work email has an account, your HR admin has been asked to approve a reset.', data: null };
  const user = await User.findOne({ email: requestedBy }).select('role employee active');
  if (!user?.active) return res.json(acknowledged);
  if (await PasswordResetRequest.exists({ user: user.id, status: 'pending' })) return res.json(acknowledged);
  const employee = user.employee ? await Employee.findById(user.employee).select('firstName lastName employeeId').lean() : null;
  const label = employee ? `${employee.firstName} ${employee.lastName} (${employee.employeeId})` : requestedBy;
  let request;
  try {
    request = await PasswordResetRequest.findOneAndUpdate(
      { user: user.id },
      { $set: { status: 'pending', requestedBy, ipAddress: req.ip ?? '', reviewedBy: null, reviewedAt: null, reason: '' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error?.code === 11000) return res.json(acknowledged);
    throw error;
  }
  const admins = await User.find({ active: true, role: { $in: ADMIN_ROLES } }).select('_id').lean();
  if (admins.length) {
    await Notification.insertMany(admins.map(({ _id }) => ({
      recipient: _id,
      type: 'password_reset_request',
      title: 'Password reset request',
      message: `${label} cannot sign in and has asked for a password reset.`,
      data: { requestId: request.id },
    })), { ordered: false }).catch((error) => req.log?.error({ err: error }, 'Unable to create password reset reviewer notifications'));
  }
  res.json(acknowledged);
}

export async function getCurrentUser(req, res) {
  const user = await User.findById(req.auth.userId).populate({
    path: 'employee',
    populate: [
      { path: 'office', select: 'name address latitude longitude radiusMeters active' },
      { path: 'shift', select: 'name startTime endTime graceMinutes breakMinutes active' },
      { path: 'manager', select: 'firstName lastName employeeId' },
    ],
  });
  res.json({ success: true, message: 'Current user', data: { user: {
    id: user.id,
    email: user.email,
    role: user.role,
    employee: user.employee ? {
      id: user.employee.id,
      employeeId: user.employee.employeeId,
      firstName: user.employee.firstName,
      lastName: user.employee.lastName,
      department: user.employee.department,
      designation: user.employee.designation,
      phone: user.employee.phone,
      photoUrl: user.employee.photoUrl,
      joiningDate: user.employee.joiningDate,
      employmentStatus: user.employee.employmentStatus,
      faceEnrollmentStatus: user.employee.faceEnrollmentStatus,
      attendanceVerification: user.employee.attendanceVerification,
      office: user.employee.office,
      shift: user.employee.shift,
      manager: user.employee.manager,
    } : null,
  } } });
}
