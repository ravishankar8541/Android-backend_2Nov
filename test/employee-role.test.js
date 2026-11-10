import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-employee-role-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local', CLOUDINARY_URL: '',
});
const { Employee } = await import('../src/models/Employee.js');
const { User } = await import('../src/models/User.js');
const { AuditLog } = await import('../src/models/AuditLog.js');
const { updateEmployee, getEmployee } = await import('../src/controllers/employee-controller.js');
afterEach(() => mock.restoreAll());

const profile = { _id: 'employee-a', id: 'employee-a', employeeId: 'VAM-014', firstName: 'Shubham', lastName: 'Kumar', employmentStatus: 'active' };

function setup({ caller = 'user-admin', callerRole = 'super_admin', account = { id: 'user-target', role: 'employee' }, body = {}, employee = profile } = {}) {
  const saved = [];
  const updates = [];
  const audits = [];
  const responses = [];
  const doc = { ...employee, save: async () => { saved.push(employee._id); } };
  mock.method(Employee, 'findById', () => doc);
  mock.method(User, 'findOne', () => ({ select: async () => account }));
  mock.method(User, 'updateOne', async (filter, update) => { updates.push({ filter, update }); return { modifiedCount: 1 }; });
  mock.method(AuditLog, 'create', async (entry) => { audits.push(entry); return entry; });
  return {
    saved, updates, audits,
    req: { auth: { userId: caller, role: callerRole, employeeId: 'employee-x' }, ip: '127.0.0.1', params: { id: employee?._id ?? 'employee-a' }, body },
    res: { json: (body_) => responses.push(body_) },
    responses,
  };
}

test('a super admin promotes an employee account and records the change', async () => {
  const context = setup({ body: { role: 'manager' } });
  await updateEmployee(context.req, context.res);
  assert.deepEqual(context.updates, [{ filter: { _id: 'user-target' }, update: { $set: { role: 'manager' } } }]);
  assert.deepEqual(context.audits[0].metadata, { roleChange: { from: 'employee', to: 'manager' } });
  assert.deepEqual(context.saved, ['employee-a']);
});

test('an hr admin cannot touch an account at their own rank or above', async () => {
  for (const currentRole of ['hr_admin', 'super_admin']) {
    const context = setup({ callerRole: 'hr_admin', account: { id: 'user-target', role: currentRole }, body: { role: 'employee' } });
    await assert.rejects(updateEmployee(context.req, context.res), { status: 403, code: 'ACCOUNT_RANK_TOO_HIGH' });
    assert.deepEqual(context.saved, [], 'profile must not be half-saved when the role is refused');
    assert.deepEqual(context.updates, []);
  }
});

test('an hr admin cannot hand out hr admin or super admin', async () => {
  for (const wanted of ['hr_admin', 'super_admin']) {
    const context = setup({ callerRole: 'hr_admin', body: { role: wanted } });
    await assert.rejects(updateEmployee(context.req, context.res), { status: 403, code: 'ACCOUNT_RANK_TOO_HIGH' });
    assert.deepEqual(context.saved, []);
  }
});

test('nobody changes the role of their own sign-in account', async () => {
  const context = setup({ caller: 'user-target', account: { id: 'user-target', role: 'employee' }, body: { role: 'manager' } });
  await assert.rejects(updateEmployee(context.req, context.res), { status: 400, code: 'ACCOUNT_ROLE_SELF' });
  assert.deepEqual(context.updates, []);
  assert.deepEqual(context.saved, []);
});

test('saving other fields leaves an unchanged role alone', async () => {
  const context = setup({ body: { role: 'manager', designation: 'Team lead' }, account: { id: 'user-target', role: 'manager' } });
  await updateEmployee(context.req, context.res);
  assert.deepEqual(context.updates, []);
  assert.deepEqual(context.audits[0].metadata, {});
  assert.equal(context.saved.length, 1);
});

test('a profile with no sign-in account reports it before anything is written', async () => {
  const context = setup({ account: null, body: { role: 'manager' } });
  await assert.rejects(updateEmployee(context.req, context.res), { status: 409, code: 'ACCOUNT_NOT_FOUND' });
  assert.deepEqual(context.saved, []);
});

function detail({ callerRole, managerId = null, account = { id: 'user-target', role: 'manager' } }) {
  const responses = [];
  const doc = { ...profile, manager: managerId ? { id: managerId } : null };
  const query = { populate: () => query, select: () => query, then: (resolve) => resolve(doc) };
  mock.method(Employee, 'findById', () => query);
  mock.method(User, 'findOne', () => ({ select: async () => account }));
  return {
    req: { auth: { userId: 'user-admin', role: callerRole, employeeId: 'employee-x' }, ip: '127.0.0.1', params: { id: 'employee-a' }, query: {} },
    res: { json: (body) => responses.push(body) },
    responses,
  };
}

test('the edit dialog reads the account role back from the detail endpoint', async () => {
  const context = detail({ callerRole: 'super_admin', account: { id: 'user-target', role: 'employee' } });
  await getEmployee(context.req, context.res);
  assert.equal(context.responses[0].data.accountRole, 'employee');
});

test('a manager never sees the account role of their team member', async () => {
  const context = detail({ callerRole: 'manager', managerId: 'employee-x' });
  await getEmployee(context.req, context.res);
  assert.equal(context.responses[0].data.accountRole, null);
});
