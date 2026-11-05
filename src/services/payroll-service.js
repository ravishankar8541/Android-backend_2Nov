import { Holiday } from '../models/Holiday.js';
import { Attendance } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { LeaveType } from '../models/LeaveType.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Payslip } from '../models/Payslip.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone, shiftDateKey } from '../utils/date.js';
import { amountInWords } from '../utils/amount-in-words.js';
import { buildPayslipDraft, monthRange, shiftMonthKey } from './payroll-engine.js';

const SALARY_KEYS = ['basic', 'hra', 'specialAllowance', 'bonus'];

export function currentMonthKey(date = new Date()) {
  return dateKeyInTimeZone(date, env.OFFICE_TIME_ZONE).slice(0, 7);
}

export function latestClosedMonthKey() {
  return shiftMonthKey(currentMonthKey(), -1);
}

function monthlyGross(salary) {
  return SALARY_KEYS.reduce((sum, key) => sum + (Number(salary?.[key]) || 0), 0);
}

function leaveDateKey(value) {
  return typeof value === 'string' ? value.slice(0, 10) : dateKeyInTimeZone(value, env.OFFICE_TIME_ZONE);
}

function expandLeaveKeys(startDate, endDate, firstKey, lastKey) {
  const start = leaveDateKey(startDate) < firstKey ? firstKey : leaveDateKey(startDate);
  const end = leaveDateKey(endDate) > lastKey ? lastKey : leaveDateKey(endDate);
  if (start > end) return [];
  const keys = [];
  let cursor = start;
  for (let guard = 0; guard <= 400 && cursor <= end; guard += 1) {
    keys.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return keys;
}

async function loadMonthContext(monthKey, employeeIds) {
  const { firstKey, lastKey } = monthRange(monthKey);
  const paidTypeIds = (await LeaveType.find({ paid: true, active: true }).select('_id')).map(({ _id }) => _id);
  const [attendanceRows, leaveRows, holidays] = await Promise.all([
    Attendance.find({ employee: { $in: employeeIds }, dateKey: { $gte: firstKey, $lte: lastKey } }).select('employee dateKey status'),
    LeaveRequest.find({
      employee: { $in: employeeIds },
      status: 'approved',
      leaveType: { $in: paidTypeIds },
      startDate: { $lte: new Date(`${lastKey}T23:59:59.000Z`) },
      endDate: { $gte: new Date(`${firstKey}T00:00:00.000Z`) },
    }).select('employee startDate endDate'),
    Holiday.find({ date: { $gte: firstKey, $lte: lastKey }, active: true }).select('date'),
  ]);
  const attendanceByEmployee = new Map();
  for (const row of attendanceRows) {
    const key = row.employee.toString();
    if (!attendanceByEmployee.has(key)) attendanceByEmployee.set(key, new Map());
    attendanceByEmployee.get(key).set(row.dateKey, row.status);
  }
  const leaveByEmployee = new Map();
  for (const row of leaveRows) {
    const key = row.employee.toString();
    if (!leaveByEmployee.has(key)) leaveByEmployee.set(key, new Set());
    const bucket = leaveByEmployee.get(key);
    for (const dateKey of expandLeaveKeys(row.startDate, row.endDate, firstKey, lastKey)) bucket.add(dateKey);
  }
  return {
    attendanceByEmployee,
    leaveByEmployee,
    holidayKeys: new Set(holidays.map(({ date }) => date)),
  };
}

export async function generatePayslipsForMonth({ monthKey, actorId = null, force = false }) {
  const employees = await Employee.find({ employmentStatus: 'active' })
    .populate('shift', 'weeklyOffDays')
    .populate('office', 'name');
  const payable = employees.filter((employee) => monthlyGross(employee.salary) > 0);
  const skippedNoSalary = employees.length - payable.length;
  const { firstKey, lastKey } = monthRange(monthKey);
  const ids = payable.map(({ _id }) => _id);
  const context = ids.length ? await loadMonthContext(monthKey, ids) : { attendanceByEmployee: new Map(), leaveByEmployee: new Map(), holidayKeys: new Set() };
  const existingRows = await Payslip.find({ monthKey, employee: { $in: ids } }).select('employee status manual');
  const existingByEmployee = new Map(existingRows.map((slip) => [slip.employee.toString(), slip]));
  const now = new Date();
  let created = 0;
  let updated = 0;
  let protectedCount = 0;
  const skipped = [];

  for (const employee of payable) {
    const existing = existingByEmployee.get(employee.id);
    if (existing && (existing.status === 'released' || existing.manual) && !force) {
      protectedCount += 1;
      skipped.push({ employeeId: employee.employeeId, reason: existing.status === 'released' ? 'released' : 'manually edited' });
      continue;
    }
    const draft = buildPayslipDraft({
      employee: {
        employeeId: employee.employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        designation: employee.designation,
        department: employee.department,
        office: employee.office,
        joiningKey: dateKeyInTimeZone(employee.joiningDate, env.OFFICE_TIME_ZONE),
        shift: employee.shift,
        salary: employee.salary,
      },
      monthKey,
      attendanceByDate: context.attendanceByEmployee.get(employee.id) ?? new Map(),
      paidLeaveKeys: context.leaveByEmployee.get(employee.id) ?? new Set(),
      holidayKeys: context.holidayKeys,
    });
    if (!draft) {
      skipped.push({ employeeId: employee.employeeId, reason: 'joined after this month' });
      continue;
    }
    const payload = {
      ...draft,
      amountInWords: amountInWords(draft.netPay, draft.currency),
      issueDate: now,
      generatedBy: actorId,
      generatedAt: now,
      manual: false,
    };
    if (existing) {
      await Payslip.updateOne({ _id: existing.id }, { $set: payload });
      updated += 1;
    } else {
      await Payslip.create(payload);
      created += 1;
    }
  }
  return { monthKey, range: { firstKey, lastKey }, employees: payable.length, created, updated, protectedCount, skippedNoSalary, skipped };
}

export async function releaseMonthDrafts({ monthKey, actorId }) {
  const result = await Payslip.updateMany({ monthKey, status: 'draft' }, { $set: { status: 'released', releasedBy: actorId, releasedAt: new Date() } });
  return { monthKey, released: result.modifiedCount };
}
