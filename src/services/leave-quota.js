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
  const unpaidKeys = new Set();
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
    if (keys.length) covered.push({ keys, days });
  }
  let unallocated = Math.max(0, quota);
  for (const item of covered.sort((a, b) => a.keys[0].localeCompare(b.keys[0]))) {
    if (item.days <= unallocated) {
      item.keys.forEach((key) => paidKeys.add(key));
      unallocated -= item.days;
    } else {
      item.keys.forEach((key) => unpaidKeys.add(key));
    }
  }
  return { paidKeys, unpaidKeys, used, pending, remaining: Math.max(0, Math.round((quota - used) * 100) / 100) };
}

export async function loadLeaveQuotaContext({ monthKey, employees }) {
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
