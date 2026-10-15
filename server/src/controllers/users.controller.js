import crypto from 'node:crypto';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';
import { Permission } from '../models/Permission.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { sha256, hashPassword } from '../utils/password.js';
import { objectIdSchema, emailSchema } from '../validators/common.js';
import { buildPermissions } from '../middleware/rbac.js';

export const idParams = z.object({ id: objectIdSchema });

const mobileNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid mobile number')
  .optional()
  .or(z.literal(''));

function normalizeMobileNumber(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/[\s()-]/g, '');
  return normalized || undefined;
}

async function ensureMobileAvailable(mobileNumber, currentUserId = null) {
  if (!mobileNumber) return;
  const query = { mobileNumber };
  if (currentUserId) query._id = { $ne: currentUserId };
  if (await User.exists(query)) {
    throw new AppError(409, 'A user with this mobile number already exists.', 'DUPLICATE');
  }
}

export const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().populate('roles', 'key name isSuperAdmin').populate('reportsTo', 'name').sort({ name: 1 }).limit(500);
  res.json({
    items: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      mobileNumber: u.mobileNumber || '',
      isActive: u.isActive,
      roles: u.roles.map((r) => ({ key: r.key, name: r.name })),
      roleIds: u.roles.map((r) => String(r._id)),
      reportsTo: u.reportsTo ? { id: String(u.reportsTo._id), name: u.reportsTo.name } : null,
      lastLoginAt: u.lastLoginAt || null,
      lockedUntil: u.lockUntil && u.lockUntil > new Date() ? u.lockUntil : null,
      createdAt: u.createdAt,
    })),
  });
});

/**
 * Free replacement for "emailed reset links": an authorised admin generates a
 * one-time code (valid 1 hour) and hands it to the person. Only a hash is stored.
 */
export const issuePasswordResetToken = asyncHandler(async (req, res) => {
  const target = await User.findById(req.valid.params.id).populate('roles');
  if (!target) throw new AppError(404, 'User not found.', 'NOT_FOUND');

  if (target.roles.some((r) => r.isSuperAdmin) && !req.perms.superAdmin) {
    throw new AppError(403, 'Only a Founder can reset a Founder account.', 'FORBIDDEN');
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await User.updateOne(
    { _id: target._id },
    { $set: { passwordResetTokenHash: sha256(token), passwordResetExpires: expiresAt } }
  );
  await audit(req, {
    action: 'user.password_reset_issued',
    entityType: 'User',
    entityId: target._id,
    summary: `Password reset code issued for ${target.email}`,
    metadata: { expiresAt },
  });
  res.json({ email: target.email, token, expiresAt });
});

export const listRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find().sort({ name: 1 });
  res.json({
    items: roles.map((r) => ({
      id: String(r._id),
      key: r.key,
      name: r.name,
      description: r.description,
      isSuperAdmin: r.isSuperAdmin,
      isSystem: r.isSystem,
      permissions: r.permissions,
    })),
  });
});

export const listPermissions = asyncHandler(async (req, res) => {
  const items = await Permission.find().sort({ module: 1, key: 1 });
  res.json({ items: items.map((p) => ({ key: p.key, module: p.module, description: p.description })) });
});

// ---------------------------------------------------------------- create / edit users

export const createUserBody = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  mobileNumber: mobileNumberSchema,
  roleIds: z.array(objectIdSchema).min(1, 'Choose at least one role').max(10),
  reportsToId: z.preprocess((v) => (v === '' ? null : v), objectIdSchema.nullable().optional()),
});
export const updateUserBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  mobileNumber: mobileNumberSchema,
  roleIds: z.array(objectIdSchema).min(1).max(10).optional(),
  isActive: z.boolean().optional(),
  reportsToId: z.preprocess((v) => (v === '' ? null : v), objectIdSchema.nullable().optional()),
});

/** A user can only report to an active manager-type user (one who may assign daily tasks). */
async function resolveReportsTo(id, selfId) {
  if (!id) return null;
  if (selfId && String(id) === String(selfId)) throw new AppError(400, 'A user cannot report to themselves.', 'VALIDATION_ERROR');
  const m = await User.findById(id).populate('roles');
  if (!m || !m.isActive || !buildPermissions(m).has('daily.assign')) {
    throw new AppError(400, 'The selected manager must be an active user who can assign daily tasks.', 'VALIDATION_ERROR');
  }
  return m._id;
}

