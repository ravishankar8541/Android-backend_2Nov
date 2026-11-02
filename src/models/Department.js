import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  key: { type: String, required: true, unique: true, select: false },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

departmentSchema.pre('validate', function normalizeName() {
  if (this.name) this.key = this.name.trim().toLocaleLowerCase();
});

export const Department = mongoose.model('Department', departmentSchema);
