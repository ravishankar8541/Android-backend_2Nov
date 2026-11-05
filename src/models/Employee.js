import mongoose from 'mongoose';

const monthlyAmount = { type: Number, default: 0, min: 0, max: 10000000 };

const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
  salary: {
    currency: { type: String, default: 'INR', uppercase: true, trim: true, maxlength: 3 },
    basic: monthlyAmount,
    hra: monthlyAmount,
    specialAllowance: monthlyAmount,
    bonus: monthlyAmount,
    pfPercentage: { type: Number, default: 0, min: 0, max: 100 },
    tds: monthlyAmount,
    otherDeductions: monthlyAmount,
    pan: { type: String, default: '', uppercase: true, trim: true, maxlength: 10 },
    aadhaar: { type: String, default: '', trim: true, maxlength: 12 },
    bankAccount: { type: String, default: '', trim: true, maxlength: 34 },
    ifsc: { type: String, default: '', uppercase: true, trim: true, maxlength: 11 },
  },
  firstName: { type: String, required: true, trim: true, maxlength: 80 },
  lastName: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, default: '' },
  department: { type: String, trim: true, default: 'Unassigned', index: true },
  designation: { type: String, trim: true, default: '' },
  photoUrl: { type: String, default: null, maxlength: 700 },
  photoPublicId: { type: String, default: null, maxlength: 200 },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  office: { type: mongoose.Schema.Types.ObjectId, ref: 'Office', default: null },
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
  joiningDate: { type: Date, default: Date.now },
  employmentStatus: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  faceEnrollmentStatus: { type: String, enum: ['not_enrolled', 'pending', 'enrolled', 'disabled'], default: 'not_enrolled' },
  attendanceVerification: { type: String, enum: ['face', 'selfie'], default: 'face' },
  faceCheck: {
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    photoUrl: { type: String, default: null, maxlength: 700 },
    photoPublicId: { type: String, default: null, maxlength: 200 },
    source: { type: String, enum: ['none', 'web', 'android'], default: 'none' },
    capturedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: '', maxlength: 300 },
  },
}, { timestamps: true });

employeeSchema.index({ department: 1, employmentStatus: 1 });
employeeSchema.index({ 'faceCheck.status': 1, employmentStatus: 1 });

/**
 * The face check the attendance gate actually enforces. Profiles created before this field existed
 * carry no evidence at all, so an enrolled Android template counts as proof while an empty profile
 * waits for a face photo — otherwise the stored default would hand them a tick they never earned.
 */
employeeSchema.methods.faceCheckState = function faceCheckState() {
  const check = this.faceCheck;
  if (check?.status === 'rejected') return 'rejected';
  if (check?.source && check.source !== 'none') return check.status;
  if (this.faceEnrollmentStatus === 'enrolled') return 'approved';
  return 'pending';
};

export const Employee = mongoose.model('Employee', employeeSchema);
