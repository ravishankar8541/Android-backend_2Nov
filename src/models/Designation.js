import mongoose from 'mongoose';

const designationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  key: { type: String, required: true, unique: true, select: false },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

designationSchema.pre('validate', function normalizeName() {
  if (this.name) this.key = this.name.trim().toLocaleLowerCase();
});

export const Designation = mongoose.model('Designation', designationSchema);
