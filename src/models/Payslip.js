import mongoose from 'mongoose';

const componentSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, default: 0 },
}, { _id: false });

const payslipSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  monthKey: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
  periodStart: { type: String, required: true },
  periodEnd: { type: String, required: true },
  ref: { type: String, required: true, trim: true },
  issueDate: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'released'], default: 'draft', index: true },
  currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },
  snapshot: {
    employeeId: { type: String, required: true },
    name: { type: String, required: true },
    designation: { type: String, default: '' },
    department: { type: String, default: '' },
    joiningDate: { type: Date, default: null },
    office: { type: String, default: '' },
  },
  statutory: {
    pan: { type: String, default: '' },
    aadhaar: { type: String, default: '' },
    bankAccount: { type: String, default: '' },
    ifsc: { type: String, default: '' },
  },
  attendance: {
    totalDays: { type: Number, required: true, default: 0 },
    paidDays: { type: Number, required: true, default: 0 },
    lopDays: { type: Number, required: true, default: 0 },
  },
  earnings: { type: [componentSchema], default: [] },
  deductions: { type: [componentSchema], default: [] },
  grossEarnings: { type: Number, required: true, default: 0 },
  totalDeductions: { type: Number, required: true, default: 0 },
  netPay: { type: Number, required: true, default: 0 },
  amountInWords: { type: String, default: '' },
  manual: { type: Boolean, default: false },
  editReason: { type: String, default: '' },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  generatedAt: { type: Date, default: null },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  editedAt: { type: Date, default: null },
  releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  releasedAt: { type: Date, default: null },
}, { timestamps: true });

payslipSchema.index({ employee: 1, monthKey: 1 }, { unique: true });
payslipSchema.index({ monthKey: -1, status: 1 });

export const Payslip = mongoose.model('Payslip', payslipSchema);
