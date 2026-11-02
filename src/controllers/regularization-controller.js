import { z } from 'zod';
import { Attendance } from '../models/Attendance.js';
import { AttendanceRegularization } from '../models/AttendanceRegularization.js';
import { AuditLog } from '../models/AuditLog.js';
import { Employee } from '../models/Employee.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { ROLES } from '../constants/roles.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone } from '../utils/date.js';
import { HttpError } from '../utils/http-error.js';
import { notifyReviewers } from '../services/reviewer-notifications.js';
import { assertAlternatingAttendanceEvent, calculateNetWorkingMinutes } from '../services/attendance-rules.js';

export const createRegularizationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date'),
  type: z.enum(['IN', 'OUT']),
  requestedAt: z.coerce.date(),
  reason: z.string().trim().min(8).max(1000),
});

const reviewSchema = z.object({ status: z.enum(['approved', 'rejected']), reason: z.string().trim().max(1000).optional() });

export async function createRegularization(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const employee = await Employee.findById(req.auth.employeeId).select('employmentStatus');
  if (!employee || employee.employmentStatus !== 'active') throw new HttpError(403, 'Your employee profile is inactive', 'EMPLOYEE_INACTIVE');
  const dateKey = req.body.date;
  const today = dateKeyInTimeZone(new Date(), env.OFFICE_TIME_ZONE);
  if (dateKey > today) throw new HttpError(422, 'You can only request a correction for today or an earlier date', 'INVALID_REGULARIZATION_DATE');
  const oldestAllowed = new Date();
  oldestAllowed.setDate(oldestAllowed.getDate() - 90);
  if (dateKey < dateKeyInTimeZone(oldestAllowed, env.OFFICE_TIME_ZONE)) throw new HttpError(422, 'Attendance corrections can only be requested for the last 90 days', 'REGULARIZATION_TOO_OLD');
  if (dateKeyInTimeZone(req.body.requestedAt, env.OFFICE_TIME_ZONE) !== dateKey) throw new HttpError(422, 'Requested time must match the selected date', 'REGULARIZATION_TIME_MISMATCH');
  if (req.body.requestedAt > new Date()) throw new HttpError(422, 'Requested time cannot be in the future', 'REGULARIZATION_TIME_IN_FUTURE');
  const existing = await AttendanceRegularization.exists({ employee: employee.id, dateKey, type: req.body.type, status: 'pending' });
  if (existing) throw new HttpError(409, 'There is already a pending request for this event and date', 'REGULARIZATION_ALREADY_PENDING');
  const request = await AttendanceRegularization.create({ employee: employee.id, dateKey, type: req.body.type, requestedAt: req.body.requestedAt, reason: req.body.reason });
  await AuditLog.create({ actor: req.auth.userId, action: 'attendance.regularization.requested', entityType: 'AttendanceRegularization', entityId: request.id, reason: request.reason, ipAddress: req.ip });
  await notifyReviewers(req, employee.id, {
    type: 'attendance_request_new',
    title: 'Attendance correction requested',
    message: `A ${req.body.type === 'IN' ? 'check-in' : 'check-out'} correction was requested for ${dateKey}.`,
    data: { requestId: request.id },
  });
  res.status(201).json({ success: true, message: 'Attendance correction request sent for review', data: { request } });
}

