import { ADMIN_ROLES } from '../constants/roles.js';
import { Employee } from '../models/Employee.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

export function fitNotification(notification) {
  const limitOf = (field, fallback) => Notification.schema.path(field).options?.maxlength ?? fallback;
  return {
    ...notification,
    title: String(notification.title ?? '').slice(0, limitOf('title', 160)),
    message: String(notification.message ?? '').slice(0, limitOf('message', 1000)),
  };
}

export async function notifyReviewers(req, employeeId, notification) {
  const employee = await Employee.findById(employeeId).select('manager').lean();
  const recipients = await User.find({
    active: true,
    $or: [
      { role: { $in: ADMIN_ROLES } },
      ...(employee?.manager ? [{ employee: employee.manager }] : []),
    ],
  }).select('_id').lean();
  if (!recipients.length) return;
  const payload = fitNotification(notification);
  try {
    await Notification.insertMany(recipients.map(({ _id }) => ({ ...payload, recipient: _id })), { ordered: false });
  } catch (error) {
    req.log?.error({ err: error, employeeId }, 'Unable to create request reviewer notifications');
  }
}
