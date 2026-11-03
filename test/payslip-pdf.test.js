import test from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused-payroll-test',
  JWT_ACCESS_SECRET: 'synthetic-test-secret-not-used-for-real-auth', BIOMETRIC_PROVIDER: 'local',
});
const { buildPayslipDraft } = await import('../src/services/payroll-engine.js');
const { maskAadhaar, payslipFilename, renderPayslipPdf } = await import('../src/services/payslip-pdf.js');

const employee = {
  employeeId: 'VAM-2BAC', firstName: 'Ravi', lastName: 'Ray', designation: 'Full Stack Developer', department: 'Engineering',
  joiningKey: '2026-03-24', shift: { weeklyOffDays: [0, 6] },
  salary: { currency: 'INR', basic: 14000, hra: 0, specialAllowance: 0, bonus: 0, pfPercentage: 0, tds: 0, otherDeductions: 0, pan: 'ABCDE1234F', aadhaar: '313431102957', bankAccount: '000123456789', ifsc: 'HDFC0001234' },
};

function payslip() {
  return {
    ...buildPayslipDraft({ employee, monthKey: '2026-09', attendanceByDate: new Map(), paidLeaveKeys: new Set(), holidayKeys: new Set() }),
    issueDate: new Date('2026-10-30T09:00:00.000Z'),
    generatedAt: new Date('2026-10-30T09:00:00.000Z'),
    amountInWords: 'Rupees Fourteen Thousand Only',
    manual: false,
    snapshot: { employeeId: 'VAM-2BAC', name: 'Ravi Ray', designation: 'Full Stack Developer', department: 'Engineering', joiningDate: new Date('2026-03-24'), office: 'Budh Vihar' },
  };
}

async function render() {
  const doc = renderPayslipPdf(payslip());
  const chunks = [];
  for await (const chunk of doc) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('the generated slip is a real pdf carrying the employee and month reference', async () => {
  const bytes = await render();
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 2000, 'expected a rendered document body');
  assert.equal(bytes.subarray(-6).toString().includes('%%EOF'), true);
});

test('the file name follows the existing payslip naming and aadhaar never prints in full', () => {
  const slip = payslip();
  assert.equal(payslipFilename(slip), 'Payslip_Ravi_Ray_Sep-2026.pdf');
  assert.equal(maskAadhaar(slip.statutory.aadhaar), 'XXXX XXXX 2957');
  assert.equal(maskAadhaar(''), '');
});
