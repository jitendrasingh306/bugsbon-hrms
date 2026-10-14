import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    roles: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    // Departments a Manager may see/assign within (used by scope checks in later phases)
    managedDepartments: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
    // Direct manager: decides whose daily plan / end-of-day reports this user's manager can see
    reportsTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    // Incrementing this invalidates every existing session of the user
    sessionVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
