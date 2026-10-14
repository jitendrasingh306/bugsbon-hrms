import { PERMISSIONS, ROLE_DEFINITIONS, ADDED_PERMISSIONS_BY_ROLE, DEFAULT_DEPARTMENTS, DEFAULT_DESIGNATIONS } from '../config/permissions.js';
import { Permission } from '../models/Permission.js';
import { Role } from '../models/Role.js';
import { Department } from '../models/Department.js';
import { Designation } from '../models/Designation.js';

/**
 * Idempotent. Existing roles keep any permission changes an admin made,
 * unless syncRoles = true (resets the five system roles to the shipped defaults).
 */
export async function seedPermissionsAndRoles({ syncRoles = false } = {}) {
  const newlyAdded = new Set();
  for (const p of PERMISSIONS) {
    const r = await Permission.updateOne(
      { key: p.key },
      { $set: { module: p.module, description: p.description } },
      { upsert: true }
    );
    if (r.upsertedCount) newlyAdded.add(p.key);
  }
  for (const def of ROLE_DEFINITIONS) {
    const existing = await Role.findOne({ key: def.key });
    if (existing && !syncRoles) {
      // Upgrade path: give existing system roles only the permissions that are new in this release.
      const fresh = (ADDED_PERMISSIONS_BY_ROLE[def.key] || []).filter((k) => newlyAdded.has(k) && !existing.permissions.includes(k));
      if (fresh.length) await Role.updateOne({ _id: existing._id }, { $addToSet: { permissions: { $each: fresh } } });
    }
    if (!existing) {
      await Role.create({ ...def, isSystem: true });
    } else if (syncRoles) {
      existing.set({
        name: def.name,
        description: def.description,
        permissions: def.permissions,
        isSuperAdmin: def.isSuperAdmin,
      });
      await existing.save();
    }
  }
}

export async function seedOrganization() {
  for (const name of DEFAULT_DEPARTMENTS) {
    await Department.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
  }
  for (const title of DEFAULT_DESIGNATIONS) {
    await Designation.updateOne({ title }, { $setOnInsert: { title } }, { upsert: true });
  }
}
