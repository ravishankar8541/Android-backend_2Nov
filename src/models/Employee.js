import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
  firstName: { type: String, required: true, trim: true, maxlength: 80 },
  lastName: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, default: '' },
  department: { type: String, trim: true, default: 'Unassigned', index: true },
  designation: { type: String, trim: true, default: '' },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  office: { type: mongoose.Schema.Types.ObjectId, ref: 'Office', default: null },
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
  joiningDate: { type: Date, default: Date.now },
  employmentStatus: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  faceEnrollmentStatus: { type: String, enum: ['not_enrolled', 'pending', 'enrolled', 'disabled'], default: 'not_enrolled' },
}, { timestamps: true });

employeeSchema.index({ department: 1, employmentStatus: 1 });

export const Employee = mongoose.model('Employee', employeeSchema);
