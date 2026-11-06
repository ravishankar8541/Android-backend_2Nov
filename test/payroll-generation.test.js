import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-payroll-generation-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { Employee } = await import('../src/models/Employee.js');
const { Attendance } = await import('../src/models/Attendance.js');
const { Holiday } = await import('../src/models/Holiday.js');
const { LeaveQuota } = await import('../src/models/LeaveQuota.js');
const { LeaveRequest } = await import('../src/models/LeaveRequest.js');
const { Payslip } = await import('../src/models/Payslip.js');
const { generatePayslipsForMonth } = await import('../src/services/payroll-service.js');
const { scheduleMonthlyPayroll } = await import('../src/services/payroll-scheduler.js');

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

const SALARY = { currency: 'INR', basic: 20000, hra: 0, specialAllowance: 0, bonus: 0, pfPercentage: 0, tds: 0, otherDeductions: 0 };
const EMPLOYEE_ID = '507f1f77bcf86cd799439011';
const RAYU = { _id: EMPLOYEE_ID, id: EMPLOYEE_ID, employeeId: 'VAM-01', firstName: 'Raju', lastName: 'Ali', designation: 'Developer', department: 'IT', joiningDate: new Date('2026-01-01'), shift: { weeklyOffDays: [0, 6] }, office: { name: 'Head Office' }, salary: SALARY };

function list(rows) {
  const query = { populate: () => query, select: () => Promise.resolve(rows), then: (resolve) => resolve(rows) };
  return query;
}

function wire({ employees = [RAYU], attendance = [], quotas = [{ employee: EMPLOYEE_ID, days: 2 }], requests = [], holidays = [], existing = [] } = {}) {
  const created = [];
  mock.method(Employee, 'find', () => list(employees));
  mock.method(Attendance, 'find', () => ({ select: () => Promise.resolve(attendance) }));
  mock.method(LeaveQuota, 'find', () => ({ select: () => Promise.resolve(quotas) }));
  mock.method(LeaveRequest, 'find', () => ({ select: () => Promise.resolve(requests) }));
  mock.method(Holiday, 'find', () => ({ select: () => Promise.resolve(holidays) }));
  mock.method(Payslip, 'find', () => ({ select: () => Promise.resolve(existing) }));
  mock.method(Payslip, 'create', async (doc) => { created.push(doc); return doc; });
  return created;
}

test('a generated draft carries the employee link the payslip schema requires', async () => {
  const created = wire();
  const summary = await generatePayslipsForMonth({ monthKey: '2026-09' });
  assert.equal(summary.created, 1);
  assert.equal(created[0].employee, EMPLOYEE_ID);
  assert.equal(created[0].netPay, 20000);
  assert.equal(created[0].amountInWords, 'Rupees Twenty Thousand Only');
  assert.equal(created[0].status, 'draft');
  assert.equal(created[0].manual, false);
  assert.ok(!new Payslip(created[0]).validateSync());
});

test('a month with no salary on file is counted as skipped instead of failing the run', async () => {
  const created = wire({ employees: [{ ...RAYU, salary: { ...SALARY, basic: 0 } }] });
  const summary = await generatePayslipsForMonth({ monthKey: '2026-09' });
  assert.equal(summary.created, 0);
  assert.equal(summary.skippedNoSalary, 1);
  assert.equal(created.length, 0);
});

test('a released slip is never overwritten by the automatic run', async () => {
  const created = wire({ existing: [{ id: 'p1', employee: { toString: () => EMPLOYEE_ID }, status: 'released', manual: false }] });
  const summary = await generatePayslipsForMonth({ monthKey: '2026-09' });
  assert.equal(summary.protectedCount, 1);
  assert.equal(created.length, 0);
});

test('a leftover beyond-quota request is what cuts the automatic payslip', async () => {
  const created = wire({
    quotas: [{ employee: EMPLOYEE_ID, days: 1 }],
    requests: [{ _id: 'r1', employee: EMPLOYEE_ID, startDate: new Date('2026-09-08T00:00:00.000Z'), endDate: new Date('2026-09-09T00:00:00.000Z'), status: 'approved', halfDay: false }],
  });
  await generatePayslipsForMonth({ monthKey: '2026-09' });
  assert.equal(created[0].attendance.lopDays, 2);
  assert.equal(created[0].deductions.find((line) => line.key === 'lop').amount, 1333);
  assert.equal(created[0].netPay, 18667);
});

test('the monthly timer never asks Node for a wait it would clamp to a spin', async () => {
  mock.timers.enable({ apis: ['Date'] });
  mock.timers.setTime(Date.UTC(2026, 0, 2, 4, 0));
  const delays = [];
  mock.method(globalThis, 'setTimeout', (handler, delay) => {
    delays.push(delay);
    return { unref() {} };
  });
  mock.method(Payslip, 'exists', async () => true);
  scheduleMonthlyPayroll();
  await Promise.resolve();
  const MAX = 2 ** 31 - 1;
  assert.ok(delays.length > 0);
  assert.ok(delays.every((delay) => delay <= MAX));
  assert.ok(delays.includes(MAX));
});
