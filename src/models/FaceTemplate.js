import mongoose from 'mongoose';

const faceTemplateSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true, index: true },
  ciphertext: { type: String, required: true, select: false },
  iv: { type: String, required: true, select: false },
  authTag: { type: String, required: true, select: false },
  keyVersion: { type: Number, required: true, default: 1 },
  revision: { type: String, default: null },
  consentAt: { type: Date, required: true },
  consentVersion: { type: String, required: true, default: 'attendance-face-v1' },
  enrolledAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

export const FaceTemplate = mongoose.model('FaceTemplate', faceTemplateSchema);
