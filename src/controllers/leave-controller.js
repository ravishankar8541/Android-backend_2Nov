import { z } from 'zod';
import { LeaveQuota } from '../models/LeaveQuota.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveType } from '../models/LeaveType.js';
import { Employee } from '../models/Employee.js';
import { AuditLog } from '../models/AuditLog.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { notifyReviewers } from '../services/reviewer-notifications.js';
import { ROLES } from '../constants/roles.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone, monthKeyInTimeZone } from '../utils/date.js';
import { HttpError } from '../utils/http-error.js';
import { buildLeaveListFilter } from '../services/leave-list-access.js';
import { loadLeaveQuotaContext } from '../services/leave-quota.js';

export const createLeaveSchema = z.object({
  leaveType: z.string().trim().min(1).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  halfDay: z.boolean().default(false),
  reason: z.string().trim().min(5).max(1000),
}).refine((value) => value.endDate >= value.startDate, { message: 'End date must be on or after start date', path: ['endDate'] });

// The frozen Android build still lists leave types, so they survive as labels only.
export async function listLeaveTypes(_req, res) {
  const items = await LeaveType.find({ active: true }).sort({ name: 1 });
  res.json({ success: true, message: 'Leave types', data: { items } });
}

// The date sets exist for payroll only; JSON would serialize a Set as an empty object.
function monthSummary(summary, monthKey) {
  const { used, pending, remaining, assigned, defaultApplied } = summary;
  return { monthKey, used, pending, remaining, assigned, defaultApplied, unpaid: Math.max(0, Math.round((used - assigned) * 100) / 100) };
}

async function employeeQuotaSummary(employeeId, monthKey) {
  const employee = await Employee.findById(employeeId).populate('shift', 'weeklyOffDays');
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  const { summaries } = await loadLeaveQuotaContext({ monthKey, employees: [employee] });
  return monthSummary(summaries.get(employee.id), monthKey);
}

function thisMonth() {
  return monthKeyInTimeZone(new Date(), env.OFFICE_TIME_ZONE);
}

export async function getMyLeaveQuota(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const monthKey = req.validatedQuery?.month || thisMonth();
  res.json({ success: true, message: 'Your monthly leave quota', data: { quota: await employeeQuotaSummary(req.auth.employeeId, monthKey) } });
}

// Legacy shape for the Android build: one balance row carrying the monthly quota.
export async function getMyLeaveBalances(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const quota = await employeeQuotaSummary(req.auth.employeeId, thisMonth());
  const items = [{
    leaveType: { _id: 'monthly-quota', name: 'Monthly leave', code: 'ML' },
    allowance: quota.assigned,
    used: quota.used,
    approvedUsed: quota.used,
    pending: quota.pending,
    remaining: quota.remaining,
  }];
  res.json({ success: true, message: 'Your leave balances', data: { items } });
}

export async function listLeaveQuotas(req, res) {
  const monthKey = req.validatedQuery?.month || thisMonth();
  const employees = await Employee.find({ employmentStatus: 'active' }).populate('shift', 'weeklyOffDays').sort({ employeeId: 1 });
  const { summaries } = await loadLeaveQuotaContext({ monthKey, employees });
  const items = employees.map((employee) => ({
    employee: { _id: employee.id, employeeId: employee.employeeId, firstName: employee.firstName, lastName: employee.lastName, department: employee.department },
    ...monthSummary(summaries.get(employee.id), monthKey),
  }));
  res.json({ success: true, message: 'Monthly leave quotas', data: { monthKey, items } });
}

export async function assignLeaveQuota(req, res) {
  const { month, days } = req.body;
  const employee = await Employee.findById(req.params.employeeId).select('_id employeeId');
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  const quota = await LeaveQuota.findOneAndUpdate(
    { employee: employee._id, monthKey: month },
    { $set: { days, assignedBy: req.auth.userId, assignedAt: new Date() } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  await AuditLog.create({ actor: req.auth.userId, action: 'leave-quota.assigned', entityType: 'LeaveQuota', entityId: quota.id, reason: `${days} paid leave day(s) for ${month}`, ipAddress: req.ip });
  res.json({ success: true, message: 'Monthly leave quota saved', data: { quota } });
}

export async function assignLeaveQuotaForTeam(req, res) {
  const { month, days } = req.body;
  const employees = await Employee.find({ employmentStatus: 'active' }).select('_id');
  const now = new Date();
  await LeaveQuota.bulkWrite(employees.map((employee) => ({
    updateOne: { filter: { employee: employee._id, monthKey: month }, update: { $set: { days, assignedBy: req.auth.userId, assignedAt: now } }, upsert: true },
  })));
  await AuditLog.create({ actor: req.auth.userId, action: 'leave-quota.assigned-all', entityType: 'LeaveQuota', entityId: month, reason: `${days} paid leave day(s) for every active employee in ${month}`, ipAddress: req.ip });
  res.json({ success: true, message: 'Monthly leave quota assigned', data: { monthKey: month, days, employees: employees.length } });
}

export async function createLeaveRequest(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const employee = await Employee.findById(req.auth.employeeId).select('_id');
  if (!employee) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const leaveType = req.body.leaveType ? await LeaveType.findOne({ _id: req.body.leaveType, active: true }).select('_id name') : null;
  if (req.body.leaveType && !leaveType) throw new HttpError(404, 'Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
  if (req.body.halfDay && req.body.startDate.toDateString() !== req.body.endDate.toDateString()) throw new HttpError(422, 'Half-day leave must be for a single date', 'INVALID_HALF_DAY_RANGE');
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
  const leaveRequest = await LeaveRequest.create({ ...req.body, employee: req.auth.employeeId, days });
  await AuditLog.create({ actor: req.auth.userId, action: 'leave.requested', entityType: 'LeaveRequest', entityId: leaveRequest.id, ipAddress: req.ip });
  await notifyReviewers(req, employee._id, {
    type: 'leave_request',
    title: 'New leave request',
    message: `${leaveType?.name ?? 'Leave'} request submitted for ${days} day${days === 1 ? '' : 's'}.`,
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
    LeaveRequest.find(filter).populate('employee', 'employeeId firstName lastName department').populate('leaveType', 'name code').populate('reviewedBy', 'email role').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
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
    LeaveRequest.find(filter).populate('employee', 'employeeId firstName lastName department').populate('leaveType', 'name code').populate('reviewedBy', 'email role').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
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
    let message = request.status === 'approved'
      ? 'Your time-off request has been approved.'
      : `Your time-off request was declined.${request.reviewReason ? ` Reason: ${request.reviewReason}` : ''}`;
    if (request.status === 'approved') {
      try {
        const quota = await employeeQuotaSummary(request.employee, monthKeyInTimeZone(request.startDate, env.OFFICE_TIME_ZONE));
        message = quota.unpaid > 0
          ? `Approved. ${quota.used} of ${quota.assigned} paid leave days are used this month, so ${quota.unpaid} day(s) will be unpaid.`
          : `Approved. ${quota.used} of ${quota.assigned} paid leave days are used this month.`;
      } catch (error) {
        req.log?.warn({ err: error, leaveRequestId: request.id }, 'Unable to attach the monthly quota to the approval notification');
      }
    }
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
