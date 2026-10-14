import fs from 'node:fs';
import { z } from 'zod';
import { Bug } from '../models/Bug.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { withTransaction } from '../utils/transaction.js';
import { objectIdSchema } from '../validators/common.js';
import { storedPath } from '../utils/files.js';
import { applyStatus, BUG_TRANSITIONS } from '../services/workflow.js';
import { notify } from '../services/notify.js';
import { bugScope, getBugForUser, same, userRef } from '../services/access.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sess = (session) => (session ? { session } : {});

export const idParams = z.object({ id: objectIdSchema });
export const attachmentParams = z.object({ id: objectIdSchema, name: z.string().regex(/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/) });
export const listQuery = z.object({
  status: z.enum(['open', 'in_progress', 'ready_for_retest', 'reopened', 'closed', 'unresolved']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  scope: z.enum(['all', 'assigned', 'reported']).default('all'),
  buildId: objectIdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const commentBody = z.object({ body: z.string().trim().min(1).max(3000) });
export const noteBody = z.object({ note: z.string().trim().max(3000).optional() });

const brief = (b) => (b && b.buildNumber ? { id: String(b._id), buildNumber: b.buildNumber, versionName: b.versionName, iteration: b.iteration, status: b.status } : b ? { id: String(b) } : null);

export function serializeBug(b, req) {
  const out = {
    id: String(b._id),
    bugNumber: b.bugNumber,
    title: b.title,
    description: b.description,
    stepsToReproduce: b.stepsToReproduce,
    expectedResult: b.expectedResult,
    actualResult: b.actualResult,
    severity: b.severity,
    status: b.status,
    build: brief(b.build),
    fixedInBuild: brief(b.fixedInBuild),
    reporter: userRef(b.reporter),
    assignee: userRef(b.assignee),
    currentTester: userRef(b.currentTester),
    attachments: (b.attachments || []).map((a) => ({ name: a.storedName, originalName: a.originalName, size: a.size })),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
  if (req) out.actions = bugActions(b, req);
  return out;
}

function bugActions(b, req) {
  const p = req.perms;
  const isAssignee = same(b.assignee, req.user);
  const inVerifierScope = p.has('bugs.view_all') || same(b.reporter, req.user) || same(b.currentTester, req.user);
  const verifier = !isAssignee && inVerifierScope;
  return {
    startFix: isAssignee && p.has('bugs.fix') && ['open', 'reopened'].includes(b.status),
    close: verifier && p.has('bugs.close') && b.status !== 'closed',
    closeNeedsNote: b.status !== 'ready_for_retest',
    reopen: verifier && p.has('bugs.verify') && ['ready_for_retest', 'closed'].includes(b.status),
    comment: true,
  };
}

export const listBugs = asyncHandler(async (req, res) => {
  const { status, severity, scope, buildId, q, page, limit } = req.valid.query;
  const filter = { ...bugScope(req) };
  if (status === 'unresolved') filter.status = { $ne: 'closed' };
  else if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (scope === 'assigned') filter.assignee = req.user._id;
  if (scope === 'reported') filter.reporter = req.user._id;
  if (buildId) filter.build = buildId;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$and = [{ $or: [{ bugNumber: rx }, { title: rx }] }];
  }
  const [items, total] = await Promise.all([
    Bug.find(filter)
      .populate('reporter assignee', 'name email')
      .populate('build fixedInBuild', 'buildNumber versionName iteration status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Bug.countDocuments(filter),
  ]);
  res.json({ items: items.map((b) => serializeBug(b, req)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const getBug = asyncHandler(async (req, res) => {
  const bug = await getBugForUser(req, req.valid.params.id);
  res.json({
    bug: serializeBug(bug, req),
    comments: bug.comments.map((c) => ({ id: String(c._id), author: userRef(c.author), authorName: c.authorName, body: c.body, createdAt: c.createdAt })),
    history: bug.history,
  });
});

async function mutate(req, res, { action, to, note, guard, notifyTo, title }) {
  const existing = await getBugForUser(req, req.valid.params.id, { populate: false });
  guard(existing);
  await withTransaction(async (session) => {
    const b = await Bug.findById(existing._id).session(session || null);
    applyStatus(b, BUG_TRANSITIONS, to, req.user, action, note);
    if (to === 'closed') {
      b.closedAt = new Date();
      b.closedBy = req.user._id;
    } else if (to === 'reopened') {
      b.closedAt = undefined;
      b.closedBy = undefined;
    }
    await b.save(sess(session));
    await notify(notifyTo(b), { actor: req.user, type: `bug.${action}`, title: title(b), message: note || '', link: `/bugs/${b._id}`, entityType: 'Bug', entityId: b._id }, session);
    await audit(req, { action: `bug.${action}`, entityType: 'Bug', entityId: b._id, summary: `${b.bugNumber} ${action} by ${req.user.name}`, metadata: { note } }, session);
  });
  const fresh = await getBugForUser(req, existing._id);
  res.json({ bug: serializeBug(fresh, req) });
}

export const startFix = asyncHandler((req, res) =>
  mutate(req, res, {
    action: 'fix_started',
    to: 'in_progress',
    note: '',
    guard: (b) => {
      if (!same(b.assignee, req.user) || !req.perms.has('bugs.fix')) throw new AppError(403, 'Only the developer assigned to this bug can start a fix.', 'FORBIDDEN');
    },
    notifyTo: (b) => [b.reporter, b.currentTester],
    title: (b) => `Developer started fixing ${b.bugNumber}`,
  })
);

function verifierGuard(req, perm) {
  return (b) => {
    if (same(b.assignee, req.user)) throw new AppError(403, 'You cannot verify, close or reopen a bug that is assigned to you.', 'FORBIDDEN');
    const inScope = req.perms.has('bugs.view_all') || same(b.reporter, req.user) || same(b.currentTester, req.user);
    if (!req.perms.has(perm) || !inScope) throw new AppError(403, 'You do not have permission to do this on this bug.', 'FORBIDDEN');
  };
}

export const closeBug = asyncHandler((req, res) => {
  const note = req.valid.body.note || '';
  const guard = verifierGuard(req, 'bugs.close');
  return mutate(req, res, {
    action: 'closed',
    to: 'closed',
    note,
    guard: (b) => {
      guard(b);
      if (b.status !== 'ready_for_retest' && note.length < 5) {
        throw new AppError(400, 'A reason is required to close a bug that has not been fixed and retested.', 'VALIDATION_ERROR');
      }
    },
    notifyTo: (b) => [b.assignee, b.reporter],
    title: (b) => `${b.bugNumber} was closed`,
  });
});

export const reopenBug = asyncHandler((req, res) => {
  const note = req.valid.body.note || '';
  const guard = verifierGuard(req, 'bugs.verify');
  return mutate(req, res, {
    action: 'reopened',
    to: 'reopened',
    note,
    guard: (b) => {
      guard(b);
      if (note.length < 5) throw new AppError(400, 'Please explain why the bug is reopened (at least 5 characters).', 'VALIDATION_ERROR');
    },
    notifyTo: (b) => [b.assignee],
    title: (b) => `${b.bugNumber} was reopened - fix did not work`,
  });
});

export const addComment = asyncHandler(async (req, res) => {
  const existing = await getBugForUser(req, req.valid.params.id, { populate: false });
  await withTransaction(async (session) => {
    const b = await Bug.findById(existing._id).session(session || null);
    b.comments.push({ author: req.user._id, authorName: req.user.name, body: req.valid.body.body });
    await b.save(sess(session));
    await notify([b.assignee, b.reporter, b.currentTester], { actor: req.user, type: 'bug.comment', title: `New comment on ${b.bugNumber}`, message: req.valid.body.body.slice(0, 200), link: `/bugs/${b._id}`, entityType: 'Bug', entityId: b._id }, session);
    await audit(req, { action: 'bug.commented', entityType: 'Bug', entityId: b._id, summary: `${req.user.name} commented on ${b.bugNumber}` }, session);
  });
  res.status(201).json({ ok: true });
});

export const getAttachment = asyncHandler(async (req, res) => {
  const bug = await getBugForUser(req, req.valid.params.id, { populate: false });
  const att = bug.attachments.find((a) => a.storedName === req.valid.params.name);
  if (!att) throw new AppError(404, 'File not found.', 'NOT_FOUND');
  const p = storedPath('bug-images', att.storedName);
  if (!fs.existsSync(p)) throw new AppError(410, 'The file is missing on the server.', 'FILE_MISSING');
  res.setHeader('Content-Type', att.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(p);
});
