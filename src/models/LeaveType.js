import mongoose from 'mongoose';

const leaveTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  annualAllowance: { type: Number, default: 0, min: 0 },
  paid: { type: Boolean, default: true },
  carryForward: { type: Boolean, default: false },
  halfDayAllowed: { type: Boolean, default: true },
  attachmentRequired: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export const LeaveType = mongoose.model('LeaveType', leaveTypeSchema);
