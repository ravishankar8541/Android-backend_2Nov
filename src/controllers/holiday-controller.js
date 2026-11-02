import { Holiday } from '../models/Holiday.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { HttpError } from '../utils/http-error.js';
import { dateKeyInTimeZone } from '../utils/date.js';
import { env } from '../config/env.js';

export async function listHolidays(req, res) {
  const query = req.validatedQuery ?? req.query;
  const filter = {};
  if (!ADMIN_ROLES.includes(req.auth.role)) filter.active = true;
  if (query.from || (!ADMIN_ROLES.includes(req.auth.role) && !query.from)) {
    filter.date = { ...filter.date, $gte: query.from || dateKeyInTimeZone(new Date(), env.OFFICE_TIME_ZONE) };
  }
  if (query.to) filter.date = { ...filter.date, $lte: query.to };
  const items = await Holiday.find(filter).sort({ date: 1, name: 1 });
  res.json({ success: true, message: 'Company holidays', data: { items } });
}

export async function createHoliday(req, res) {
  const holiday = await Holiday.create({ ...req.body, createdBy: req.auth.userId });
  await AuditLog.create({ actor: req.auth.userId, action: 'holiday.created', entityType: 'Holiday', entityId: holiday.id, ipAddress: req.ip });
  const recipients = await User.find({ active: true, employee: { $ne: null } }).select('_id').lean();
  if (recipients.length) {
    try {
      await Notification.insertMany(recipients.map(({ _id }) => ({ recipient: _id, type: 'holiday_added', title: 'New company holiday', message: `${holiday.name} has been added to the holiday calendar for ${holiday.date}.`, data: { holidayId: holiday.id } })), { ordered: false });
    } catch (error) {
      req.log?.error({ err: error, holidayId: holiday.id }, 'Unable to send holiday notifications');
    }
  }
  res.status(201).json({ success: true, message: 'Holiday created', data: { holiday } });
}

export async function updateHoliday(req, res) {
  const holiday = await Holiday.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!holiday) throw new HttpError(404, 'Holiday not found', 'HOLIDAY_NOT_FOUND');
  await AuditLog.create({ actor: req.auth.userId, action: 'holiday.updated', entityType: 'Holiday', entityId: holiday.id, ipAddress: req.ip });
  res.json({ success: true, message: 'Holiday updated', data: { holiday } });
}
