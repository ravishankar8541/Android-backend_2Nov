import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['leave_request', 'leave_approved', 'leave_rejected', 'attendance_request_new', 'attendance_request_approved', 'attendance_request_rejected', 'password_reset_request', 'password_reset_approved', 'password_reset_rejected', 'holiday_added', 'announcement', 'birthday_wish'], required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  readAt: { type: Date, default: null, index: true },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
