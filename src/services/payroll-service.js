import { Attendance } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { Payslip } from '../models/Payslip.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone, monthKeyInTimeZone } from '../utils/date.js';
import { amountInWords } from '../utils/amount-in-words.js';
import { buildPayslipDraft, monthRange, shiftMonthKey } from './payroll-engine.js';
import { loadLeaveQuotaContext } from './leave-quota.js';

const SALARY_KEYS = ['basic', 'hra', 'specialAllowance', 'bonus'];

export function currentMonthKey(date = new Date()) {
  return monthKeyInTimeZone(date, env.OFFICE_TIME_ZONE);
}

export function latestClosedMonthKey() {
  return shiftMonthKey(currentMonthKey(), -1);
}

function monthlyGross(salary) {
  return SALARY_KEYS.reduce((sum, key) => sum + (Number(salary?.[key]) || 0), 0);
}

async function loadMonthContext(monthKey, employees) {
  const { firstKey, lastKey } = monthRange(monthKey);
  const ids = employees.map(({ _id }) => _id);
  const [attendanceRows, quota] = await Promise.all([
    ids.length ? Attendance.find({ employee: { $in: ids }, dateKey: { $gte: firstKey, $lte: lastKey } }).select('employee dateKey status') : [],
    loadLeaveQuotaContext({ monthKey, employees }),
  ]);
  const attendanceByEmployee = new Map();
  for (const row of attendanceRows) {
    const key = row.employee.toString();
    if (!attendanceByEmployee.has(key)) attendanceByEmployee.set(key, new Map());
    attendanceByEmployee.get(key).set(row.dateKey, row.status);
  }
  return {
    attendanceByEmployee,
    leaveByEmployee: quota.summaries,
    holidayKeys: quota.holidayKeys,
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
  const context = await loadMonthContext(monthKey, payable);
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
      paidLeaveKeys: context.leaveByEmployee.get(employee.id)?.paidKeys ?? new Set(),
      unpaidLeaveKeys: context.leaveByEmployee.get(employee.id)?.unpaidKeys ?? new Set(),
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
