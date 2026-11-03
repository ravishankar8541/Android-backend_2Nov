import { Employee } from '../models/Employee.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { HttpError } from '../utils/http-error.js';
import { ROLES } from '../constants/roles.js';
import { Attendance } from '../models/Attendance.js';
import { AttendanceRegularization } from '../models/AttendanceRegularization.js';
import { FaceTemplate } from '../models/FaceTemplate.js';
import { BiometricSession } from '../models/BiometricSession.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Notification } from '../models/Notification.js';
import { PasswordResetRequest } from '../models/PasswordResetRequest.js';
import { Payslip } from '../models/Payslip.js';
import { deleteEmployeePhoto, uploadEmployeePhoto as storeEmployeePhoto } from '../services/cloudinary.js';

function pagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export async function listEmployees(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const canViewSalary = req.auth.role === ROLES.SUPER_ADMIN || req.auth.role === ROLES.HR_ADMIN;
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
  const listQuery = Employee.find(filter).populate('manager', 'firstName lastName').populate('office', 'name').populate('shift', 'name startTime endTime').sort({ createdAt: -1 }).skip(skip).limit(limit);
  if (!canViewSalary) listQuery.select('-salary');
  const [rows, total] = await Promise.all([
    listQuery,
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

export async function uploadEmployeePhoto(req, res) {
  if (!req.file) throw new HttpError(400, 'Choose an image file to upload', 'EMPLOYEE_PHOTO_MISSING');
  const photo = await storeEmployeePhoto(req.file.buffer);
  res.status(201).json({ success: true, message: 'Photo stored', data: { photo } });
}

export async function updateEmployee(req, res) {
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  const previousPhotoPublicId = employee.photoPublicId;
  const allowed = ['firstName', 'lastName', 'phone', 'department', 'designation', 'joiningDate', 'photoUrl', 'photoPublicId', 'manager', 'office', 'shift', 'employmentStatus', 'faceEnrollmentStatus', 'attendanceVerification'];
  for (const key of allowed) if (req.body[key] !== undefined) employee[key] = req.body[key];
  if (req.body.salary) {
    const current = typeof employee.salary?.toObject === 'function' ? employee.salary.toObject() : (employee.salary ?? {});
    employee.salary = { ...current, ...req.body.salary };
  }
  await employee.save();
  if (previousPhotoPublicId && previousPhotoPublicId !== employee.photoPublicId) await deleteEmployeePhoto(previousPhotoPublicId);
  if (req.body.faceEnrollmentStatus === 'disabled') {
    await FaceTemplate.deleteOne({ employee: employee.id });
    await BiometricSession.deleteMany({ employee: employee.id, usedAt: null });
  }
  if (req.body.employmentStatus !== undefined) {
    await User.updateOne({ employee: employee.id }, { $set: { active: employee.employmentStatus === 'active' } });
  }
  await AuditLog.create({
    actor: req.auth.userId,
    action: 'employee.updated',
    entityType: 'Employee',
    entityId: employee.id,
    metadata: req.body.salary ? { salaryFields: Object.keys(req.body.salary) } : {},
    ipAddress: req.ip,
  });
  res.json({ success: true, message: 'Employee updated', data: { employee } });
}

export async function deleteEmployee(req, res) {
  const employee = await Employee.findById(req.params.id).select('_id employeeId firstName lastName photoPublicId');
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  const account = await User.findOne({ employee: employee.id }).select('_id');
  if (account && account.id === req.auth.userId) throw new HttpError(400, 'You cannot delete the profile behind your own sign-in', 'EMPLOYEE_SELF_DELETE');

  await Employee.updateMany({ manager: employee.id }, { $set: { manager: null } });
  const [attendance, leaves, corrections, payslips] = await Promise.all([
    Attendance.deleteMany({ employee: employee.id }),
    LeaveRequest.deleteMany({ employee: employee.id }),
    AttendanceRegularization.deleteMany({ employee: employee.id }),
    Payslip.deleteMany({ employee: employee.id }),
  ]);
  await Promise.all([FaceTemplate.deleteOne({ employee: employee.id }), BiometricSession.deleteMany({ employee: employee.id })]);
  if (account) {
    await Promise.all([Notification.deleteMany({ recipient: account.id }), PasswordResetRequest.deleteMany({ user: account.id })]);
    await account.deleteOne();
  }
  await employee.deleteOne();
  await deleteEmployeePhoto(employee.photoPublicId);
  await AuditLog.create({
    actor: req.auth.userId,
    action: 'employee.deleted',
    entityType: 'Employee',
    entityId: employee.id,
    metadata: { employeeId: employee.employeeId, attendance: attendance.deletedCount, leaves: leaves.deletedCount, corrections: corrections.deletedCount, payslips: payslips.deletedCount },
    ipAddress: req.ip,
  });
  res.json({ success: true, message: 'Employee removed', data: { employeeId: employee.employeeId, name: `${employee.firstName} ${employee.lastName}` } });
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
  const canViewSalary = req.auth.role === ROLES.SUPER_ADMIN || req.auth.role === ROLES.HR_ADMIN;
  const employeeQuery = Employee.findById(req.params.id).populate('manager', 'firstName lastName').populate('office', 'name').populate('shift', 'name startTime endTime');
  if (!canViewSalary) employeeQuery.select('-salary');
  const employee = await employeeQuery;
  if (!employee) throw new HttpError(404, 'Employee not found', 'EMPLOYEE_NOT_FOUND');
  if (req.auth.role === 'manager' && (!req.auth.employeeId || employee.manager?.id !== req.auth.employeeId)) throw new HttpError(403, 'You can only view your direct team', 'FORBIDDEN');
  res.json({ success: true, message: 'Employee profile', data: { employee } });
}
