export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  HR_ADMIN: 'hr_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
});

export const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN];
export const MANAGER_ROLES = [...ADMIN_ROLES, ROLES.MANAGER];

const ROLE_RANK = { [ROLES.EMPLOYEE]: 1, [ROLES.MANAGER]: 2, [ROLES.HR_ADMIN]: 3, [ROLES.SUPER_ADMIN]: 4 };

export function canManageAccount(actorRole, targetRole) {
  if (actorRole === ROLES.SUPER_ADMIN) return true;
  return (ROLE_RANK[actorRole] ?? 0) > (ROLE_RANK[targetRole] ?? 99);
}
