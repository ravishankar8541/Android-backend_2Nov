import mongoose from 'mongoose';

const passwordResetRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  requestedBy: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reason: { type: String, default: '', trim: true, maxlength: 300 },
  ipAddress: { type: String, default: '' },
}, { timestamps: true });

passwordResetRequestSchema.index({ status: 1, updatedAt: -1 });

export const PasswordResetRequest = mongoose.model('PasswordResetRequest', passwordResetRequestSchema);
