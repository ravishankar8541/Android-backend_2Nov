import mongoose from 'mongoose';

const leaveRequestSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  leaveType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  days: { type: Number, required: true, min: 0.5 },
  halfDay: { type: Boolean, default: false },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewReason: { type: String, default: '' },
}, { timestamps: true });

leaveRequestSchema.index({ employee: 1, startDate: 1, endDate: 1, status: 1 });

export const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);
