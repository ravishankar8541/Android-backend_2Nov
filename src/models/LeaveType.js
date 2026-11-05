import mongoose from 'mongoose';

const leaveTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  // Only the frozen Android build reads these two flags; pay depends on the monthly quota instead.
  halfDayAllowed: { type: Boolean, default: true },
  attachmentRequired: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export const LeaveType = mongoose.model('LeaveType', leaveTypeSchema);
