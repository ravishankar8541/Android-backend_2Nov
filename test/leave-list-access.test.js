import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeaveListFilter } from '../src/services/leave-list-access.js';
import { ROLES } from '../src/constants/roles.js';

test('employees can only list their own leave requests', () => {
  assert.deepEqual(buildLeaveListFilter({ role: ROLES.EMPLOYEE, employeeId: 'employee-1', status: 'pending' }), {
    employee: 'employee-1',
    status: 'pending',
  });
  assert.throws(
    () => buildLeaveListFilter({ role: ROLES.EMPLOYEE, employeeId: 'employee-1', requestedEmployeeId: 'employee-2' }),
    (error) => error.status === 403 && error.code === 'FORBIDDEN',
  );
});

test('managers can filter only within their own team', () => {
  const teamEmployeeIds = ['employee-2', 'employee-3'];
  assert.deepEqual(buildLeaveListFilter({ role: ROLES.MANAGER, teamEmployeeIds }), { employee: { $in: teamEmployeeIds } });
  assert.deepEqual(buildLeaveListFilter({ role: ROLES.MANAGER, teamEmployeeIds, requestedEmployeeId: 'employee-2' }), { employee: 'employee-2' });
  assert.throws(
    () => buildLeaveListFilter({ role: ROLES.MANAGER, teamEmployeeIds, requestedEmployeeId: 'employee-4' }),
    (error) => error.status === 403 && error.code === 'FORBIDDEN',
  );
});

test('HR admins can filter leave requests by any employee', () => {
  assert.deepEqual(buildLeaveListFilter({ role: ROLES.HR_ADMIN, requestedEmployeeId: 'employee-9', status: 'approved' }), {
    employee: 'employee-9',
    status: 'approved',
  });
});
