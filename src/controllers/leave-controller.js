import { z } from 'zod';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveType } from '../models/LeaveType.js';
import { Employee } from '../models/Employee.js';
import { AuditLog } from '../models/AuditLog.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { notifyReviewers } from '../services/reviewer-notifications.js';
import { ADMIN_ROLES, ROLES } from '../constants/roles.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone, startOfDateKey } from '../utils/date.js';
import { HttpError } from '../utils/http-error.js';
import { buildLeaveListFilter } from '../services/leave-list-access.js';

export const createLeaveSchema = z.object({
  leaveType: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  halfDay: z.boolean().default(false),
  reason: z.string().trim().min(5).max(1000),
}).refine((value) => value.endDate >= value.startDate, { message: 'End date must be on or after start date', path: ['endDate'] });

export async function listLeaveTypes(req, res) {
  const includeInactive = req.query.includeInactive === 'true' && ADMIN_ROLES.includes(req.auth.role);
  const items = await LeaveType.find(includeInactive ? {} : { active: true }).sort({ name: 1 });
  res.json({ success: true, message: 'Leave types', data: { items } });
}

export async function createLeaveType(req, res) {
  const leaveType = await LeaveType.create(req.body);
  await AuditLog.create({ actor: req.auth.userId, action: 'leave-type.created', entityType: 'LeaveType', entityId: leaveType.id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: 'Leave type created', data: { leaveType } });
}

export async function updateLeaveType(req, res) {
  const leaveType = await LeaveType.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!leaveType) throw new HttpError(404, 'Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
  await AuditLog.create({ actor: req.auth.userId, action: 'leave-type.updated', entityType: 'LeaveType', entityId: leaveType.id, ipAddress: req.ip });
  res.json({ success: true, message: 'Leave type updated', data: { leaveType } });
}

