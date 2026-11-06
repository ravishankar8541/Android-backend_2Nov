import mongoose from 'mongoose';

const attendanceEventSchema = new mongoose.Schema({
  type: { type: String, enum: ['IN', 'OUT'], required: true },
  occurredAt: { type: Date, required: true },
  method: { type: String, enum: ['face_liveness', 'selfie_photo', 'manual'], required: true },
  verification: {
    faceMatched: { type: Boolean, required: true },
    livenessPassed: { type: Boolean, required: true },
    providerReference: { type: String, select: false },
    photoUrl: { type: String, default: null, maxlength: 700 },
    photoPublicId: { type: String, default: null, select: false, maxlength: 200 },
  },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracyMeters: { type: Number, required: true },
    distanceMeters: { type: Number, required: true },
  },
  deviceId: { type: String, default: null },
  correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  correctionReason: { type: String, default: null },
}, { _id: true, toJSON: { transform(_doc, ret) { if (ret.verification) { delete ret.verification.providerReference; delete ret.verification.photoPublicId; } return ret; } } });

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  office: { type: mongoose.Schema.Types.ObjectId, ref: 'Office', required: true, index: true },
  dateKey: { type: String, required: true, index: true },
  events: { type: [attendanceEventSchema], default: [] },
  status: { type: String, enum: ['present', 'late', 'half_day', 'absent', 'early_leave', 'overtime', 'manual_review', 'on_leave'], default: 'present', index: true },
  netWorkingMinutes: { type: Number, default: 0 },
}, { timestamps: true, optimisticConcurrency: true });

attendanceSchema.index({ employee: 1, dateKey: 1 }, { unique: true });
attendanceSchema.index({ dateKey: 1, status: 1, office: 1 });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
