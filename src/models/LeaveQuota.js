import mongoose from 'mongoose';

const leaveQuotaSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  monthKey: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  days: { type: Number, required: true, min: 0, max: 31 },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedAt: { type: Date, default: Date.now },
}, { timestamps: true });

leaveQuotaSchema.index({ employee: 1, monthKey: 1 }, { unique: true });

export const LeaveQuota = mongoose.model('LeaveQuota', leaveQuotaSchema);