export async function createLeaveRequest(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const employee = await Employee.findById(req.auth.employeeId).select('_id');
  if (!employee) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const leaveType = await LeaveType.findOne({ _id: req.body.leaveType, active: true });
  if (!leaveType) throw new HttpError(404, 'Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
  if (req.body.halfDay && !leaveType.halfDayAllowed) throw new HttpError(422, 'Half-day leave is not allowed for this leave type', 'HALF_DAY_NOT_ALLOWED');
  if (req.body.halfDay && req.body.startDate.toDateString() !== req.body.endDate.toDateString()) throw new HttpError(422, 'Half-day leave must be for a single date', 'INVALID_HALF_DAY_RANGE');
  if (leaveType.attachmentRequired) throw new HttpError(503, 'Attachments are not configured for this workspace yet', 'LEAVE_ATTACHMENT_UNAVAILABLE');
  const start = new Date(req.body.startDate);
  const end = new Date(req.body.endDate);
  const days = req.body.halfDay ? 0.5 : Math.floor((end - start) / 86400000) + 1;
  if (days <= 0 || days > 90) throw new HttpError(422, 'Leave duration must be between 0.5 and 90 days', 'INVALID_LEAVE_DURATION');
  const overlap = await LeaveRequest.findOne({ employee: req.auth.employeeId, status: { $in: ['pending', 'approved'] }, startDate: { $lte: end }, endDate: { $gte: start } })
    .populate('leaveType', 'name')
    .select('leaveType startDate endDate status');
  if (overlap) {
    const overlapStart = dateKeyInTimeZone(overlap.startDate, env.OFFICE_TIME_ZONE);
    const overlapEnd = dateKeyInTimeZone(overlap.endDate, env.OFFICE_TIME_ZONE);
    throw new HttpError(409, `These dates overlap your ${overlap.status} ${overlap.leaveType?.name ?? 'leave'} request (${overlapStart}${overlapEnd !== overlapStart ? ` to ${overlapEnd}` : ''}).`, 'LEAVE_OVERLAP', {
      overlappingRequest: {
        id: overlap.id,
        leaveType: overlap.leaveType?.name ?? 'Leave',
        startDate: overlap.startDate,
        endDate: overlap.endDate,
        status: overlap.status,
      },
    });
  }
  if (leaveType.paid) {
    const leaveYear = dateKeyInTimeZone(new Date(), env.OFFICE_TIME_ZONE).slice(0, 4);
    const yearStart = startOfDateKey(`${leaveYear}-01-01`);
    const usage = await LeaveRequest.aggregate([
      { $match: { employee: employee._id, leaveType: leaveType._id, status: { $in: ['pending', 'approved'] }, startDate: { $gte: yearStart } } },
      { $group: { _id: null, used: { $sum: '$days' } } },
    ]);
    const alreadyRequested = usage[0]?.used ?? 0;
    if (alreadyRequested + days > leaveType.annualAllowance) throw new HttpError(422, 'This request is above your available leave balance', 'INSUFFICIENT_LEAVE_BALANCE');
  }
  const leaveRequest = await LeaveRequest.create({ ...req.body, employee: req.auth.employeeId, days });
  await AuditLog.create({ actor: req.auth.userId, action: 'leave.requested', entityType: 'LeaveRequest', entityId: leaveRequest.id, ipAddress: req.ip });
  await notifyReviewers(req, employee._id, {
    type: 'leave_request',
    title: 'New leave request',
    message: `${leaveType.name} request submitted for ${days} day${days === 1 ? '' : 's'}.`,
    data: { leaveRequestId: leaveRequest.id },
  });
  res.status(201).json({ success: true, message: 'Leave request submitted', data: { leaveRequest } });
}

export async function listLeaveRequests(req, res) {
  const query = req.validatedQuery ?? req.query;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  let teamEmployeeIds = [];
  if (req.auth.role === ROLES.MANAGER && req.auth.employeeId) {
    const team = await Employee.find({ manager: req.auth.employeeId }).select('_id');
    teamEmployeeIds = team.map(({ _id }) => _id);
  }
  const filter = buildLeaveListFilter({
    role: req.auth.role,
    employeeId: req.auth.employeeId,
    requestedEmployeeId: query.employee,
    teamEmployeeIds,
    status: query.status,
  });
  const [items, total] = await Promise.all([
    LeaveRequest.find(filter).populate('employee', 'employeeId firstName lastName department').populate('leaveType', 'name code paid').populate('reviewedBy', 'email role').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    LeaveRequest.countDocuments(filter),
  ]);
  res.json({ success: true, message: 'Leave requests', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function listMyLeaveRequests(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { employee: req.auth.employeeId };
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  const [items, total] = await Promise.all([
    LeaveRequest.find(filter).populate('employee', 'employeeId firstName lastName department').populate('leaveType', 'name code paid').populate('reviewedBy', 'email role').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    LeaveRequest.countDocuments(filter),
  ]);
  res.json({ success: true, message: 'Your leave requests', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function reviewLeaveRequest(req, res) {
  const request = await LeaveRequest.findById(req.params.id);
  if (!request) throw new HttpError(404, 'Leave request not found', 'LEAVE_NOT_FOUND');
  if (request.status !== 'pending') throw new HttpError(409, 'This leave request has already been reviewed', 'LEAVE_ALREADY_REVIEWED');
  if (req.auth.role === ROLES.MANAGER && (!req.auth.employeeId || !await Employee.exists({ _id: request.employee, manager: req.auth.employeeId }))) {
    throw new HttpError(403, 'You can only review leave for your direct team', 'FORBIDDEN');
  }
  if (req.body.status === 'rejected' && !req.body.reason?.trim()) throw new HttpError(422, 'Please provide a reason for rejection', 'REJECTION_REASON_REQUIRED');
  request.status = req.body.status;
  request.reviewedBy = req.auth.userId;
  request.reviewedAt = new Date();
  request.reviewReason = req.body.reason?.trim() ?? '';
  await request.save();
  await AuditLog.create({ actor: req.auth.userId, action: `leave.${request.status}`, entityType: 'LeaveRequest', entityId: request.id, reason: request.reviewReason, ipAddress: req.ip });
  const recipient = await User.findOne({ employee: request.employee }).select('_id');
  if (recipient) {
    const title = request.status === 'approved' ? 'Leave request approved' : 'Leave request declined';
    const message = request.status === 'approved'
      ? 'Your time-off request has been approved.'
      : `Your time-off request was declined.${request.reviewReason ? ` Reason: ${request.reviewReason}` : ''}`;
    try {
      await Notification.create({ recipient: recipient._id, type: `leave_${request.status}`, title, message, data: { leaveRequestId: request.id } });
    } catch (error) {
      req.log?.error({ err: error, leaveRequestId: request.id }, 'Unable to create leave decision notification');
    }
  }
  res.json({ success: true, message: `Leave request ${request.status}`, data: { leaveRequest: request } });
}

export async function cancelLeaveRequest(req, res) {
  const request = await LeaveRequest.findOne({ _id: req.params.id, employee: req.auth.employeeId });
  if (!request) throw new HttpError(404, 'Leave request not found', 'LEAVE_NOT_FOUND');
  if (request.status !== 'pending') throw new HttpError(409, 'Only pending requests can be cancelled', 'LEAVE_CANNOT_CANCEL');
  request.status = 'cancelled';
  await request.save();
  await AuditLog.create({ actor: req.auth.userId, action: 'leave.cancelled', entityType: 'LeaveRequest', entityId: request.id, ipAddress: req.ip });
  res.json({ success: true, message: 'Leave request cancelled', data: { leaveRequest: request } });
}

export async function getMyLeaveBalances(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const employee = await Employee.findById(req.auth.employeeId);
  const yearStart = startOfDateKey(`${dateKeyInTimeZone(new Date(), env.OFFICE_TIME_ZONE).slice(0, 4)}-01-01`);
  const [types, usage] = await Promise.all([
    LeaveType.find({ active: true }).sort({ name: 1 }),
    LeaveRequest.aggregate([
      { $match: { employee: employee._id, status: { $in: ['approved', 'pending'] }, startDate: { $gte: yearStart } } },
      { $group: { _id: '$leaveType', approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$days', 0] } }, pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$days', 0] } } } },
    ]),
  ]);
  const usageMap = new Map(usage.map((row) => [row._id.toString(), row]));
  const items = types.map((type) => {
    const summary = usageMap.get(type.id);
    const approvedUsed = summary?.approved ?? 0;
    const pending = summary?.pending ?? 0;
    const used = approvedUsed + pending;
    return { leaveType: type, allowance: type.annualAllowance, used, approvedUsed, pending, remaining: Math.max(0, type.annualAllowance - used) };
  });
  res.json({ success: true, message: 'Your leave balances', data: { items } });
}
