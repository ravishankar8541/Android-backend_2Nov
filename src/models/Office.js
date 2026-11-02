import mongoose from 'mongoose';

const officeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true, default: '' },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  radiusMeters: { type: Number, min: 1, default: 25 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

export const Office = mongoose.model('Office', officeSchema);
