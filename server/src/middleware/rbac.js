import { AppError } from '../utils/AppError.js';

/** Collects the effective permissions of a user (roles must be populated). */
export function buildPermissions(user) {
  const set = new Set();
  let superAdmin = false;
  for (const role of user.roles || []) {
    if (role.isSuperAdmin) superAdmin = true;
    for (const p of role.permissions || []) set.add(p);
  }
  return {
    superAdmin,
    list: [...set].sort(),
    has: (key) => superAdmin || set.has('*') || set.has(key),
  };
}

export function serializeUser(user) {
  const perms = buildPermissions(user);
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    roles: (user.roles || []).map((r) => ({ key: r.key, name: r.name })),
    isSuperAdmin: perms.superAdmin,
    permissions: perms.superAdmin ? ['*'] : perms.list,
    mustChangePassword: user.mustChangePassword,
    managedDepartments: (user.managedDepartments || []).map(String),
    lastLoginAt: user.lastLoginAt || null,
  };
}

/** All listed permissions are required. Always enforced on the server. */
export const requirePermission =
  (...keys) =>
  (req, res, next) => {
    if (!req.perms) return next(new AppError(401, 'Authentication required.', 'UNAUTHENTICATED'));
    if (keys.every((k) => req.perms.has(k))) return next();
    return next(new AppError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
  };

/** At least one of the listed permissions is required. */
export const requireAnyPermission =
  (...keys) =>
  (req, res, next) => {
    if (!req.perms) return next(new AppError(401, 'Authentication required.', 'UNAUTHENTICATED'));
    if (keys.some((k) => req.perms.has(k))) return next();
    return next(new AppError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
  };
