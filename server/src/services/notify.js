import { Notification } from '../models/Notification.js';
import { Role } from '../models/Role.js';
import { User } from '../models/User.js';

/** Creates in-app notifications (deduplicated, never notifies the person who caused the event). */
export async function notify(userIds, { actor, type, title, message = '', link = '', entityType, entityId }, session) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))].filter(
    (id) => !actor || id !== String(actor._id)
  );
  if (!unique.length) return;
  await Notification.insertMany(
    unique.map((user) => ({
      user,
      type,
      title,
      message,
      link,
      entityType,
      entityId: entityId ? String(entityId) : undefined,
    })),
    session ? { session } : {}
  );
}

/** Active users whose roles grant `permission` (used for tester pick-lists and manager alerts). */
export async function usersWithPermission(permission, { excludeIds = [] } = {}) {
  const roles = await Role.find({ $or: [{ permissions: permission }, { permissions: '*' }, { isSuperAdmin: true }] }, '_id');
  if (!roles.length) return [];
  return User.find({
    roles: { $in: roles.map((r) => r._id) },
    isActive: true,
    _id: { $nin: excludeIds },
  }).sort({ name: 1 });
}
