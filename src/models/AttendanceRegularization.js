import mongoose from 'mongoose';

const regularizationSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  attendance: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', default: null },
  dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  type: { type: String, enum: ['IN', 'OUT'], required: true },
  requestedAt: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewReason: { type: String, default: '' },
}, { timestamps: true });

regularizationSchema.index({ employee: 1, dateKey: -1, createdAt: -1 });
regularizationSchema.index({ status: 1, createdAt: -1 });

export const AttendanceRegularization = mongoose.model('AttendanceRegularization', regularizationSchema);
