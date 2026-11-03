import mongoose from 'mongoose';

const biometricSessionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  eventType: { type: String, enum: ['IN', 'OUT'], required: true },
  method: { type: String, enum: ['face', 'selfie'], default: 'face' },
  photoPublicId: { type: String, default: null, maxlength: 200 },
  photoUrl: { type: String, default: null, maxlength: 700 },
  templateRevision: { type: String, default: null },
  faceDistance: { type: Number, default: null },
  livenessScore: { type: Number, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null },
}, { timestamps: true });

export const BiometricSession = mongoose.model('BiometricSession', biometricSessionSchema);
