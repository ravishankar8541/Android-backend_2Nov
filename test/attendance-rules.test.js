import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAlternatingAttendanceEvent, assertNextAttendanceEvent, calculateNetWorkingMinutes } from '../src/services/attendance-rules.js';

const at = (hour, minute = 0) => new Date(`2026-10-05T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);

test('check-in and check-out events must alternate', () => {
  assert.doesNotThrow(() => assertNextAttendanceEvent(null, 'IN'));
  assert.throws(() => assertNextAttendanceEvent(null, 'OUT'), (error) => error.status === 409 && error.code === 'INVALID_ATTENDANCE_SEQUENCE');
  assert.throws(() => assertNextAttendanceEvent('IN', 'IN'), (error) => error.status === 409 && error.code === 'INVALID_ATTENDANCE_SEQUENCE');
  assert.doesNotThrow(() => assertNextAttendanceEvent('OUT', 'IN'));
  assert.throws(() => assertNextAttendanceEvent('OUT', 'OUT'), (error) => error.status === 409 && error.code === 'INVALID_ATTENDANCE_SEQUENCE');
});

test('manual corrections preserve an alternating event timeline', () => {
  const events = [{ type: 'IN', occurredAt: at(9) }, { type: 'OUT', occurredAt: at(18) }];
  assert.doesNotThrow(() => assertAlternatingAttendanceEvent(events, 'IN', at(19)));
  assert.throws(() => assertAlternatingAttendanceEvent(events, 'IN', at(10)), (error) => error.code === 'INVALID_ATTENDANCE_SEQUENCE');
  assert.throws(() => assertAlternatingAttendanceEvent(events, 'OUT', at(18)), (error) => error.code === 'DUPLICATE_ATTENDANCE_EVENT');
});

test('work time subtracts a configured break for one session and sums multiple sessions', () => {
  assert.equal(calculateNetWorkingMinutes([{ type: 'IN', occurredAt: at(9) }, { type: 'OUT', occurredAt: at(18) }], 60), 480);
  assert.equal(calculateNetWorkingMinutes([
    { type: 'IN', occurredAt: at(9) }, { type: 'OUT', occurredAt: at(12) },
    { type: 'IN', occurredAt: at(12, 30) }, { type: 'OUT', occurredAt: at(18) },
  ], 60), 510);
  assert.equal(calculateNetWorkingMinutes([{ type: 'IN', occurredAt: at(9) }], 60), 0);
});
