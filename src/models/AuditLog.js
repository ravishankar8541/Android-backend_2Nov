import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  reason: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, default: '' },
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1, action: 1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
