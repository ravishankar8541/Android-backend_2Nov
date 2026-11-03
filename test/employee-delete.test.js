import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-employee-delete-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local', CLOUDINARY_URL: '',
});
const { Employee } = await import('../src/models/Employee.js');
const { User } = await import('../src/models/User.js');
const { Attendance } = await import('../src/models/Attendance.js');
const { AttendanceRegularization } = await import('../src/models/AttendanceRegularization.js');
const { LeaveRequest } = await import('../src/models/LeaveRequest.js');
const { Payslip } = await import('../src/models/Payslip.js');
const { FaceTemplate } = await import('../src/models/FaceTemplate.js');
const { BiometricSession } = await import('../src/models/BiometricSession.js');
const { Notification } = await import('../src/models/Notification.js');
const { PasswordResetRequest } = await import('../src/models/PasswordResetRequest.js');
const { AuditLog } = await import('../src/models/AuditLog.js');
const { deleteEmployee } = await import('../src/controllers/employee-controller.js');
afterEach(() => mock.restoreAll());

function setup({ employee, account, caller = 'admin-a' } = {}) {
  const removed = [];
  const doc = employee
    ? { ...employee, deleteOne: async () => { removed.push('employee'); } }
    : null;
  mock.method(Employee, 'findById', () => ({ select: async () => doc }));
  mock.method(Employee, 'updateMany', async (filter) => { removed.push(`reports:${filter.manager}`); return { modifiedCount: 0 }; });
  mock.method(User, 'findOne', () => ({ select: async () => (account ? { ...account, deleteOne: async () => { removed.push('account'); } } : null) }));
  const many = (name) => async () => { removed.push(name); return { deletedCount: 2 }; };
  mock.method(Attendance, 'deleteMany', many('attendance'));
  mock.method(LeaveRequest, 'deleteMany', many('leave'));
  mock.method(AttendanceRegularization, 'deleteMany', many('correction'));
  mock.method(Payslip, 'deleteMany', many('payslip'));
  mock.method(FaceTemplate, 'deleteOne', many('face'));
  mock.method(BiometricSession, 'deleteMany', many('session'));
  mock.method(Notification, 'deleteMany', many('notification'));
  mock.method(PasswordResetRequest, 'deleteMany', many('reset'));
  const audits = [];
  mock.method(AuditLog, 'create', async (entry) => { audits.push(entry); return entry; });
  const responses = [];
  return {
    removed,
    audits,
    responses,
    req: { auth: { userId: caller, role: 'hr_admin' }, ip: '127.0.0.1', params: { id: employee?._id ?? 'employee-z' } },
    res: { json: (body) => responses.push(body) },
  };
}

const profile = { _id: 'employee-a', id: 'employee-a', employeeId: 'VAM-014', firstName: 'Shubham', lastName: 'Kumar', photoPublicId: 'vam/employees/old' };

test('removing an employee clears their account, records and team links', async () => {
  const context = setup({ employee: profile, account: { id: 'user-a' } });
  await deleteEmployee(context.req, context.res);
  for (const expected of ['attendance', 'leave', 'correction', 'payslip', 'face', 'session', 'notification', 'reset', 'account', 'employee']) {
    assert.ok(context.removed.includes(expected), `${expected} was not removed`);
  }
  assert.deepEqual(context.responses[0].data, { employeeId: 'VAM-014', name: 'Shubham Kumar' });
  assert.equal(context.audits[0].action, 'employee.deleted');
  assert.deepEqual(context.audits[0].metadata, { employeeId: 'VAM-014', attendance: 2, leaves: 2, corrections: 2, payslips: 2 });
});

test('an employee with no sign-in account is still removed', async () => {
  const context = setup({ employee: profile, account: null });
  await deleteEmployee(context.req, context.res);
  assert.equal(context.removed.includes('account'), false);
  assert.ok(context.removed.includes('employee'));
});

test('nobody can delete the profile behind their own sign-in', async () => {
  const context = setup({ employee: profile, account: { id: 'admin-a' }, caller: 'admin-a' });
  await assert.rejects(deleteEmployee(context.req, context.res), { status: 400, code: 'EMPLOYEE_SELF_DELETE' });
  assert.deepEqual(context.removed, []);
  assert.equal(context.audits.length, 0);
});

test('an unknown employee id is reported before anything is removed', async () => {
  const context = setup({ employee: null });
  await assert.rejects(deleteEmployee(context.req, context.res), { status: 404, code: 'EMPLOYEE_NOT_FOUND' });
  assert.deepEqual(context.removed, []);
});
