import { z } from 'zod';
import { Notification } from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { objectIdSchema } from '../validators/common.js';

export const idParams = z.object({ id: objectIdSchema });
export const listQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const ser = (n) => ({ id: String(n._id), type: n.type, title: n.title, message: n.message, link: n.link, read: !!n.readAt, createdAt: n.createdAt });

export const listNotifications = asyncHandler(async (req, res) => {
  const { unread, page, limit } = req.valid.query;
  const filter = { user: req.user._id };
  if (unread === 'true') filter.readAt = null;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);
  res.json({ items: items.map(ser), total, unreadCount, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const unreadCount = asyncHandler(async (req, res) => {
  res.json({ unreadCount: await Notification.countDocuments({ user: req.user._id, readAt: null }) });
});

export const markRead = asyncHandler(async (req, res) => {
  const r = await Notification.updateOne({ _id: req.valid.params.id, user: req.user._id }, { $set: { readAt: new Date() } });
  if (!r.matchedCount) throw new AppError(404, 'Notification not found.', 'NOT_FOUND');
  res.status(204).end();
});

export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  res.status(204).end();
});
