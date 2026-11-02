export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  HR_ADMIN: 'hr_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
});

export const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN];
export const MANAGER_ROLES = [...ADMIN_ROLES, ROLES.MANAGER];
