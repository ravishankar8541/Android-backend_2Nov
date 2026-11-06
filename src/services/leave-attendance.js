import { Attendance } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { Holiday } from '../models/Holiday.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone } from '../utils/date.js';
import { logger } from '../utils/logger.js';
import { dateKeysBetween, weekdayOfDateKey } from './payroll-engine.js';

/**
 * An approved leave has to show up in the attendance register, otherwise the day reads as an
 * unexplained gap that an admin can mark absent. The row is only a placeholder: a day that already
 * has check-in events keeps real attendance, because the employee actually came in.
 */
export async function markLeaveAttendance({ employeeId, startDate, endDate }) {
  const employee = await Employee.findById(employeeId).select('_id office').populate('shift', 'weeklyOffDays');
  // Attendance rows are scoped to an office, so a profile still waiting for one has no register to write into.
  if (!employee?.office) return 0;
  const startKey = dateKeyInTimeZone(startDate, env.OFFICE_TIME_ZONE);
  const endKey = dateKeyInTimeZone(endDate, env.OFFICE_TIME_ZONE);
  if (startKey > endKey) return 0;
  const weeklyOffDays = employee.shift?.weeklyOffDays ?? [0, 6];
  const holidays = await Holiday.find({ date: { $gte: startKey, $lte: endKey }, active: true }).select('date');
  const holidayKeys = new Set(holidays.map(({ date }) => date));
  let marked = 0;
  for (const dateKey of dateKeysBetween(startKey, endKey)) {
    if (holidayKeys.has(dateKey) || weeklyOffDays.includes(weekdayOfDateKey(dateKey))) continue;
    try {
      const row = await Attendance.findOne({ employee: employee._id, dateKey });
      if (!row) {
        await Attendance.create({ employee: employee._id, office: employee.office, dateKey, status: 'on_leave', events: [] });
        marked += 1;
        continue;
      }
      if (!row.events.length && row.status !== 'on_leave') {
        row.status = 'on_leave';
        await row.save();
        marked += 1;
      }
    } catch (error) {
      logger.error({ err: error, employeeId: employee.id, dateKey }, 'Unable to mark approved leave in attendance');
    }
  }
  return marked;
}
