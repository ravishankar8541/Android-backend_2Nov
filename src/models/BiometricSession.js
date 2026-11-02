import mongoose from 'mongoose';

const biometricSessionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  eventType: { type: String, enum: ['IN', 'OUT'], required: true },
  templateRevision: { type: String, default: null },
  faceDistance: { type: Number, required: true },
  livenessScore: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null },
}, { timestamps: true });

export const BiometricSession = mongoose.model('BiometricSession', biometricSessionSchema);
