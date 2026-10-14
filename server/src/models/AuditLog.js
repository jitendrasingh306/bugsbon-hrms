import mongoose from 'mongoose';

const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'system' },
    action: { type: String, required: true, index: true },
    entityType: { type: String, index: true },
    entityId: { type: String },
    summary: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

// Append-only at the application level: no update or delete operation is allowed.
const blockedOps = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];
for (const op of blockedOps) {
  auditLogSchema.pre(op, function blocked() {
    throw new Error('Audit logs are append-only and cannot be modified or deleted.');
  });
}
auditLogSchema.pre('save', function onlyNew(next) {
  if (!this.isNew) return next(new Error('Audit logs are append-only and cannot be modified.'));
  next();
});

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
