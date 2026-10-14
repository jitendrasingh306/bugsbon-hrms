import { z } from 'zod';
import { AuditLog } from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { objectIdSchema } from '../validators/common.js';

export const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(60).optional(),
  actor: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const listAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, action, entityType, actor, from, to } = req.valid.query;
  const filter = {};
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  if (entityType) filter.entityType = entityType;
  if (actor) filter.actor = actor;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({
    items: items.map((a) => ({
      id: String(a._id),
      createdAt: a.createdAt,
      actorName: a.actorName,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      summary: a.summary,
      ip: a.ip,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});
