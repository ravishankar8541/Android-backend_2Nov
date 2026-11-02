import mongoose from 'mongoose';

const shiftSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  graceMinutes: { type: Number, default: 15, min: 0, max: 240 },
  breakMinutes: { type: Number, default: 60, min: 0, max: 480 },
  weeklyOffDays: { type: [{ type: Number, min: 0, max: 6 }], default: [0, 6] },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export const Shift = mongoose.model('Shift', shiftSchema);
