import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-payroll-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { buildPayslipDraft, computePayDays, monthRange, recalculate, shiftMonthKey } = await import('../src/services/payroll-engine.js');
const { amountInWords } = await import('../src/utils/amount-in-words.js');

const SALARY = { currency: 'INR', basic: 14000, hra: 0, specialAllowance: 0, bonus: 0, pfPercentage: 0, tds: 0, otherDeductions: 0, pan: '', aadhaar: '', bankAccount: '', ifsc: '' };
const EMPLOYEE = { employeeId: 'VAM-2BAC', firstName: 'Ravi', lastName: 'Ray', designation: 'Full Stack Developer', department: 'Engineering', joiningKey: '2026-03-24', shift: { weeklyOffDays: [0, 6] }, salary: SALARY };
const empty = { attendanceByDate: new Map(), paidLeaveKeys: new Set(), holidayKeys: new Set() };

function draft(overrides = {}) {
  return buildPayslipDraft({ employee: { ...EMPLOYEE, ...overrides.employee }, monthKey: '2026-09', ...empty, ...overrides });
}

test('a month with no absences pays the full salary and records no loss of pay', () => {
  const slip = draft();
  assert.equal(slip.attendance.totalDays, 30);
  assert.equal(slip.attendance.paidDays, 30);
  assert.equal(slip.attendance.lopDays, 0);
  assert.equal(slip.grossEarnings, 14000);
  assert.equal(slip.totalDeductions, 0);
  assert.equal(slip.netPay, 14000);
  assert.equal(slip.ref, 'VAM/PAY/VAM-2BAC/Sep/2026');
});

test('only days explicitly marked absent cut salary, and a weekly off never does', () => {
  const attendanceByDate = new Map([['2026-09-15', 'absent'], ['2026-09-06', 'absent']]);
  const slip = draft({ attendanceByDate });
  assert.equal(slip.attendance.paidDays, 29);
  assert.equal(slip.attendance.lopDays, 1);
  assert.equal(slip.deductions.find((line) => line.key === 'lop').amount, 467);
  assert.equal(slip.netPay, 13533);
});

test('a half day and an approved paid leave both keep their day payable in part or full', () => {
  const halfDay = draft({ attendanceByDate: new Map([['2026-09-10', 'half_day']]) });
  assert.equal(halfDay.attendance.lopDays, 0.5);
  assert.equal(halfDay.deductions.find((line) => line.key === 'lop').amount, 233);
  const onLeave = draft({ attendanceByDate: new Map([['2026-09-11', 'absent']]), paidLeaveKeys: new Set(['2026-09-11']) });
  assert.equal(onLeave.attendance.lopDays, 0);
});

test('leave inside the monthly quota stays paid and only the days over it cut salary', () => {
  const withinQuota = draft({ paidLeaveKeys: new Set(['2026-09-15', '2026-09-16']) });
  assert.equal(withinQuota.attendance.lopDays, 0);
  assert.equal(withinQuota.netPay, 14000);
  const beyondQuota = draft({ paidLeaveKeys: new Set(['2026-09-15']), unpaidLeaveKeys: new Set(['2026-09-21', '2026-09-22']) });
  assert.equal(beyondQuota.attendance.lopDays, 2);
  assert.equal(beyondQuota.deductions.find((line) => line.key === 'lop').amount, 933);
  assert.equal(beyondQuota.netPay, 13067);
  const overOnWeeklyOff = draft({ unpaidLeaveKeys: new Set(['2026-09-06']) });
  assert.equal(overOnWeeklyOff.attendance.lopDays, 0);
});

test('joining mid-month pro-rates the earnings on the days the employee was on payroll', () => {
  const slip = draft({ employee: { ...EMPLOYEE, joiningKey: '2026-09-16' } });
  assert.equal(slip.periodStart, '2026-09-16');
  assert.equal(slip.attendance.totalDays, 15);
  assert.equal(slip.grossEarnings, 7000);
  assert.equal(buildPayslipDraft({ employee: { ...EMPLOYEE, joiningKey: '2026-10-01' }, monthKey: '2026-09', ...empty }), null);
});

test('pf, tds and manual deductions all reduce the take-home total', () => {
  const slip = draft({ employee: { ...EMPLOYEE, salary: { ...SALARY, hra: 4000, pfPercentage: 12, tds: 500, otherDeductions: 100 } } });
  assert.equal(slip.grossEarnings, 18000);
  assert.equal(slip.deductions.find((line) => line.key === 'pf').amount, 1680);
  assert.equal(slip.totalDeductions, 2280);
  assert.equal(slip.netPay, 15720);
});

test('an admin edit recalculates the totals from the lines it changed', () => {
  const totals = recalculate({
    earnings: [{ key: 'basic', label: 'Basic Salary', amount: 20000 }],
    deductions: [{ key: 'lop', label: 'Loss of Pay (LOP)', amount: 1000 }, { key: 'tds', label: 'Tax Deducted at Source (TDS)', amount: 500 }],
  });
  assert.deepEqual(totals, { grossEarnings: 20000, totalDeductions: 1500, netPay: 18500 });
});

test('month helpers roll over the year boundary and expose the payslip calendar', () => {
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
  const february = monthRange('2028-02');
  assert.equal(february.daysInMonth, 29);
  assert.equal(february.lastKey, '2028-02-29');
  assert.equal(february.label, 'Feb/2028');
});

test('pay day counts follow the joining window, not the calendar month', () => {
  const days = computePayDays({ startKey: '2026-09-25', endKey: '2026-09-30', ...empty });
  assert.equal(days.totalDays, 6);
  assert.equal(days.paidDays, 6);
});

test('net pay is written out in Indian words the way a printed slip shows it', () => {
  assert.equal(amountInWords(14000), 'Rupees Fourteen Thousand Only');
  assert.equal(amountInWords(100000), 'Rupees One Lakh Only');
  assert.equal(amountInWords(12345678), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(-250), 'Minus Rupees Two Hundred Fifty Only');
});