export async function listMyRegularizations(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const [items, total] = await Promise.all([
    AttendanceRegularization.find({ employee: req.auth.employeeId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AttendanceRegularization.countDocuments({ employee: req.auth.employeeId }),
  ]);
  res.json({ success: true, message: 'Your attendance correction requests', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function listRegularizations(req, res) {
  const query = req.validatedQuery ?? req.query;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const filter = query.status && query.status !== 'all' ? { status: query.status } : {};
  if (req.auth.role === ROLES.MANAGER) {
    const team = req.auth.employeeId ? await Employee.find({ manager: req.auth.employeeId }).select('_id') : [];
    filter.employee = { $in: team.map(({ _id }) => _id) };
  }
  const [items, total] = await Promise.all([
    AttendanceRegularization.find(filter).populate('employee', 'employeeId firstName lastName department').populate('reviewedBy', 'email role').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AttendanceRegularization.countDocuments(filter),
  ]);
  res.json({ success: true, message: 'Attendance correction requests', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function reviewRegularization(req, res) {
  const request = await AttendanceRegularization.findById(req.params.id).populate('employee', 'employeeId firstName lastName email office employmentStatus');
  if (!request) throw new HttpError(404, 'Attendance correction request not found', 'REGULARIZATION_NOT_FOUND');
  if (request.status !== 'pending') throw new HttpError(409, 'This request has already been reviewed', 'REGULARIZATION_ALREADY_REVIEWED');
  if (req.auth.role === ROLES.MANAGER && (!req.auth.employeeId || !await Employee.exists({ _id: request.employee.id, manager: req.auth.employeeId }))) {
    throw new HttpError(403, 'You can only review requests from your direct team', 'FORBIDDEN');
  }
  if (req.body.status === 'rejected' && !req.body.reason?.trim()) throw new HttpError(422, 'Please provide a reason for rejection', 'REJECTION_REASON_REQUIRED');
  if (req.body.status === 'approved') {
    const employee = await Employee.findById(request.employee.id).populate('office').populate('shift');
    if (!employee || employee.employmentStatus !== 'active') throw new HttpError(409, 'This employee profile is inactive', 'EMPLOYEE_INACTIVE');
    if (!employee.office?.active) throw new HttpError(409, 'The employee needs an active office assignment before attendance can be corrected', 'OFFICE_NOT_ASSIGNED');
    let attendance = await Attendance.findOne({ employee: employee.id, dateKey: request.dateKey });
    if (!attendance) attendance = new Attendance({ employee: employee.id, office: employee.office.id, dateKey: request.dateKey, status: 'manual_review', events: [] });
    assertAlternatingAttendanceEvent(attendance.events, request.type, request.requestedAt);
    attendance.events.push({
      type: request.type,
      occurredAt: request.requestedAt,
      method: 'manual',
      verification: { faceMatched: false, livenessPassed: false },
      location: { latitude: employee.office.latitude, longitude: employee.office.longitude, accuracyMeters: 0, distanceMeters: 0 },
      correctedBy: req.auth.userId,
      correctionReason: request.reason,
    });
    attendance.events.sort((a, b) => a.occurredAt - b.occurredAt);
    attendance.status = 'manual_review';
    attendance.netWorkingMinutes = calculateNetWorkingMinutes(attendance.events, employee.shift?.breakMinutes ?? 0);
    await attendance.save();
    request.attendance = attendance.id;
  }
  request.status = req.body.status;
  request.reviewedBy = req.auth.userId;
  request.reviewedAt = new Date();
  request.reviewReason = req.body.reason?.trim() ?? '';
  await request.save();
  await AuditLog.create({ actor: req.auth.userId, action: `attendance.regularization.${request.status}`, entityType: 'AttendanceRegularization', entityId: request.id, reason: request.reviewReason, ipAddress: req.ip });
  const recipient = await User.findOne({ employee: request.employee.id }).select('_id');
  if (recipient) {
    try {
      await Notification.create({ recipient: recipient.id, type: `attendance_request_${request.status}`, title: `Attendance correction ${request.status}`, message: request.status === 'approved' ? `Your ${request.type === 'IN' ? 'check-in' : 'check-out'} correction for ${request.dateKey} was approved.` : `Your attendance correction for ${request.dateKey} was declined.${request.reviewReason ? ` Reason: ${request.reviewReason}` : ''}`, data: { requestId: request.id } });
    } catch (error) { req.log?.error({ err: error, requestId: request.id }, 'Unable to create regularization notification'); }
  }
  res.json({ success: true, message: `Attendance correction ${request.status}`, data: { request } });
}

export const regularizationReviewSchema = reviewSchema;
