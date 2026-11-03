import { Payslip } from '../models/Payslip.js';
import { Employee } from '../models/Employee.js';
import { AuditLog } from '../models/AuditLog.js';
import { HttpError } from '../utils/http-error.js';
import { amountInWords } from '../utils/amount-in-words.js';
import { ROLES } from '../constants/roles.js';
import { payslipFilename, renderPayslipPdf } from '../services/payslip-pdf.js';
import { generatePayslipsForMonth, releaseMonthDrafts } from '../services/payroll-service.js';
import { recalculate } from '../services/payroll-engine.js';

function pagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

async function loadPayslip(id) {
  const payslip = await Payslip.findById(id).populate('employee', 'employeeId firstName lastName');
  if (!payslip) throw new HttpError(404, 'Payslip not found', 'PAYSLIP_NOT_FOUND');
  return payslip;
}

function assertAccess(payslip, auth) {
  if (auth.role === ROLES.SUPER_ADMIN || auth.role === ROLES.HR_ADMIN) return;
  if (payslip.status !== 'released') throw new HttpError(403, 'This payslip has not been released yet', 'PAYSLIP_NOT_RELEASED');
  const owner = payslip.employee?._id?.toString() ?? payslip.employee?.toString();
  if (!auth.employeeId || owner !== auth.employeeId) throw new HttpError(403, 'You can only view your own payslips', 'PAYSLIP_FORBIDDEN');
}

export async function runPayroll(req, res) {
  const summary = await generatePayslipsForMonth({
    monthKey: req.body.monthKey,
    actorId: req.auth.userId,
    force: Boolean(req.body.force),
  });
  await AuditLog.create({
    actor: req.auth.userId,
    action: 'payslip.run',
    entityType: 'Payslip',
    entityId: summary.monthKey,
    reason: req.body.reason ?? '',
    metadata: summary,
    ipAddress: req.ip,
  });
  res.json({ success: true, message: `Payroll prepared for ${summary.monthKey}`, data: { summary } });
}

export async function releaseMonth(req, res) {
  const result = await releaseMonthDrafts({ monthKey: req.body.monthKey, actorId: req.auth.userId });
  await AuditLog.create({ actor: req.auth.userId, action: 'payslip.released_month', entityType: 'Payslip', entityId: req.body.monthKey, metadata: result, ipAddress: req.ip });
  res.json({ success: true, message: result.released ? `${result.released} payslip(s) released` : 'No draft payslips were found for this month', data: { result } });
}

export async function listPayslips(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = {};
  if (req.query.monthKey) filter.monthKey = req.query.monthKey;
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.q) {
    const escaped = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = await Employee.find({
      $or: [{ employeeId: { $regex: escaped, $options: 'i' } }, { firstName: { $regex: escaped, $options: 'i' } }, { lastName: { $regex: escaped, $options: 'i' } }],
    }).select('_id').limit(200);
    filter.employee = { $in: matches.map(({ _id }) => _id) };
  }
  const [rows, total] = await Promise.all([
    Payslip.find(filter).populate('employee', 'employeeId firstName lastName department designation').sort({ monthKey: -1, netPay: -1 }).skip(skip).limit(limit),
    Payslip.countDocuments(filter),
  ]);
  res.json({ success: true, message: 'Payslips', data: { items: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function listMyPayslips(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const items = await Payslip.find({ employee: req.auth.employeeId, status: 'released' }).sort({ monthKey: -1 });
  res.json({ success: true, message: 'Your payslips', data: { items } });
}

export async function getMyPayslip(req, res) {
  if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
  const payslip = await Payslip.findOne({ employee: req.auth.employeeId, monthKey: req.validatedParams.monthKey });
  if (!payslip || payslip.status !== 'released') throw new HttpError(404, 'No payslip has been released for this month', 'PAYSLIP_NOT_FOUND');
  res.json({ success: true, message: 'Payslip', data: { payslip } });
}

export async function getPayslip(req, res) {
  const payslip = await loadPayslip(req.params.id);
  assertAccess(payslip, req.auth);
  res.json({ success: true, message: 'Payslip', data: { payslip } });
}

export async function getPayslipPdf(req, res) {
  const payslip = await loadPayslip(req.params.id);
  assertAccess(payslip, req.auth);
  const filename = payslipFilename(payslip);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  renderPayslipPdf(payslip).pipe(res);
}

function mergeLines(current, updates) {
  if (!updates?.length) return current;
  const byKey = new Map(updates.map((line) => [line.key, Math.round(Number(line.amount) || 0)]));
  return current.map((line) => (byKey.has(line.key) ? { ...line, amount: byKey.get(line.key) } : { ...line }));
}

export async function updatePayslip(req, res) {
  const payslip = await loadPayslip(req.params.id);
  const before = { grossEarnings: payslip.grossEarnings, totalDeductions: payslip.totalDeductions, netPay: payslip.netPay };
  payslip.earnings = mergeLines(payslip.earnings, req.body.earnings);
  payslip.deductions = mergeLines(payslip.deductions, req.body.deductions);
  if (req.body.attendance) {
    for (const key of ['totalDays', 'paidDays', 'lopDays']) {
      if (req.body.attendance[key] !== undefined) payslip.attendance[key] = req.body.attendance[key];
    }
  }
  if (req.body.statutory) {
    for (const key of ['pan', 'aadhaar', 'bankAccount', 'ifsc']) {
      if (req.body.statutory[key] !== undefined) payslip.statutory[key] = req.body.statutory[key];
    }
  }
  const totals = recalculate({ earnings: payslip.earnings, deductions: payslip.deductions });
  Object.assign(payslip, totals, {
    amountInWords: amountInWords(totals.netPay, payslip.currency),
    manual: true,
    editReason: req.body.reason,
    editedBy: req.auth.userId,
    editedAt: new Date(),
  });
  await payslip.save();
  await AuditLog.create({
    actor: req.auth.userId,
    action: 'payslip.updated',
    entityType: 'Payslip',
    entityId: payslip.id,
    reason: req.body.reason,
    metadata: { before, after: { grossEarnings: totals.grossEarnings, totalDeductions: totals.totalDeductions, netPay: totals.netPay } },
    ipAddress: req.ip,
  });
  res.json({ success: true, message: 'Payslip updated', data: { payslip } });
}

async function transition(req, res, status) {
  const payslip = await loadPayslip(req.params.id);
  payslip.status = status;
  payslip.releasedBy = status === 'released' ? req.auth.userId : null;
  payslip.releasedAt = status === 'released' ? new Date() : null;
  await payslip.save();
  await AuditLog.create({ actor: req.auth.userId, action: `payslip.${status}`, entityType: 'Payslip', entityId: payslip.id, reason: req.body.reason ?? '', ipAddress: req.ip });
  res.json({ success: true, message: status === 'released' ? 'Payslip released to the employee' : 'Payslip moved back to draft', data: { payslip } });
}

export function releasePayslip(req, res) {
  return transition(req, res, 'released');
}

export function recallPayslip(req, res) {
  return transition(req, res, 'draft');
}

export async function deletePayslip(req, res) {
  const payslip = await loadPayslip(req.params.id);
  await Payslip.deleteOne({ _id: payslip.id });
  await AuditLog.create({ actor: req.auth.userId, action: 'payslip.deleted', entityType: 'Payslip', entityId: payslip.id, metadata: { monthKey: payslip.monthKey, employee: payslip.employee?._id }, ipAddress: req.ip });
  res.json({ success: true, message: 'Payslip deleted', data: null });
}
