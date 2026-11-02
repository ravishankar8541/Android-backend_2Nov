import { ADMIN_ROLES } from '../constants/roles.js';
import { Employee } from '../models/Employee.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

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
  try {
    await Notification.insertMany(recipients.map(({ _id }) => ({ ...notification, recipient: _id })), { ordered: false });
  } catch (error) {
    req.log?.error({ err: error, employeeId }, 'Unable to create request reviewer notifications');
  }
}
