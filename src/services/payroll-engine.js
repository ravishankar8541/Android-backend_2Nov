const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const EARNING_LABELS = {
  basic: 'Basic Salary',
  hra: 'House Rent Allowance (HRA)',
  specialAllowance: 'Special Allowance & Conveyance',
  bonus: 'Performance Bonus & Incentives',
};
export const DEDUCTION_LABELS = {
  lop: 'Loss of Pay (LOP)',
  pf: 'Provident Fund (PF)',
  tds: 'Tax Deducted at Source (TDS)',
  other: 'Other Deductions',
};

export function isValidMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return false;
  const [year, month] = monthKey.split('-').map(Number);
  return month >= 1 && month <= 12 && year >= 2000 && year <= 2100;
}

export function monthRange(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastKey = `${monthKey}-${String(daysInMonth).padStart(2, '0')}`;
  return {
    firstKey: `${monthKey}-01`,
    lastKey,
    daysInMonth,
    label: `${MONTH_NAMES[month - 1]}/${year}`,
    longLabel: `${MONTH_NAMES[month - 1]} ${year}`,
  };
}

export function shiftMonthKey(monthKey, monthOffset) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function weekdayOfDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

export function* dateKeysBetween(startKey, endKey) {
  let cursor = new Date(`${startKey}T12:00:00.000Z`);
  const stop = new Date(`${endKey}T12:00:00.000Z`);
  while (cursor <= stop) {
    yield cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 86400000);
  }
}

const NO_KEYS = new Set();
const NO_DAYS = [];

// Within-quota leave is fully paid; leave beyond the admin's monthly quota is loss of pay even
// when the employee never had an attendance row created for that day.
function dayValue({ dateKey, attendanceByDate, paidLeaveKeys, unpaidLeaveKeys = NO_KEYS, weeklyOffDays = NO_DAYS, holidayKeys }) {
  const isOffDay = holidayKeys.has(dateKey) || weeklyOffDays.includes(weekdayOfDateKey(dateKey));
  if (paidLeaveKeys.has(dateKey)) return 1;
  if (unpaidLeaveKeys.has(dateKey)) return isOffDay ? 1 : 0;
  const status = attendanceByDate.get(dateKey);
  if (!status) return 1;
  if (status === 'absent') return isOffDay ? 1 : 0;
  return status === 'half_day' ? 0.5 : 1;
}

export function computePayDays(input) {
  const { startKey, endKey } = input;
  let totalDays = 0;
  let paidDays = 0;
  for (const dateKey of dateKeysBetween(startKey, endKey)) {
    totalDays += 1;
    paidDays += dayValue({ ...input, dateKey });
  }
  return { totalDays, paidDays: round2(paidDays), lopDays: round2(totalDays - paidDays) };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function proRate(monthlyAmount, totalDays, daysInMonth) {
  return Math.round(((Number(monthlyAmount) || 0) * totalDays) / daysInMonth);
}

export function buildPayslipLines({ salary, attendance, daysInMonth }) {
  const { totalDays, lopDays } = attendance;
  const earnings = Object.entries(EARNING_LABELS).map(([key, label]) => ({
    key,
    label,
    amount: proRate(salary[key], totalDays, daysInMonth),
  }));
  const grossEarnings = earnings.reduce((sum, line) => sum + line.amount, 0);
  const perDayRate = totalDays ? grossEarnings / totalDays : 0;
  const pfPercentage = Number(salary.pfPercentage) || 0;
  const basicLine = earnings.find((line) => line.key === 'basic')?.amount ?? 0;
  const deductions = [
    { key: 'lop', label: DEDUCTION_LABELS.lop, amount: Math.round(perDayRate * lopDays) },
    { key: 'pf', label: DEDUCTION_LABELS.pf, amount: Math.round((basicLine * pfPercentage) / 100) },
    { key: 'tds', label: DEDUCTION_LABELS.tds, amount: proRate(salary.tds, totalDays, daysInMonth) },
    { key: 'other', label: DEDUCTION_LABELS.other, amount: proRate(salary.otherDeductions, totalDays, daysInMonth) },
  ];
  const totalDeductions = deductions.reduce((sum, line) => sum + line.amount, 0);
  return { earnings, deductions, grossEarnings, totalDeductions, netPay: grossEarnings - totalDeductions };
}

export function recalculate(input) {
  const { earnings, deductions } = input;
  const grossEarnings = earnings.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const totalDeductions = deductions.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  return { grossEarnings, totalDeductions, netPay: grossEarnings - totalDeductions };
}

export function buildPayslipDraft({ employee, monthKey, attendanceByDate, paidLeaveKeys, unpaidLeaveKeys, holidayKeys }) {
  const { firstKey, lastKey, daysInMonth, label } = monthRange(monthKey);
  const joiningKey = employee.joiningKey ?? null;
  if (joiningKey && joiningKey > lastKey) return null;
  const startKey = joiningKey && joiningKey > firstKey ? joiningKey : firstKey;
  const weeklyOffDays = employee.shift?.weeklyOffDays ?? [0, 6];
  const attendance = computePayDays({ startKey, endKey: lastKey, attendanceByDate, paidLeaveKeys, unpaidLeaveKeys, weeklyOffDays, holidayKeys });
  const lines = buildPayslipLines({ salary: employee.salary, attendance, daysInMonth });
  return {
    monthKey,
    periodStart: startKey,
    periodEnd: lastKey,
    ref: `VAM/PAY/${employee.employeeId}/${label}`,
    status: 'draft',
    currency: employee.salary.currency || 'INR',
    snapshot: {
      employeeId: employee.employeeId,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      designation: employee.designation || '',
      department: employee.department || '',
      joiningDate: employee.joiningDate ?? null,
      office: employee.office?.name || '',
    },
    statutory: {
      pan: employee.salary.pan || '',
      aadhaar: employee.salary.aadhaar || '',
      bankAccount: employee.salary.bankAccount || '',
      ifsc: employee.salary.ifsc || '',
    },
    attendance,
    ...lines,
  };
}
