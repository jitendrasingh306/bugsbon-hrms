import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildPermissions } from './rbac.js';

/** Resolves the session to a user on every request. Stale/disabled sessions are silently dropped. */
export const loadUser = asyncHandler(async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) return next();

  const user = await User.findById(userId).populate('roles');
  if (!user || !user.isActive || user.sessionVersion !== req.session.sessionVersion) {
    delete req.session.userId;
    delete req.session.sessionVersion;
    return next();
  }
  req.user = user;
  req.perms = buildPermissions(user);
  next();
});

/**
 * Requires a signed-in user. Users flagged mustChangePassword are blocked from
 * everything except endpoints that opt in with { allowPasswordChange: true }.
 */
export const requireAuth =
  ({ allowPasswordChange = false } = {}) =>
  (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'Please sign in to continue.', 'UNAUTHENTICATED'));
    if (req.user.mustChangePassword && !allowPasswordChange) {
      return next(new AppError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED'));
    }
    next();
  };
