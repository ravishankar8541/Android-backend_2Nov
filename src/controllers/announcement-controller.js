import { Announcement } from '../models/Announcement.js';
import { AuditLog } from '../models/AuditLog.js';
import { Employee } from '../models/Employee.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { HttpError } from '../utils/http-error.js';

export async function listAnnouncements(req, res) {
  const filter = { active: true, publishedAt: { $lte: new Date() } };
  if (!ADMIN_ROLES.includes(req.auth.role)) {
    if (!req.auth.employeeId) throw new HttpError(403, 'Employee profile required', 'EMPLOYEE_PROFILE_REQUIRED');
    const employee = await Employee.findById(req.auth.employeeId).select('department');
    filter.$or = [
      { audienceType: 'everyone' },
      ...(employee?.department ? [{ audienceType: 'department', department: employee.department }] : []),
      { audienceType: 'employees', employees: req.auth.employeeId },
    ];
  }
  const items = await Announcement.find(filter).populate('createdBy', 'email role').sort({ publishedAt: -1 }).limit(100);
  res.json({ success: true, message: 'Announcements', data: { items } });
}

export async function createAnnouncement(req, res) {
  if (req.body.audienceType === 'department' && !req.body.department?.trim()) throw new HttpError(422, 'Choose a department for this announcement', 'ANNOUNCEMENT_DEPARTMENT_REQUIRED');
  if (req.body.audienceType === 'employees' && !req.body.employees?.length) throw new HttpError(422, 'Choose at least one employee', 'ANNOUNCEMENT_EMPLOYEES_REQUIRED');
  const announcement = await Announcement.create({ ...req.body, createdBy: req.auth.userId });
  let employeeFilter = { employmentStatus: 'active' };
  if (announcement.audienceType === 'department') employeeFilter.department = announcement.department;
  if (announcement.audienceType === 'employees') employeeFilter._id = { $in: announcement.employees };
  const employeeIds = (await Employee.find(employeeFilter).select('_id').lean()).map(({ _id }) => _id);
  const recipients = await User.find({ active: true, employee: { $in: employeeIds } }).select('_id').lean();
  if (recipients.length) {
    try {
      await Notification.insertMany(recipients.map(({ _id }) => ({ recipient: _id, type: 'announcement', title: announcement.title, message: announcement.message, data: { announcementId: announcement.id } })), { ordered: false });
    } catch (error) { req.log?.error({ err: error, announcementId: announcement.id }, 'Unable to create announcement notifications'); }
  }
  await AuditLog.create({ actor: req.auth.userId, action: 'announcement.created', entityType: 'Announcement', entityId: announcement.id, ipAddress: req.ip });
  res.status(201).json({ success: true, message: 'Announcement published', data: { announcement, notifiedEmployees: recipients.length } });
}
