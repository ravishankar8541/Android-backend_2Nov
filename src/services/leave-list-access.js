import { ROLES } from '../constants/roles.js';
import { HttpError } from '../utils/http-error.js';

export function buildLeaveListFilter({ role, employeeId, requestedEmployeeId, teamEmployeeIds = [], status }) {
  const filter = {};
  if (status && status !== 'all') filter.status = status;

  if (role === ROLES.EMPLOYEE) {
    if (!employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
    if (requestedEmployeeId && requestedEmployeeId !== employeeId) {
      throw new HttpError(403, 'You can only view your own leave requests', 'FORBIDDEN');
    }
    filter.employee = employeeId;
  } else if (role === ROLES.MANAGER) {
    const teamIds = teamEmployeeIds.map((id) => id.toString());
    if (requestedEmployeeId) {
      if (!teamIds.includes(requestedEmployeeId.toString())) {
        throw new HttpError(403, 'You can only view leave requests from your direct team', 'FORBIDDEN');
      }
      filter.employee = requestedEmployeeId;
    } else {
      filter.employee = { $in: teamEmployeeIds };
    }
  } else if (requestedEmployeeId) {
    filter.employee = requestedEmployeeId;
  }

  return filter;
}
