import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    module: { type: String, required: true },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Permission = mongoose.models.Permission || mongoose.model('Permission', permissionSchema);
