import { Office } from '../models/Office.js';
import { Shift } from '../models/Shift.js';
import { AuditLog } from '../models/AuditLog.js';
import { HttpError } from '../utils/http-error.js';
import { Department } from '../models/Department.js';
import { Designation } from '../models/Designation.js';
import { ADMIN_ROLES } from '../constants/roles.js';

export async function listOffices(req, res) {
  const includeInactive = req.query.includeInactive === 'true' && ADMIN_ROLES.includes(req.auth.role);
  const items = await Office.find(includeInactive ? {} : { active: true }).sort({ name: 1 });
  res.json({ success: true, message: 'Offices', data: { items } });
}

export async function createOffice(req, res) {
  const office = await Office.create(req.body);
  await AuditLog.create({ actor: req.auth.userId, action: 'office.created', entityType: 'Office', entityId: office.id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: 'Office created', data: { office } });
}

export async function updateOffice(req, res) {
  const office = await Office.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!office) throw new HttpError(404, 'Office not found', 'OFFICE_NOT_FOUND');
  await AuditLog.create({ actor: req.auth.userId, action: 'office.updated', entityType: 'Office', entityId: office.id, ipAddress: req.ip });
  res.json({ success: true, message: 'Office updated', data: { office } });
}

export async function listShifts(req, res) {
  const includeInactive = req.query.includeInactive === 'true' && ADMIN_ROLES.includes(req.auth.role);
  const items = await Shift.find(includeInactive ? {} : { active: true }).sort({ name: 1 });
  res.json({ success: true, message: 'Shifts', data: { items } });
}

export async function createShift(req, res) {
  const shift = await Shift.create(req.body);
  await AuditLog.create({ actor: req.auth.userId, action: 'shift.created', entityType: 'Shift', entityId: shift.id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: 'Shift created', data: { shift } });
}

export async function updateShift(req, res) {
  const shift = await Shift.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!shift) throw new HttpError(404, 'Shift not found', 'SHIFT_NOT_FOUND');
  await AuditLog.create({ actor: req.auth.userId, action: 'shift.updated', entityType: 'Shift', entityId: shift.id, ipAddress: req.ip });
  res.json({ success: true, message: 'Shift updated', data: { shift } });
}

async function listMasterItems(Model, includeInactive, res, label) {
  const items = await Model.find(includeInactive ? {} : { active: true }).sort({ name: 1 });
  res.json({ success: true, message: label, data: { items } });
}

async function createMasterItem(Model, req, res, label, action) {
  const item = await Model.create({ name: req.body.name });
  await AuditLog.create({ actor: req.auth.userId, action, entityType: label, entityId: item.id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: `${label} created`, data: { item } });
}

async function updateMasterItem(Model, req, res, label, action) {
  const item = await Model.findById(req.params.id);
  if (!item) throw new HttpError(404, `${label} not found`, `${label.toUpperCase()}_NOT_FOUND`);
  if (req.body.name !== undefined) item.name = req.body.name;
  if (req.body.active !== undefined) item.active = req.body.active;
  await item.save();
  await AuditLog.create({ actor: req.auth.userId, action, entityType: label, entityId: item.id, ipAddress: req.ip });
  res.json({ success: true, message: `${label} updated`, data: { item } });
}

export async function listDepartments(req, res) {
  await listMasterItems(Department, req.query.includeInactive === 'true' && ADMIN_ROLES.includes(req.auth.role), res, 'Departments');
}
export async function createDepartment(req, res) {
  await createMasterItem(Department, req, res, 'Department', 'department.created');
}
export async function updateDepartment(req, res) {
  await updateMasterItem(Department, req, res, 'Department', 'department.updated');
}
export async function listDesignations(req, res) {
  await listMasterItems(Designation, req.query.includeInactive === 'true' && ADMIN_ROLES.includes(req.auth.role), res, 'Designations');
}
export async function createDesignation(req, res) {
  await createMasterItem(Designation, req, res, 'Designation', 'designation.created');
}
export async function updateDesignation(req, res) {
  await updateMasterItem(Designation, req, res, 'Designation', 'designation.updated');
}
