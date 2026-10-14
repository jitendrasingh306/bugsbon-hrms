import mongoose from 'mongoose';

// role_permissions is embedded: a role holds the list of permission keys it grants.
// '*' (with isSuperAdmin) means every permission.
const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    permissions: { type: [String], default: [] },
    isSuperAdmin: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Role = mongoose.models.Role || mongoose.model('Role', roleSchema);
