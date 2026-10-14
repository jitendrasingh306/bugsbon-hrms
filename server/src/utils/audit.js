import { AuditLog } from '../models/AuditLog.js';

const SENSITIVE_KEY = /password|passwd|token|secret|hash|authorization|cookie/i;

/** Recursively redacts credential-like keys so they can never reach the audit log. */
export function sanitize(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value._bsontype) return String(value);
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const plain = typeof value.toObject === 'function' ? value.toObject() : value;
  const out = {};
  for (const [k, v] of Object.entries(plain)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

/** Low-level writer (also used by CLI scripts that have no request). */
export async function writeAudit(entry, session) {
  const actor = entry.actor ?? null;
  await AuditLog.create(
    [
      {
        actor: actor ? actor._id : null,
        actorName: actor ? actor.name || actor.email : 'system',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ? String(entry.entityId) : undefined,
        summary: entry.summary || '',
        metadata: sanitize(entry.metadata ?? {}),
        ip: entry.ip,
        userAgent: entry.userAgent,
      },
    ],
    session ? { session } : {}
  );
}

/** Request-aware writer. `data.actor` overrides req.user (needed for login events). */
export function audit(req, data, session) {
  const actor = data.actor !== undefined ? data.actor : req.user ?? null;
  return writeAudit(
    { ...data, actor, ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) },
    session
  );
}
