import mongoose from 'mongoose';

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  category: { type: String, enum: ['company', 'national', 'festival', 'optional'], default: 'company' },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

holidaySchema.index({ date: 1, active: 1 });

export const Holiday = mongoose.model('Holiday', holidaySchema);
