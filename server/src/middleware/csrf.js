import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

/** Synchronizer-token CSRF protection: every state-changing request needs X-CSRF-Token. */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.get('x-csrf-token');
  const expected = req.session?.csrfToken;
  const valid =
    typeof sent === 'string' &&
    typeof expected === 'string' &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!valid) return next(new AppError(403, 'Invalid or missing CSRF token. Please refresh and try again.', 'CSRF_INVALID'));
  next();
}
