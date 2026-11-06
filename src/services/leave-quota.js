import { Employee } from '../models/Employee.js';
import { LeaveQuota } from '../models/LeaveQuota.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Holiday } from '../models/Holiday.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone } from '../utils/date.js';
import { dateKeysBetween, monthRange, weekdayOfDateKey } from './payroll-engine.js';

function leaveDateKey(value) {
  return dateKeyInTimeZone(value, env.OFFICE_TIME_ZONE);
}

// Weekly offs and holidays are not working days, so a leave that covers them must not spend the quota.
function workingLeaveKeys(request, { firstKey, lastKey, weeklyOffDays, holidayKeys }) {
  const start = leaveDateKey(request.startDate) < firstKey ? firstKey : leaveDateKey(request.startDate);
  const end = leaveDateKey(request.endDate) > lastKey ? lastKey : leaveDateKey(request.endDate);
  if (start > end) return { keys: [], days: 0 };
  const keys = [];
  for (const dateKey of dateKeysBetween(start, end)) {
    if (holidayKeys.has(dateKey) || weeklyOffDays.includes(weekdayOfDateKey(dateKey))) continue;
    keys.push(dateKey);
  }
  return { keys, days: request.halfDay ? 0.5 : keys.length };
}

export function allocateMonthlyLeave({ requests, quota, firstKey, lastKey, weeklyOffDays, holidayKeys }) {
  const paidKeys = new Set();
  const halfPaidKeys = new Set();
  const unpaidKeys = new Set();
  const halfUnpaidKeys = new Set();
  let used = 0;
  let pending = 0;
  const covered = [];
  for (const request of requests) {
    const { keys, days } = workingLeaveKeys(request, { firstKey, lastKey, weeklyOffDays, holidayKeys });
    if (request.status === 'pending') {
      pending += days;
      continue;
    }
    used += days;
    if (keys.length) covered.push({ keys, days, half: days === 0.5 });
  }
  let unallocated = Math.max(0, quota);
  for (const item of covered.sort((a, b) => a.keys[0].localeCompare(b.keys[0]))) {
    const fits = item.days <= unallocated;
    if (fits) unallocated -= item.days;
    const target = fits ? (item.half ? halfPaidKeys : paidKeys) : (item.half ? halfUnpaidKeys : unpaidKeys);
    item.keys.forEach((key) => target.add(key));
  }
  return { paidKeys, halfPaidKeys, unpaidKeys, halfUnpaidKeys, used, pending, remaining: Math.max(0, Math.round((quota - used) * 100) / 100) };
}

export async function loadLeaveQuotaContext({ monthKey, employees, excludeRequestId = null }) {
  const { firstKey, lastKey } = monthRange(monthKey);
  const ids = employees.map((employee) => (employee._id ?? employee.id).toString());
  const [quotaRows, requests, holidays] = await Promise.all([
    ids.length ? LeaveQuota.find({ monthKey, employee: { $in: ids } }).select('employee days') : [],
    ids.length
      ? LeaveRequest.find({
        employee: { $in: ids },
        status: { $in: ['approved', 'pending'] },
        startDate: { $lte: new Date(`${lastKey}T23:59:59.000Z`) },
        endDate: { $gte: new Date(`${firstKey}T00:00:00.000Z`) },
      }).select('employee startDate endDate halfDay status')
      : [],
    Holiday.find({ date: { $gte: firstKey, $lte: lastKey }, active: true }).select('date'),
  ]);
  const holidayKeys = new Set(holidays.map(({ date }) => date));
  const assignedBy = new Map(quotaRows.map((row) => [row.employee.toString(), row.days]));
  const byEmployee = new Map();
  for (const employee of employees) byEmployee.set((employee._id ?? employee.id).toString(), []);
  for (const request of requests) {
    if (excludeRequestId && request._id.toString() === excludeRequestId) continue;
    const bucket = byEmployee.get(request.employee.toString());
    if (bucket) bucket.push(request);
  }
  const summaries = new Map();
  for (const employee of employees) {
    const id = (employee._id ?? employee.id).toString();
    const explicit = assignedBy.get(id);
    const quota = explicit ?? env.DEFAULT_MONTHLY_LEAVES;
    const allocation = allocateMonthlyLeave({
      requests: byEmployee.get(id),
      quota,
      firstKey,
      lastKey,
      weeklyOffDays: employee.shift?.weeklyOffDays ?? [0, 6],
      holidayKeys,
    });
    summaries.set(id, { ...allocation, assigned: quota, defaultApplied: explicit === undefined });
  }
  return { firstKey, lastKey, holidayKeys, summaries };
}

/**
 * Only the paid days the admin assigned for a month may be taken, so a range is measured in every
 * month its dates fall in and pending requests already hold their days: one assigned day can never
 * be promised twice. Returns null when the range still fits, otherwise the month that runs out first.
 */
export async function findQuotaOverage({ employeeId, startDate, endDate, halfDay = false, excludeRequestId = null }) {
  const employee = await Employee.findById(employeeId).populate('shift', 'weeklyOffDays');
  if (!employee) return null;
  const startKey = leaveDateKey(startDate);
  const endKey = leaveDateKey(endDate);
  if (startKey > endKey) return null;
  const months = [...new Set(dateKeysBetween(startKey, endKey).map((key) => key.slice(0, 7)))];
  for (const monthKey of months) {
    const { firstKey, lastKey, holidayKeys, summaries } = await loadLeaveQuotaContext({ monthKey, employees: [employee], excludeRequestId });
    const summary = summaries.get(employee.id);
    if (!summary) continue;
    const { days } = workingLeaveKeys({ startDate, endDate, halfDay }, {
      firstKey,
      lastKey,
      weeklyOffDays: employee.shift?.weeklyOffDays ?? [0, 6],
      holidayKeys,
    });
    if (!days) continue;
    const claimed = summary.used + summary.pending;
    if (claimed + days <= summary.assigned + 1e-9) continue;
    return {
      monthKey,
      assigned: summary.assigned,
      used: summary.used,
      pending: summary.pending,
      requested: days,
      available: Math.max(0, Math.round((summary.assigned - claimed) * 100) / 100),
    };
  }
  return null;
}
