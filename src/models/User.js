import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../constants/roles.js';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: Object.values(ROLES), default: ROLES.EMPLOYEE, required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  active: { type: Boolean, default: true, index: true },
  refreshTokenHash: { type: String, select: false, default: null },
  passwordChangedAt: { type: Date, default: Date.now },
}, { timestamps: true });

userSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(password, 12);
  this.passwordChangedAt = new Date();
};

userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

export const User = mongoose.model('User', userSchema);
