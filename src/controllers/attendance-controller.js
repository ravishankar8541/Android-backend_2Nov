import { z } from 'zod';
import { Attendance } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { AuditLog } from '../models/AuditLog.js';
import { HttpError } from '../utils/http-error.js';
import { dateKeyInTimeZone, shiftDateKey } from '../utils/date.js';
import { env } from '../config/env.js';
import { ROLES } from '../constants/roles.js';
import { markAttendance } from '../services/attendance-service.js';
import { assertAlternatingAttendanceEvent, calculateNetWorkingMinutes } from '../services/attendance-rules.js';

export const attendanceEventSchema = z.object({
  verificationSessionId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().positive().max(10000),
  deviceId: z.string().max(120).optional(),
});

export async function checkIn(req, res) {
  const attendance = await markAttendance({ auth: req.auth, body: req.body, type: 'IN' });
  res.status(201).json({ success: true, message: 'Check-in recorded', data: { attendance } });
}

export async function checkOut(req, res) {
  const attendance = await markAttendance({ auth: req.auth, body: req.body, type: 'OUT' });
  res.json({ success: true, message: 'Check-out recorded', data: { attendance } });
}

export async function getToday(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const dateKey = dateKeyInTimeZone(new Date(), env.OFFICE_TIME_ZONE);
  let attendance = await Attendance.findOne({ employee: req.auth.employeeId, dateKey });
  if (!attendance) {
    const employee = await Employee.findById(req.auth.employeeId).populate('shift', 'startTime endTime');
    if (employee?.shift) {
      const [startHour, startMinute] = employee.shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = employee.shift.endTime.split(':').map(Number);
      const endOfOvernightShift = endHour * 60 + endMinute;
      const now = new Intl.DateTimeFormat('en-GB', { timeZone: env.OFFICE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
      const currentMinute = now[0] * 60 + now[1];
      if (endOfOvernightShift <= startHour * 60 + startMinute && currentMinute <= endOfOvernightShift + 240) {
        const previous = await Attendance.findOne({ employee: req.auth.employeeId, dateKey: shiftDateKey(dateKey, -1) });
        if (previous?.events.at(-1)?.type === 'IN') attendance = previous;
      }
    }
  }
  res.json({ success: true, message: 'Today\'s attendance', data: { attendance } });
}

export async function listAttendance(req, res) {
  const query = req.validatedQuery ?? req.query;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const filter = {};
  if (query.date) filter.dateKey = query.date;
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.office) filter.office = query.office;
  let allowedEmployeeIds = null;
  const narrowEmployeeIds = (ids) => {
    const values = ids.map((id) => id.toString());
    allowedEmployeeIds = allowedEmployeeIds === null ? values : allowedEmployeeIds.filter((id) => values.includes(id));
  };
  if (query.employee) {
    const escaped = query.employee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = await Employee.find({ employeeId: { $regex: escaped, $options: 'i' } }).select('_id');
    narrowEmployeeIds(matches.map(({ _id }) => _id));
  }
  const employeeFilter = {};
  if (query.department) employeeFilter.department = query.department;
  if (query.shift) employeeFilter.shift = query.shift;
  if (Object.keys(employeeFilter).length) {
    const matches = await Employee.find(employeeFilter).select('_id');
    narrowEmployeeIds(matches.map(({ _id }) => _id));
  }
  if (req.auth.role === ROLES.MANAGER) {
    const team = req.auth.employeeId ? await Employee.find({ manager: req.auth.employeeId }).select('_id') : [];
    const teamIds = [...team.map(({ _id }) => _id.toString()), ...(req.auth.employeeId ? [req.auth.employeeId] : [])];
    narrowEmployeeIds(teamIds);
  }
  if (allowedEmployeeIds !== null) filter.employee = { $in: allowedEmployeeIds };
  if (query.from || query.to) {
    filter.dateKey = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
  }
  const [items, total] = await Promise.all([
    Attendance.find(filter).select('-events.verification.providerReference').populate('employee', 'employeeId firstName lastName department').populate('office', 'name').sort({ dateKey: -1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
    Attendance.countDocuments(filter),
  ]);
  res.json({ success: true, message: 'Attendance records', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function listMyAttendance(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const [items, total] = await Promise.all([
    Attendance.find({ employee: req.auth.employeeId }).select('-events.verification.providerReference').sort({ dateKey: -1 }).skip((page - 1) * limit).limit(limit),
    Attendance.countDocuments({ employee: req.auth.employeeId }),
  ]);
  res.json({ success: true, message: 'Your attendance history', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export const correctionSchema = z.object({
  type: z.enum(['IN', 'OUT']),
  occurredAt: z.coerce.date(),
  reason: z.string().trim().min(8).max(1000),
});

export async function correctAttendance(req, res) {
  const attendance = await Attendance.findById(req.params.id);
  if (!attendance) throw new HttpError(404, 'Attendance record not found', 'ATTENDANCE_NOT_FOUND');
  const employee = await Employee.findById(attendance.employee).populate('office').populate('shift');
  if (!employee) throw new HttpError(404, 'Employee profile not found', 'EMPLOYEE_NOT_FOUND');
  if (req.body.occurredAt > new Date() || dateKeyInTimeZone(req.body.occurredAt, env.OFFICE_TIME_ZONE) !== attendance.dateKey) {
    throw new HttpError(422, 'Correction time must be on the attendance date and cannot be in the future', 'INVALID_CORRECTION_TIME');
  }
  assertAlternatingAttendanceEvent(attendance.events, req.body.type, req.body.occurredAt);
  attendance.events.push({
    type: req.body.type,
    occurredAt: req.body.occurredAt,
    method: 'manual',
    verification: { faceMatched: false, livenessPassed: false },
    location: {
      latitude: employee.office?.latitude ?? 0,
      longitude: employee.office?.longitude ?? 0,
      accuracyMeters: 0,
      distanceMeters: 0,
    },
    correctedBy: req.auth.userId,
    correctionReason: req.body.reason,
  });
  attendance.events.sort((a, b) => a.occurredAt - b.occurredAt);
  attendance.netWorkingMinutes = calculateNetWorkingMinutes(attendance.events, employee.shift?.breakMinutes ?? 0);
  attendance.status = 'manual_review';
  await attendance.save();
  await AuditLog.create({ actor: req.auth.userId, action: 'attendance.corrected', entityType: 'Attendance', entityId: attendance.id, reason: req.body.reason, ipAddress: req.ip });
  res.json({ success: true, message: 'Attendance corrected', data: { attendance } });
}