const tempPassword = () => `Bb-${crypto.randomBytes(6).toString('hex')}-${crypto.randomInt(10, 99)}`;

async function resolveRoles(req, roleIds) {
  const roles = await Role.find({ _id: { $in: roleIds } });
  if (roles.length !== new Set(roleIds).size) throw new AppError(400, 'One or more roles do not exist.', 'VALIDATION_ERROR');
  if (roles.some((r) => r.isSuperAdmin) && !req.perms.superAdmin) {
    throw new AppError(403, 'Only a Founder can assign the Founder role.', 'FORBIDDEN');
  }
  return roles;
}

export const createUser = asyncHandler(async (req, res) => {
  const { name, email, roleIds, reportsToId } = req.valid.body;
  const mobileNumber = normalizeMobileNumber(req.valid.body.mobileNumber);
  const roles = await resolveRoles(req, roleIds);
  const reportsTo = await resolveReportsTo(reportsToId);
  if (await User.exists({ email })) throw new AppError(409, 'A user with this email already exists.', 'DUPLICATE');
  await ensureMobileAvailable(mobileNumber);
  const password = tempPassword();
  const user = await User.create({
    name,
    email,
    ...(mobileNumber ? { mobileNumber } : {}),
    roles: roles.map((r) => r._id),
    reportsTo,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    passwordChangedAt: new Date(),
  });
  await audit(req, { action: 'user.created', entityType: 'User', entityId: user._id, summary: `User ${email} created with role(s) ${roles.map((r) => r.name).join(', ')}`, metadata: { roles: roles.map((r) => r.key) } });
  // The temporary password is shown once and never stored in readable form.
  res.status(201).json({ user: { id: String(user._id), name, email, mobileNumber: user.mobileNumber || '' }, temporaryPassword: password });
});

export const updateUser = asyncHandler(async (req, res) => {
  const { name, roleIds, isActive, reportsToId } = req.valid.body;
  const mobileNumber = normalizeMobileNumber(req.valid.body.mobileNumber);
  const target = await User.findById(req.valid.params.id).populate('roles');
  if (!target) throw new AppError(404, 'User not found.', 'NOT_FOUND');
  const targetIsFounder = target.roles.some((r) => r.isSuperAdmin);
  if (targetIsFounder && !req.perms.superAdmin) throw new AppError(403, 'Only a Founder can change a Founder account.', 'FORBIDDEN');

  const isSelf = String(target._id) === String(req.user._id);
  if (isSelf && isActive === false) throw new AppError(400, 'You cannot deactivate your own account.', 'VALIDATION_ERROR');

  const changes = {};
  const unsetChanges = {};
  let newRoles = null;
  if (roleIds) {
    newRoles = await resolveRoles(req, roleIds);
    changes.roles = newRoles.map((r) => r._id);
  }
  if (name) changes.name = name;
  if (isActive !== undefined) changes.isActive = isActive;
  if (reportsToId !== undefined) changes.reportsTo = await resolveReportsTo(reportsToId, target._id);
  if (req.valid.body.mobileNumber !== undefined) {
    await ensureMobileAvailable(mobileNumber, target._id);
    if (mobileNumber) changes.mobileNumber = mobileNumber;
    else unsetChanges.mobileNumber = '';
  }

  const losesFounder = (newRoles && targetIsFounder && !newRoles.some((r) => r.isSuperAdmin)) || (isActive === false && targetIsFounder);
  if (losesFounder) {
    const founderRoles = await Role.find({ isSuperAdmin: true }, '_id');
    const others = await User.countDocuments({ _id: { $ne: target._id }, isActive: true, roles: { $in: founderRoles.map((r) => r._id) } });
    if (others === 0) throw new AppError(400, 'At least one active Founder must remain.', 'VALIDATION_ERROR');
  }

  const update = {};
  if (Object.keys(changes).length) update.$set = changes;
  if (Object.keys(unsetChanges).length) update.$unset = unsetChanges;
  if (roleIds || isActive === false) update.$inc = { sessionVersion: 1 }; // forces re-login with the new access
  await User.updateOne({ _id: target._id }, update);
  await audit(req, { action: 'user.updated', entityType: 'User', entityId: target._id, summary: `User ${target.email} updated`, metadata: { name, isActive, roles: newRoles?.map((r) => r.key), reportsTo: reportsToId } });
  res.json({ ok: true });
});
