import { Employee } from '../models/Employee.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { HttpError } from '../utils/http-error.js';
import { FaceTemplate } from '../models/FaceTemplate.js';
import { BiometricSession } from '../models/BiometricSession.js';

function pagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export async function listEmployees(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = {};
  if (req.auth.role === 'manager') {
    const team = req.auth.employeeId ? await Employee.find({ manager: req.auth.employeeId }).select('_id') : [];
    filter._id = { $in: team.map(({ _id }) => _id) };
  }
  if (req.query.status && req.query.status !== 'all') filter.employmentStatus = req.query.status;
  if (req.query.department) filter.department = req.query.department;
  if (req.query.q) {
    const escaped = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { employeeId: { $regex: escaped, $options: 'i' } },
      { firstName: { $regex: escaped, $options: 'i' } },
      { lastName: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
      { department: { $regex: escaped, $options: 'i' } },
    ];
  }
  const [rows, total] = await Promise.all([
    Employee.find(filter).populate('manager', 'firstName lastName').populate('office', 'name').populate('shift', 'name startTime endTime').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Employee.countDocuments(filter),
  ]);
  res.json({ success: true, message: 'Employees', data: { items: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function createEmployee(req, res) {
  const email = req.body.email.toLowerCase();
  if (await User.exists({ email }) || await Employee.exists({ employeeId: req.body.employeeId.toUpperCase() })) {
    throw new HttpError(409, 'That email or employee ID is already in use', 'EMPLOYEE_ALREADY_EXISTS');
  }
  const { temporaryPassword, role, ...profile } = req.body;
  const employee = await Employee.create({ ...profile, email, employeeId: req.body.employeeId.toUpperCase() });
  const user = new User({ email, role: role ?? 'employee', employee: employee.id });
  await user.setPassword(temporaryPassword);
  try {
    await user.save();
  } catch (error) {
    await Employee.findByIdAndDelete(employee.id);
    throw error;
  }
  await AuditLog.create({ actor: req.auth.userId, action: 'employee.created', entityType: 'Employee', entityId: employee.id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: 'Employee created', data: { employee } });
}

export async function updateEmployee(req, res) {
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  const allowed = ['firstName', 'lastName', 'phone', 'department', 'designation', 'manager', 'office', 'shift', 'employmentStatus', 'faceEnrollmentStatus'];
  for (const key of allowed) if (req.body[key] !== undefined) employee[key] = req.body[key];
  await employee.save();
  if (req.body.faceEnrollmentStatus === 'disabled') {
    await FaceTemplate.deleteOne({ employee: employee.id });
    await BiometricSession.deleteMany({ employee: employee.id, usedAt: null });
  }
  if (req.body.employmentStatus !== undefined) {
    await User.updateOne({ employee: employee.id }, { $set: { active: employee.employmentStatus === 'active' } });
  }
  await AuditLog.create({ actor: req.auth.userId, action: 'employee.updated', entityType: 'Employee', entityId: employee.id, ipAddress: req.ip });
  res.json({ success: true, message: 'Employee updated', data: { employee } });
}

export async function resetEmployeePassword(req, res) {
  const employee = await Employee.findById(req.params.id).select('_id email');
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  const user = await User.findOne({ employee: employee.id }).select('+passwordHash +refreshTokenHash');
  if (!user) throw new HttpError(404, 'Employee sign-in account not found', 'EMPLOYEE_ACCOUNT_NOT_FOUND');
  await user.setPassword(req.body.temporaryPassword);
  user.refreshTokenHash = null;
  await user.save({ validateBeforeSave: false });
  await AuditLog.create({ actor: req.auth.userId, action: 'employee.password_reset', entityType: 'Employee', entityId: employee.id, ipAddress: req.ip });
  res.json({ success: true, message: 'Employee password reset; active refresh sessions were revoked', data: null });
}

export async function getEmployee(req, res) {
  const employee = await Employee.findById(req.params.id).populate('manager', 'firstName lastName').populate('office', 'name').populate('shift', 'name startTime endTime');
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  if (req.auth.role === 'manager' && (!req.auth.employeeId || employee.manager?.id !== req.auth.employeeId)) throw new HttpError(403, 'You can only view your direct team', 'FORBIDDEN');
  res.json({ success: true, message: 'Employee profile', data: { employee } });
}
