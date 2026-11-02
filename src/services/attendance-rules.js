import { HttpError } from '../utils/http-error.js';

export function assertNextAttendanceEvent(lastType, type) {
  if ((type === 'IN' && lastType === 'IN') || (type === 'OUT' && lastType !== 'IN')) {
    throw new HttpError(409, type === 'IN' ? 'You are already checked in' : 'You need to check in before checking out', 'INVALID_ATTENDANCE_SEQUENCE');
  }
}

export function assertAlternatingAttendanceEvent(events, type, occurredAt) {
  const at = new Date(occurredAt).valueOf();
  const ordered = [...events].sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt));
  if (ordered.some((event) => new Date(event.occurredAt).valueOf() === at)) {
    throw new HttpError(409, 'An attendance event already exists at that time', 'DUPLICATE_ATTENDANCE_EVENT');
  }
  const next = ordered.find((event) => new Date(event.occurredAt) > at);
  const previous = [...ordered].reverse().find((event) => new Date(event.occurredAt) < at);
  if ((previous && previous.type === type) || (next && next.type === type)) {
    throw new HttpError(409, 'This correction would create duplicate IN or OUT events', 'INVALID_ATTENDANCE_SEQUENCE');
  }
}

export function calculateNetWorkingMinutes(events, breakMinutes = 0) {
  let openedAt = null;
  let totalMinutes = 0;
  let completedSessions = 0;
  for (const event of [...events].sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt))) {
    const at = new Date(event.occurredAt);
    if (event.type === 'IN') openedAt = at;
    else if (openedAt) {
      totalMinutes += Math.max(0, Math.round((at - openedAt) / 60000));
      completedSessions += 1;
      openedAt = null;
    }
  }
  if (completedSessions === 1) totalMinutes = Math.max(0, totalMinutes - breakMinutes);
  return totalMinutes;
}
