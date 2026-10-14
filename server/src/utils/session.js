import crypto from 'node:crypto';

export const SESSION_COOKIE = 'bugsbon.sid';

export const regenerateSession = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

export const destroySession = (req) =>
  new Promise((resolve) => (req.session ? req.session.destroy(() => resolve()) : resolve()));

/** Creates a brand-new session id (prevents session fixation) and binds it to the user. */
export async function startUserSession(req, user) {
  await regenerateSession(req);
  req.session.userId = String(user._id);
  req.session.sessionVersion = user.sessionVersion;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}
