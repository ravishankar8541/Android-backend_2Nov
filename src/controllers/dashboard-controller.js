import { Attendance } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Holiday } from '../models/Holiday.js';
import { ROLES } from '../constants/roles.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone, shiftDateKey, startOfDateKey } from '../utils/date.js';

export async function getSummary(req, res) {
  const now = new Date();
  const today = dateKeyInTimeZone(now, env.OFFICE_TIME_ZONE);
  const team = req.auth.role === ROLES.MANAGER
    ? (req.auth.employeeId ? await Employee.find({ manager: req.auth.employeeId }).select('_id') : [])
    : null;
  const teamIds = team?.map(({ _id }) => _id) ?? null;
  const employeeFilter = { employmentStatus: 'active', ...(teamIds ? { _id: { $in: teamIds } } : {}) };
  const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  const employeeStats = await Employee.aggregate([
    { $match: employeeFilter },
    { $lookup: { from: 'shifts', localField: 'shift', foreignField: '_id', as: 'shiftConfig' } },
    { $unwind: { path: '$shiftConfig', preserveNullAndEmptyArrays: true } },
    { $group: { _id: null, employeeTotal: { $sum: 1 }, scheduledToday: { $sum: { $cond: [{ $in: [weekday, { $ifNull: ['$shiftConfig.weeklyOffDays', [0, 6]] }] }, 0, 1] } } } },
  ]);
  const employeeTotal = employeeStats[0]?.employeeTotal ?? 0;
  const scheduledToday = employeeStats[0]?.scheduledToday ?? 0;
  const attendanceFilter = { dateKey: today, ...(teamIds ? { employee: { $in: teamIds } } : {}) };
  const [todayRows, pendingLeaves, companyHoliday] = await Promise.all([
    Attendance.find(attendanceFilter).populate('employee', 'employeeId firstName lastName department').populate('office', 'name').sort({ updatedAt: -1 }).limit(12),
    LeaveRequest.countDocuments({ status: 'pending', ...(teamIds ? { employee: { $in: teamIds } } : {}) }),
    Holiday.exists({ date: today, active: true, category: { $in: ['company', 'national', 'festival'] } }),
  ]);
  const presentToday = await Attendance.countDocuments({ ...attendanceFilter, 'events.type': 'IN' });
  const lateToday = await Attendance.countDocuments({ ...attendanceFilter, status: 'late' });
  const dayStart = startOfDateKey(today);
  const nextDayStart = startOfDateKey(shiftDateKey(today, 1));
  const onLeave = await LeaveRequest.countDocuments({ status: 'approved', startDate: { $lt: nextDayStart }, endDate: { $gte: dayStart }, ...(teamIds ? { employee: { $in: teamIds } } : {}) });

  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (6 - i));
    return dateKeyInTimeZone(day, env.OFFICE_TIME_ZONE);
  });
  const trendRows = await Attendance.aggregate([
    { $match: { dateKey: { $in: days }, ...(teamIds ? { employee: { $in: teamIds } } : {}) } },
    { $group: { _id: '$dateKey', present: { $sum: 1 }, late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } } } },
  ]);
  const trendMap = new Map(trendRows.map((row) => [row._id, row]));
  const recent = todayRows.map((row) => {
    const firstIn = row.events.find((event) => event.type === 'IN');
    const lastOut = [...row.events].reverse().find((event) => event.type === 'OUT');
    return {
      id: row.id,
      employee: row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : 'Unknown employee',
      employeeId: row.employee?.employeeId ?? '',
      department: row.employee?.department ?? '',
      office: row.office?.name ?? '',
      checkIn: firstIn?.occurredAt ?? null,
      checkOut: lastOut?.occurredAt ?? null,
      workingMinutes: row.netWorkingMinutes,
      status: row.status,
      verified: Boolean(firstIn?.verification?.livenessPassed && firstIn?.verification?.faceMatched),
    };
  });

  res.json({ success: true, message: 'Dashboard summary', data: {
    date: today,
    metrics: { employeeTotal, presentToday, lateToday, absentToday: companyHoliday ? 0 : Math.max(0, scheduledToday - presentToday - onLeave), onLeave, pendingLeaves },
    trend: days.map((date) => ({ date, present: trendMap.get(date)?.present ?? 0, late: trendMap.get(date)?.late ?? 0 })),
    recentAttendance: recent,
  } });
}
