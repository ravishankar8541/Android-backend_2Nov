import { HttpError } from '../utils/http-error.js';
import { dateKeyInTimeZone } from '../utils/date.js';
import { env } from '../config/env.js';
import { calculateNetWorkingMinutes } from './attendance-rules.js';

function idOf(value) {
  const raw = value?._id ?? value?.id ?? value;
  return raw ? String(raw) : null;
}

function at(event) {
  return new Date(event.occurredAt).valueOf();
}

function seconds(event) {
  return Math.round(at(event) / 1000);
}

function differs(event, desired) {
  return event.type !== desired.type
    || seconds(event) !== seconds(desired)
    || event.method !== desired.method
    || Boolean(event.verification?.faceMatched) !== Boolean(desired.faceMatched)
    || Boolean(event.verification?.livenessPassed) !== Boolean(desired.livenessPassed)
    || Number(event.location?.latitude) !== Number(desired.latitude)
    || Number(event.location?.longitude) !== Number(desired.longitude)
    || Number(event.location?.accuracyMeters) !== Number(desired.accuracyMeters)
    || Number(event.location?.distanceMeters) !== Number(desired.distanceMeters);
}

function write(event, desired) {
  event.type = desired.type;
  event.occurredAt = new Date(desired.occurredAt);
  event.method = desired.method;
  if (!event.verification) event.verification = {};
  event.verification.faceMatched = Boolean(desired.faceMatched);
  event.verification.livenessPassed = Boolean(desired.livenessPassed);
  if (!event.location) event.location = {};
  event.location.latitude = Number(desired.latitude);
  event.location.longitude = Number(desired.longitude);
  event.location.accuracyMeters = Number(desired.accuracyMeters);
  event.location.distanceMeters = Number(desired.distanceMeters);
}

/**
 * Ordered events must read IN, OUT, IN, OUT with no shared timestamp, otherwise the
 * day cannot be summed into worked minutes.
 */
export function assertAlternatingEventList(events) {
  const ordered = [...events].sort((left, right) => at(left) - at(right));
  ordered.forEach((event, index) => {
    if (index > 0 && seconds(ordered[index - 1]) === seconds(event)) {
      throw new HttpError(409, 'Two attendance events cannot share the same time', 'DUPLICATE_ATTENDANCE_EVENT');
    }
    if (event.type !== (index % 2 === 0 ? 'IN' : 'OUT')) {
      throw new HttpError(409, 'Attendance events must alternate check-in then check-out', 'INVALID_ATTENDANCE_SEQUENCE');
    }
  });
  return ordered;
}

function shiftToDay(occurredAt, fromKey, toKey) {
  const offset = new Date(`${toKey}T00:00:00`).getTime() - new Date(`${fromKey}T00:00:00`).getTime();
  return new Date(new Date(occurredAt).getTime() + offset);
}

/**
 * Applies an admin's edit to an attendance record in place, so events they did not
 * touch keep their stored biometric reference. Returns the field diff for the audit log.
 *
 * Sending `events` replaces the day's events and is authoritative about times; sending
 * only `dateKey` moves every event to the new day and preserves its clock time.
 */
export function applyAttendanceEdit({ attendance, employee, payload, actorId, reason, now = new Date(), timeZone = env.OFFICE_TIME_ZONE }) {
  const changes = [];
  const note = (field, before, after) => {
    if (String(before ?? '') !== String(after ?? '')) changes.push({ field, before: before ?? null, after: after ?? null });
  };
  const stamp = (event) => {
    event.correctedBy = actorId;
    event.correctionReason = reason;
  };

  const previousDateKey = attendance.dateKey;
  const dateKey = payload.dateKey ?? previousDateKey;
  let added = 0;
  let removed = 0;
  let modified = 0;

  if (payload.events) {
    const matched = new Map();
    for (const desired of payload.events) {
      const existing = desired._id
        ? attendance.events.find((event) => idOf(event) === String(desired._id) && !matched.has(event))
        : null;
      if (existing) matched.set(existing, desired);
    }
    for (let index = attendance.events.length - 1; index >= 0; index -= 1) {
      if (!matched.has(attendance.events[index])) {
        attendance.events.splice(index, 1);
        removed += 1;
      }
    }
    for (const [existing, desired] of matched) {
      if (differs(existing, desired)) {
        write(existing, desired);
        stamp(existing);
        modified += 1;
      }
    }
    const matchedDesired = new Set(matched.values());
    for (const desired of payload.events) {
      if (matchedDesired.has(desired)) continue;
      attendance.events.push({
        type: desired.type,
        occurredAt: new Date(desired.occurredAt),
        method: desired.method,
        verification: { faceMatched: Boolean(desired.faceMatched), livenessPassed: Boolean(desired.livenessPassed) },
        location: {
          latitude: Number(desired.latitude),
          longitude: Number(desired.longitude),
          accuracyMeters: Number(desired.accuracyMeters),
          distanceMeters: Number(desired.distanceMeters),
        },
        deviceId: desired.deviceId || null,
        correctedBy: actorId,
        correctionReason: reason,
      });
      added += 1;
    }
    assertAlternatingEventList(attendance.events);
    attendance.events.sort((left, right) => at(left) - at(right));
  } else if (dateKey !== previousDateKey) {
    for (const event of attendance.events) {
      event.occurredAt = shiftToDay(event.occurredAt, previousDateKey, dateKey);
      stamp(event);
      modified += 1;
    }
  }

  if (dateKey !== previousDateKey) {
    note('dateKey', previousDateKey, dateKey);
    attendance.dateKey = dateKey;
  }
  if (payload.employee && idOf(attendance.employee) !== String(payload.employee)) {
    note('employee', idOf(attendance.employee), String(payload.employee));
    attendance.employee = payload.employee;
  }
  if (payload.office && idOf(attendance.office) !== String(payload.office)) {
    note('office', idOf(attendance.office), String(payload.office));
    attendance.office = payload.office;
  }
  if (payload.status && attendance.status !== payload.status) {
    note('status', attendance.status, payload.status);
    attendance.status = payload.status;
  }

  for (const event of attendance.events) {
    const day = dateKeyInTimeZone(new Date(event.occurredAt), timeZone);
    if (day !== attendance.dateKey) {
      throw new HttpError(422, `A check ${event.type === 'IN' ? 'in' : 'out'} falls on ${day}, but this record belongs to ${attendance.dateKey}`, 'ATTENDANCE_DATE_MISMATCH');
    }
    if (new Date(event.occurredAt) > now) {
      throw new HttpError(422, 'Attendance cannot be recorded in the future', 'ATTENDANCE_IN_FUTURE');
    }
  }

  const netWorkingMinutes = payload.netWorkingMinutes ?? calculateNetWorkingMinutes(attendance.events, employee?.shift?.breakMinutes ?? 0);
  if (attendance.netWorkingMinutes !== netWorkingMinutes) {
    note('netWorkingMinutes', attendance.netWorkingMinutes, netWorkingMinutes);
    attendance.netWorkingMinutes = netWorkingMinutes;
  }

  return { changes, events: { added, removed, modified } };
}
