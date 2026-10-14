import { z } from 'zod';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { hashPassword, verifyPassword, DUMMY_HASH, sha256, safeEqualHex } from '../utils/password.js';
import { startUserSession, destroySession, SESSION_COOKIE } from '../utils/session.js';
import { ensureCsrfToken } from '../middleware/csrf.js';
import { serializeUser } from '../middleware/rbac.js';
import { emailSchema, passwordSchema } from '../validators/common.js';

export const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const resetConfirmBody = z.object({
  email: emailSchema,
  token: z.string().trim().min(10).max(200),
  newPassword: passwordSchema,
});

export const getCsrf = (req, res) => res.json({ csrfToken: ensureCsrfToken(req) });

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.valid.body;
  const invalid = () => new AppError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');

  const user = await User.findOne({ email }).select('+passwordHash').populate('roles');
  if (!user) {
    await verifyPassword(password, DUMMY_HASH); // keep timing similar to a real check
    await audit(req, { actor: null, action: 'auth.login_failed', entityType: 'User', summary: 'Failed sign-in (unknown account)', metadata: { email } });
    throw invalid();
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    await audit(req, { actor: user, action: 'auth.login_blocked', entityType: 'User', entityId: user._id, summary: `Sign-in blocked: ${user.email} is locked` });
    throw new AppError(423, 'This account is temporarily locked after repeated failed sign-ins. Try again later or ask an administrator.', 'ACCOUNT_LOCKED');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const updated = await User.findByIdAndUpdate(user._id, { $inc: { failedLoginAttempts: 1 } }, { new: true });
    if (updated.failedLoginAttempts >= env.MAX_FAILED_LOGINS) {
      await User.updateOne(
        { _id: user._id },
        { $set: { lockUntil: new Date(Date.now() + env.LOCKOUT_MINUTES * 60 * 1000), failedLoginAttempts: 0 } }
      );
    }
    await audit(req, { actor: user, action: 'auth.login_failed', entityType: 'User', entityId: user._id, summary: `Failed sign-in for ${user.email}` });
    throw invalid();
  }

  if (!user.isActive) {
    await audit(req, { actor: user, action: 'auth.login_blocked', entityType: 'User', entityId: user._id, summary: `Sign-in blocked: ${user.email} is deactivated` });
    throw new AppError(403, 'This account has been deactivated. Contact your administrator.', 'ACCOUNT_INACTIVE');
  }

  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const csrfToken = await startUserSession(req, user);
  await audit(req, { actor: user, action: 'auth.login', entityType: 'User', entityId: user._id, summary: `${user.email} signed in` });
  res.json({ user: serializeUser(user), csrfToken });
});

export const logout = asyncHandler(async (req, res) => {
  if (req.user) {
    await audit(req, { action: 'auth.logout', entityType: 'User', entityId: req.user._id, summary: `${req.user.email} signed out` });
  }
  await destroySession(req);
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
});

export const me = (req, res) => res.json({ user: serializeUser(req.user) });

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.valid.body;
  const user = await User.findById(req.user._id).select('+passwordHash').populate('roles');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'Current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
  }
  if (currentPassword === newPassword) {
    throw new AppError(400, 'New password must be different from the current password.', 'PASSWORD_REUSED');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  user.sessionVersion += 1; // signs out every other session
  await user.save();

  const csrfToken = await startUserSession(req, user);
  await audit(req, { actor: user, action: 'auth.password_changed', entityType: 'User', entityId: user._id, summary: `${user.email} changed their password` });
  res.json({ user: serializeUser(user), csrfToken });
});

export const confirmPasswordReset = asyncHandler(async (req, res) => {
  const { email, token, newPassword } = req.valid.body;
  const fail = () => new AppError(400, 'Invalid or expired reset code.', 'INVALID_RESET_TOKEN');

  const user = await User.findOne({ email }).select('+passwordResetTokenHash +passwordResetExpires');
  const valid =
    user &&
    user.passwordResetTokenHash &&
    user.passwordResetExpires &&
    user.passwordResetExpires > new Date() &&
    safeEqualHex(sha256(token), user.passwordResetTokenHash);
  if (!valid) throw fail();

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedLoginAttempts: 0,
      },
      $unset: { lockUntil: '', passwordResetTokenHash: '', passwordResetExpires: '' },
      $inc: { sessionVersion: 1 },
    }
  );
  await audit(req, { actor: user, action: 'auth.password_reset_completed', entityType: 'User', entityId: user._id, summary: `${user.email} reset their password` });
  res.json({ message: 'Password updated. You can now sign in.' });
});
