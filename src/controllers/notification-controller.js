import { Notification } from '../models/Notification.js';
import { HttpError } from '../utils/http-error.js';

export async function listMyNotifications(req, res) {
  const query = req.validatedQuery ?? req.query;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  const [items, total, unread] = await Promise.all([
    Notification.find({ recipient: req.auth.userId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments({ recipient: req.auth.userId }),
    Notification.countDocuments({ recipient: req.auth.userId, readAt: null }),
  ]);
  res.json({ success: true, message: 'Your notifications', data: { items, unread, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}

export async function markNotificationRead(req, res) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.auth.userId },
    { $set: { readAt: new Date() } },
    { new: true },
  );
  if (!notification) throw new HttpError(404, 'Notification not found', 'NOTIFICATION_NOT_FOUND');
  res.json({ success: true, message: 'Notification marked as read', data: { notification } });
}

export async function markAllNotificationsRead(req, res) {
  await Notification.updateMany({ recipient: req.auth.userId, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ success: true, message: 'Notifications marked as read', data: null });
}
