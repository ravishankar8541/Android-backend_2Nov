import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 4000 },
  audienceType: { type: String, enum: ['everyone', 'department', 'employees'], required: true },
  department: { type: String, trim: true, default: '' },
  employees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  active: { type: Boolean, default: true, index: true },
  publishedAt: { type: Date, default: Date.now, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

announcementSchema.index({ audienceType: 1, department: 1, publishedAt: -1 });

export const Announcement = mongoose.model('Announcement', announcementSchema);
