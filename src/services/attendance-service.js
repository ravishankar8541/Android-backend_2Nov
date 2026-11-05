import { Attendance } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { Holiday } from '../models/Holiday.js';
import { env } from '../config/env.js';
import { dateKeyInTimeZone, shiftDateKey } from '../utils/date.js';
import { HttpError } from '../utils/http-error.js';
import { assertInsideOffice } from './geofence.js';
import { consumeAttendanceSession, releaseAttendanceSession, verifyAttendanceSession } from './biometric/provider.js';
import { assertNextAttendanceEvent, calculateNetWorkingMinutes } from './attendance-rules.js';

function minuteOfDay(date) {
  const pieces = new Intl.DateTimeFormat('en-GB', { timeZone: env.OFFICE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).split(':');
  return Number(pieces[0]) * 60 + Number(pieces[1]);
}

export async function markAttendance({ auth, body, type }) {
  if (!auth.employeeId) throw new HttpError(403, 'This account is not linked to an employee profile', 'EMPLOYEE_PROFILE_REQUIRED');
  const employee = await Employee.findById(auth.employeeId).populate('office').populate('shift');
  if (!employee || employee.employmentStatus !== 'active') throw new HttpError(403, 'Your employee profile is inactive', 'EMPLOYEE_INACTIVE');
  if (employee.faceCheck?.status === 'rejected') throw new HttpError(403, 'Your face check was declined. Capture a new one and ask HR to approve it.', 'FACE_CHECK_REJECTED');
  if (employee.faceCheck?.status === 'pending') throw new HttpError(403, 'An admin must approve your face check before you can mark attendance.', 'FACE_CHECK_PENDING');
  if (employee.attendanceVerification !== 'selfie' && employee.faceEnrollmentStatus === 'disabled') throw new HttpError(403, 'Face attendance is disabled for this employee. Contact HR.', 'FACE_ENROLLMENT_DISABLED');
  if (!employee.office?.active) throw new HttpError(409, 'No active office is assigned to your profile', 'OFFICE_NOT_ASSIGNED');
  if (!employee.shift?.active) throw new HttpError(409, 'No active shift is assigned to your profile', 'SHIFT_NOT_ASSIGNED');

  const recordedProofQuery = {
    employee: employee.id,
    events: { $elemMatch: { type, 'verification.providerReference': { $in: [`local:${body.verificationSessionId}`, `selfie:${body.verificationSessionId}`] } } },
  };
  // A retry after a lost response returns the saved event instead of duplicating it.
  const recorded = await Attendance.findOne(recordedProofQuery);
  if (recorded) return recorded;

  // The server recomputes face matching; passive liveness comes from the client SDK.
  const biometric = await verifyAttendanceSession({ sessionId: body.verificationSessionId, employeeId: employee.id, eventType: type });
  if (!biometric.selfie && (!biometric.livenessPassed || !biometric.faceMatched)) throw new HttpError(403, 'Face verification failed', 'FACE_VERIFICATION_FAILED');

  const location = { latitude: body.latitude, longitude: body.longitude, accuracyMeters: body.accuracyMeters };
  const distanceMeters = assertInsideOffice(location, employee.office);
  const occurredAt = new Date();
  const calendarDateKey = dateKeyInTimeZone(occurredAt, env.OFFICE_TIME_ZONE);
  const [shiftStartHour, shiftStartMinute] = employee.shift.startTime.split(':').map(Number);
  const [shiftEndHour, shiftEndMinute] = employee.shift.endTime.split(':').map(Number);
  const shiftStartsAt = shiftStartHour * 60 + shiftStartMinute;
  const shiftEndsAt = shiftEndHour * 60 + shiftEndMinute;
  const overnightShift = shiftEndsAt <= shiftStartsAt;
  const currentMinute = minuteOfDay(occurredAt);
  const dateKey = type === 'IN' && overnightShift && currentMinute <= shiftEndsAt + 240
    ? shiftDateKey(calendarDateKey, -1)
    : calendarDateKey;
  let attendance = await Attendance.findOne({ employee: employee.id, dateKey });
  let lastEvent = attendance?.events.at(-1);
  if (type === 'OUT' && overnightShift && (!lastEvent || lastEvent.type === 'OUT') && currentMinute <= shiftEndsAt + 240) {
    const overnightAttendance = await Attendance.findOne({ employee: employee.id, dateKey: shiftDateKey(calendarDateKey, -1) });
    if (overnightAttendance?.events.at(-1)?.type === 'IN') attendance = overnightAttendance;
    lastEvent = attendance?.events.at(-1);
  }
  assertNextAttendanceEvent(lastEvent?.type ?? null, type);

  if (!attendance) {
    if (type !== 'IN') throw new HttpError(409, 'You need to check in before checking out', 'INVALID_ATTENDANCE_SEQUENCE');
    const shift = employee.shift;
    const weekDay = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
    const isCompanyHoliday = await Holiday.exists({ date: dateKey, active: true, category: { $in: ['company', 'national', 'festival'] } });
    let status = shift.weeklyOffDays.includes(weekDay) || isCompanyHoliday ? 'overtime' : 'present';
    if (status === 'present') {
      const shiftMinute = overnightShift && currentMinute < shiftEndsAt ? currentMinute + 1440 : currentMinute;
      if (shiftMinute > shiftStartsAt + shift.graceMinutes) status = 'late';
    }
    attendance = new Attendance({ employee: employee.id, office: employee.office.id, dateKey, status, events: [] });
  }

  attendance.events.push({
    type,
    occurredAt,
    method: biometric.selfie ? 'selfie_photo' : 'face_liveness',
    verification: biometric.selfie
      ? { faceMatched: false, livenessPassed: false, providerReference: biometric.reference, photoUrl: biometric.photoUrl, photoPublicId: biometric.photoPublicId }
      : { faceMatched: true, livenessPassed: true, providerReference: biometric.reference },
    location: { ...location, distanceMeters },
    deviceId: body.deviceId || null,
  });
  if (type === 'OUT') {
    const minutes = calculateNetWorkingMinutes(attendance.events, employee.shift.breakMinutes);
    attendance.netWorkingMinutes = minutes;

    const shiftMinutes = shiftEndsAt > shiftStartsAt ? shiftEndsAt - shiftStartsAt : shiftEndsAt + 1440 - shiftStartsAt;
    const scheduledMinutes = Math.max(0, shiftMinutes - employee.shift.breakMinutes);
    const workDay = new Date(`${attendance.dateKey}T12:00:00.000Z`).getUTCDay();
    const isCompanyHoliday = await Holiday.exists({ date: attendance.dateKey, active: true, category: { $in: ['company', 'national', 'festival'] } });
    if (employee.shift.weeklyOffDays.includes(workDay) || isCompanyHoliday) attendance.status = 'overtime';
    else if (scheduledMinutes > 0 && minutes < scheduledMinutes / 2) attendance.status = 'half_day';
    else if (minuteOfDay(occurredAt) < shiftEndsAt) attendance.status = 'early_leave';
    else if (scheduledMinutes > 0 && minutes > scheduledMinutes + 30) attendance.status = 'overtime';
    else if (attendance.status !== 'late') attendance.status = 'present';
  }
  await attendance.validate();
  const claimedAt = await consumeAttendanceSession(biometric.session);
  try {
    await attendance.save();
  } catch (error) {
    const noWrite = error?.name === 'VersionError' || error?.name === 'ValidationError' || error?.code === 11000;
    if (noWrite) {
      await releaseAttendanceSession(biometric.session, claimedAt);
      if (error?.name === 'VersionError' || error?.code === 11000) {
        throw new HttpError(409, 'Attendance changed during this request. Refresh attendance and try again.', 'ATTENDANCE_CONFLICT');
      }
    } else {
      // A network error can occur after MongoDB committed the write. Never release
      // an ambiguous proof; recover the exact event if it was committed.
      const recovered = await Attendance.findOne(recordedProofQuery).catch(() => null);
      if (recovered) return recovered;
    }
    throw error;
  }
  return attendance;
}
