import { z } from 'zod';
import mongoose from 'mongoose';
import { DailyTask, TASK_CATEGORIES } from '../models/DailyTask.js';
import { EodReport } from '../models/EodReport.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { withTransaction } from '../utils/transaction.js';
import { addDays, isDateKey, todayKey, toMinutes } from '../utils/dates.js';
import { objectIdSchema } from '../validators/common.js';
import { notify, usersWithPermission } from '../services/notify.js';

const sess = (session) => (session ? { session } : {});
const same = (a, b) => a != null && b != null && String(a._id ?? a) === String(b._id ?? b);
const dateKeySchema = z.string().refine(isDateKey, 'Use the format YYYY-MM-DD');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const idParams = z.object({ id: objectIdSchema });
export const dateQuery = z.object({ date: dateKeySchema.optional() });
export const teamQuery = z.object({ date: dateKeySchema.optional(), userId: objectIdSchema.optional() });
export const eodListQuery = z.object({
  scope: z.enum(['mine', 'team']).optional(),
  date: dateKeySchema.optional(),
  status: z.enum(['submitted', 'verified', 'returned']).optional(),
  userId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const slotFields = {
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(TASK_CATEGORIES).default('other'),
  target: z.string().trim().max(200).optional(),
  startTime: timeSchema,
  endTime: timeSchema,
};
const endAfterStart = (s) => toMinutes(s.endTime) > toMinutes(s.startTime);
const slotSchema = z.object(slotFields).refine(endAfterStart, { message: 'End time must be after start time', path: ['endTime'] });

export const assignBody = z.object({
  assigneeIds: z.array(objectIdSchema).min(1, 'Choose at least one person').max(20),
  date: dateKeySchema,
  tasks: z.array(slotSchema).min(1, 'Add at least one time slot').max(20),
});
export const updateTaskBody = z
  .object({ ...slotFields, category: z.enum(TASK_CATEGORIES) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export const cancelBody = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(300) });
export const statusBody = z
  .object({ status: z.enum(['pending', 'in_progress', 'completed']).optional(), outputNotes: z.string().trim().max(2000).optional() })
  .refine((b) => b.status !== undefined || b.outputNotes !== undefined, { message: 'Nothing to update' });
export const eodBody = z.object({
  date: dateKeySchema.optional(),
  summary: z.string().trim().min(10, 'Please write at least 10 characters').max(3000),
  blockers: z.string().trim().max(1500).optional(),
});
export const verifyBody = z.object({
  comment: z.string().trim().max(1000).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
export const returnBody = z.object({ comment: z.string().trim().min(5, 'Tell the employee what to correct (min. 5 characters)').max(1000) });

const TASK_TRANSITIONS = { pending: ['in_progress', 'completed'], in_progress: ['completed', 'pending'], completed: ['in_progress'] };

// ---------------------------------------------------------------- scope helpers

/** Whose daily plan the caller may manage / review: everyone (daily.view_all) or people who report to them. */
function inScope(req, user) {
  if (req.perms.has('daily.view_all')) return true;
  if (!['daily.view_team', 'daily.assign', 'daily.eod_review'].some((k) => req.perms.has(k))) return false;
  return same(user.reportsTo, req.user);
}
const teamFilter = (req) => (req.perms.has('daily.view_all') ? {} : { reportsTo: req.user._id });

async function loadScopedUser(req, userId) {
  const u = await User.findById(userId);
  if (!u || !u.isActive || !inScope(req, u)) throw new AppError(404, 'Person not found in your team.', 'NOT_FOUND');
  return u;
}

async function reviewersOf(user) {
  if (user.reportsTo) {
    const m = await User.findOne({ _id: user.reportsTo, isActive: true }, '_id');
    if (m) return [m._id];
  }
  return (await usersWithPermission('daily.view_all', { excludeIds: [user._id] })).map((u) => u._id);
}

// ---------------------------------------------------------------- serializers / maths

const mini = (u) => (u && u.name ? { id: String(u._id), name: u.name } : u ? { id: String(u) } : null);

export function serializeTask(t) {
  return {
    id: String(t._id),
    date: t.date,
    assignee: mini(t.assignee),
    assignedBy: mini(t.assignedBy),
    title: t.title,
    description: t.description,
    category: t.category,
    target: t.target,
    startTime: t.startTime,
    endTime: t.endTime,
    minutes: t.endMin - t.startMin,
    status: t.status,
    outputNotes: t.outputNotes,
    startedAt: t.startedAt || null,
    completedAt: t.completedAt || null,
    cancelReason: t.cancelReason,
  };
}

/** Planned vs actual for a day (cancelled slots are not part of the plan). */
export function computeMetrics(tasks) {
  const live = tasks.filter((t) => t.status !== 'cancelled');
  const mins = (t) => t.endMin - t.startMin;
  const plannedMinutes = live.reduce((a, t) => a + mins(t), 0);
  const done = live.filter((t) => t.status === 'completed');
  const completedMinutes = done.reduce((a, t) => a + mins(t), 0);
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  return {
    plannedCount: live.length,
    completedCount: done.length,
    inProgressCount: live.filter((t) => t.status === 'in_progress').length,
    pendingCount: live.filter((t) => t.status === 'pending').length,
    plannedMinutes,
    completedMinutes,
    completionPct: pct(done.length, live.length),
    minutesPct: pct(completedMinutes, plannedMinutes),
  };
}

function serializeEod(r, req) {
  const snap = r.snapshot || {};
  const tasks = snap.tasks || [];
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const mine = same(r.user, req.user);
  const canReview = req.perms.has('daily.eod_review') && !mine && (req.perms.has('daily.view_all') || same(r.user?.reportsTo, req.user));
  return {
    id: String(r._id),
    user: mini(r.user),
    date: r.date,
    summary: r.summary,
    blockers: r.blockers,
    status: r.status,
    submittedAt: r.submittedAt,
    resubmitCount: r.resubmitCount,
    reviewer: mini(r.reviewer),
    reviewedAt: r.reviewedAt || null,
    reviewerComment: r.reviewerComment,
    rating: r.rating || null,
    snapshot: {
      tasks,
      plannedCount: snap.plannedCount || 0,
      completedCount: snap.completedCount || 0,
      inProgressCount: snap.inProgressCount || 0,
      pendingCount: snap.pendingCount || 0,
      plannedMinutes: snap.plannedMinutes || 0,
      completedMinutes: snap.completedMinutes || 0,
      completionPct: pct(snap.completedCount, snap.plannedCount),
      minutesPct: pct(snap.completedMinutes, snap.plannedMinutes),
    },
    actions: { verify: canReview && r.status === 'submitted', return: canReview && r.status === 'submitted' },
  };
}

const eodBrief = (e) => (e ? { id: String(e._id), status: e.status, submittedAt: e.submittedAt, reviewerComment: e.reviewerComment, rating: e.rating || null } : null);

// ---------------------------------------------------------------- own schedule

export const mySchedule = asyncHandler(async (req, res) => {
  const date = req.valid.query.date || todayKey();
  const today = todayKey();
  const [tasks, eod] = await Promise.all([
    DailyTask.find({ assignee: req.user._id, date }).populate('assignedBy', 'name').sort({ startMin: 1 }),
    EodReport.findOne({ user: req.user._id, date }),
  ]);
  const locked = !!eod && eod.status !== 'returned';
  res.json({
    date,
    today,
    isToday: date === today,
    isFuture: date > today,
    tasks: tasks.map(serializeTask),
    metrics: computeMetrics(tasks),
    eod: eodBrief(eod),
    locked,
    canSubmitEod: req.perms.has('daily.eod_submit') && date <= today && date >= addDays(today, -3) && (!eod || eod.status === 'returned'),
  });
});

export const updateMyTaskStatus = asyncHandler(async (req, res) => {
  const { status, outputNotes } = req.valid.body;
  const task = await DailyTask.findOne({ _id: req.valid.params.id, assignee: req.user._id });
  if (!task) throw new AppError(404, 'Task not found.', 'NOT_FOUND');
  if (task.status === 'cancelled') throw new AppError(409, 'This task was cancelled by your manager.', 'INVALID_TRANSITION');
  if (task.date > todayKey()) throw new AppError(409, 'This task is scheduled for a future day and cannot be updated yet.', 'FUTURE_TASK');
  const eod = await EodReport.findOne({ user: req.user._id, date: task.date });
  if (eod && eod.status !== 'returned') throw new AppError(409, 'The end-of-day report for this day is already submitted, so the tasks are locked.', 'DAY_LOCKED');

  const from = task.status;
  const to = status || from;
  if (to !== from && !TASK_TRANSITIONS[from]?.includes(to)) {
    throw new AppError(409, `A task cannot change from "${from}" to "${to}".`, 'INVALID_TRANSITION');
  }
  const notes = outputNotes !== undefined ? outputNotes : task.outputNotes;
  if (to === 'completed' && notes.length < 3) {
    throw new AppError(400, 'Please enter output notes (what was done / the result) before completing the task.', 'OUTPUT_REQUIRED');
  }
  if (to === from && outputNotes === undefined) throw new AppError(409, `The task is already ${from}.`, 'INVALID_TRANSITION');

  task.outputNotes = notes;
  if (to !== from) {
    task.status = to;
    if (to === 'in_progress' && !task.startedAt) task.startedAt = new Date();
    task.completedAt = to === 'completed' ? new Date() : undefined;
  }
  task.history.push({ by: req.user._id, byName: req.user.name, action: to !== from ? 'status_changed' : 'notes_updated', fromStatus: from, toStatus: to, note: to !== from ? '' : 'Output notes updated' });
  await task.save();
  await audit(req, { action: to !== from ? 'dailytask.status_changed' : 'dailytask.notes_updated', entityType: 'DailyTask', entityId: task._id, summary: `${req.user.name}: "${task.title}" ${to !== from ? `${from} -> ${to}` : 'output notes updated'} (${task.date})` });
  res.json({ task: serializeTask(task), metrics: computeMetrics(await DailyTask.find({ assignee: req.user._id, date: task.date })) });
});

// ---------------------------------------------------------------- manager: assign / edit / cancel

export const listAssignees = asyncHandler(async (req, res) => {
  const users = await User.find({ isActive: true, ...teamFilter(req) }, 'name email').populate('roles', 'name').sort({ name: 1 }).limit(300);
  res.json({ items: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, roles: u.roles.map((r) => r.name) })) });
});

async function conflictsFor(assigneeId, date, slots, excludeId) {
  const existing = await DailyTask.find({ assignee: assigneeId, date, status: { $ne: 'cancelled' }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  const out = [];
  for (const s of slots) {
    const a = toMinutes(s.startTime);
    const b = toMinutes(s.endTime);
    for (const t of existing) if (a < t.endMin && t.startMin < b) out.push(`${s.startTime}-${s.endTime} overlaps "${t.title}" (${t.startTime}-${t.endTime})`);
  }
  return out;
}

export const assignTasks = asyncHandler(async (req, res) => {
  const { assigneeIds, date, tasks } = req.valid.body;
  if (date < todayKey()) throw new AppError(400, 'Tasks cannot be assigned to a past date.', 'VALIDATION_ERROR');

  // Slots of one request must not overlap each other.
  const sorted = [...tasks].sort((x, y) => toMinutes(x.startTime) - toMinutes(y.startTime));
  for (let i = 1; i < sorted.length; i += 1) {
    if (toMinutes(sorted[i].startTime) < toMinutes(sorted[i - 1].endTime)) {
      throw new AppError(400, `Time slots overlap: ${sorted[i - 1].startTime}-${sorted[i - 1].endTime} and ${sorted[i].startTime}-${sorted[i].endTime}.`, 'VALIDATION_ERROR');
    }
  }
  const ids = [...new Set(assigneeIds.map(String))];
  const people = [];
  for (const id of ids) people.push(await loadScopedUser(req, id));

  // Validate every person first so nothing is created when one of them has a problem.
  for (const p of people) {
    const eod = await EodReport.findOne({ user: p._id, date }, 'status');
    if (eod && eod.status !== 'returned') throw new AppError(409, `${p.name}'s day ${date} is already closed with an end-of-day report.`, 'DAY_LOCKED');
    const conflicts = await conflictsFor(p._id, date, tasks);
    if (conflicts.length) throw new AppError(409, `${p.name}: ${conflicts[0]}${conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : ''}`, 'SLOT_CONFLICT');
  }

  const docs = [];
  for (const p of people) {
    for (const t of tasks) {
      docs.push({
        date,
        assignee: p._id,
        assignedBy: req.user._id,
        title: t.title,
        description: t.description || '',
        category: t.category,
        target: t.target || '',
        startTime: t.startTime,
        endTime: t.endTime,
        startMin: toMinutes(t.startTime),
        endMin: toMinutes(t.endTime),
        history: [{ by: req.user._id, byName: req.user.name, action: 'assigned', toStatus: 'pending', note: `${t.startTime}-${t.endTime}` }],
      });
    }
  }
  await withTransaction(async (session) => {
    await DailyTask.insertMany(docs, sess(session));
    for (const p of people) {
      await notify([p._id], { actor: req.user, type: 'daily.assigned', title: `${tasks.length} time-slot task(s) assigned for ${date}`, message: tasks.map((t) => `${t.startTime}-${t.endTime} ${t.title}`).join(' · ').slice(0, 300), link: `/daily?date=${date}`, entityType: 'DailyTask' }, session);
      await audit(req, { action: 'dailytask.created', entityType: 'User', entityId: p._id, summary: `${tasks.length} task(s) assigned to ${p.name} for ${date}`, metadata: { date, slots: tasks.map((t) => `${t.startTime}-${t.endTime} ${t.title}`) } }, session);
    }
  });
  res.status(201).json({ created: docs.length, people: people.length });
});

async function loadManagedTask(req, id) {
  const task = await DailyTask.findById(id);
  if (!task) throw new AppError(404, 'Task not found.', 'NOT_FOUND');
  const owner = await User.findById(task.assignee);
  if (!owner || !inScope(req, owner)) throw new AppError(404, 'Task not found.', 'NOT_FOUND');
  const eod = await EodReport.findOne({ user: task.assignee, date: task.date }, 'status');
  if (eod && eod.status !== 'returned') throw new AppError(409, 'The end-of-day report for this day is already submitted, so the plan is locked.', 'DAY_LOCKED');
  return { task, owner };
}

export const updateTask = asyncHandler(async (req, res) => {
  const { task, owner } = await loadManagedTask(req, req.valid.params.id);
  if (['completed', 'cancelled'].includes(task.status)) throw new AppError(409, `A ${task.status} task cannot be edited.`, 'INVALID_TRANSITION');
  const b = req.valid.body;
  const next = { startTime: b.startTime || task.startTime, endTime: b.endTime || task.endTime };
  if (toMinutes(next.endTime) <= toMinutes(next.startTime)) throw new AppError(400, 'End time must be after start time.', 'VALIDATION_ERROR');
  const conflicts = await conflictsFor(task.assignee, task.date, [next], task._id);
  if (conflicts.length) throw new AppError(409, conflicts[0], 'SLOT_CONFLICT');

  const changed = [];
  for (const k of ['title', 'description', 'category', 'target', 'startTime', 'endTime']) {
    if (b[k] !== undefined && b[k] !== task[k]) { task[k] = b[k]; changed.push(k); }
  }
  if (!changed.length) return res.json({ task: serializeTask(task) });
  task.startMin = toMinutes(task.startTime);
  task.endMin = toMinutes(task.endTime);
  task.history.push({ by: req.user._id, byName: req.user.name, action: 'edited', note: changed.join(', ') });
  await task.save();
  await notify([task.assignee], { actor: req.user, type: 'daily.updated', title: `Your ${task.date} plan was changed`, message: `"${task.title}" ${task.startTime}-${task.endTime}`, link: `/daily?date=${task.date}`, entityType: 'DailyTask', entityId: task._id });
  await audit(req, { action: 'dailytask.updated', entityType: 'DailyTask', entityId: task._id, summary: `"${task.title}" of ${owner.name} (${task.date}) edited: ${changed.join(', ')}`, metadata: { changed } });
  res.json({ task: serializeTask(task) });
});

export const cancelTask = asyncHandler(async (req, res) => {
  const { task, owner } = await loadManagedTask(req, req.valid.params.id);
  if (['completed', 'cancelled'].includes(task.status)) throw new AppError(409, `A ${task.status} task cannot be cancelled.`, 'INVALID_TRANSITION');
  const from = task.status;
  task.status = 'cancelled';
  task.cancelReason = req.valid.body.reason;
  task.history.push({ by: req.user._id, byName: req.user.name, action: 'cancelled', fromStatus: from, toStatus: 'cancelled', note: req.valid.body.reason });
  await task.save();
  await notify([task.assignee], { actor: req.user, type: 'daily.cancelled', title: `A task on ${task.date} was cancelled`, message: `"${task.title}": ${req.valid.body.reason}`, link: `/daily?date=${task.date}`, entityType: 'DailyTask', entityId: task._id });
  await audit(req, { action: 'dailytask.cancelled', entityType: 'DailyTask', entityId: task._id, summary: `"${task.title}" of ${owner.name} (${task.date}) cancelled`, metadata: { reason: req.valid.body.reason } });
  res.json({ task: serializeTask(task) });
});

// ---------------------------------------------------------------- manager: team board

export const teamBoard = asyncHandler(async (req, res) => {
  const date = req.valid.query.date || todayKey();
  const userFilter = { isActive: true, ...teamFilter(req) };
  if (req.valid.query.userId) userFilter._id = req.valid.query.userId;
  const people = await User.find(userFilter, 'name email').populate('roles', 'name').sort({ name: 1 }).limit(200);
  const ids = people.map((p) => p._id);
  const [tasks, eods] = await Promise.all([
    DailyTask.find({ assignee: { $in: ids }, date }).sort({ startMin: 1 }),
    EodReport.find({ user: { $in: ids }, date }),
  ]);
  const byUser = new Map();
  for (const t of tasks) byUser.set(String(t.assignee), [...(byUser.get(String(t.assignee)) || []), t]);
  const eodBy = new Map(eods.map((e) => [String(e.user), e]));
  res.json({
    date,
    people: people.map((p) => {
      const list = byUser.get(String(p._id)) || [];
      return { id: String(p._id), name: p.name, roles: p.roles.map((r) => r.name), tasks: list.map(serializeTask), metrics: computeMetrics(list), eod: eodBrief(eodBy.get(String(p._id))) };
    }),
  });
});

// ---------------------------------------------------------------- end of day

export const submitEod = asyncHandler(async (req, res) => {
  const today = todayKey();
  const date = req.valid.body.date || today;
  if (date > today) throw new AppError(400, 'You cannot submit an end-of-day report for a future date.', 'VALIDATION_ERROR');
  if (date < addDays(today, -3)) throw new AppError(400, 'End-of-day reports can only be submitted for the last 3 days.', 'VALIDATION_ERROR');

  const existing = await EodReport.findOne({ user: req.user._id, date });
  if (existing && existing.status === 'submitted') throw new AppError(409, 'You have already submitted this report. It is waiting for your manager.', 'ALREADY_SUBMITTED');
  if (existing && existing.status === 'verified') throw new AppError(409, 'This report is already verified and cannot be changed.', 'ALREADY_VERIFIED');

  const tasks = await DailyTask.find({ assignee: req.user._id, date }).sort({ startMin: 1 });
  const m = computeMetrics(tasks);
  const snapshot = {
    tasks: tasks.filter((t) => t.status !== 'cancelled').map((t) => ({ taskId: t._id, title: t.title, category: t.category, startTime: t.startTime, endTime: t.endTime, minutes: t.endMin - t.startMin, target: t.target, status: t.status, outputNotes: t.outputNotes })),
    plannedCount: m.plannedCount, completedCount: m.completedCount, inProgressCount: m.inProgressCount, pendingCount: m.pendingCount, plannedMinutes: m.plannedMinutes, completedMinutes: m.completedMinutes,
  };

  let report;
  try {
    if (existing) {
      existing.set({ summary: req.valid.body.summary, blockers: req.valid.body.blockers || '', snapshot, status: 'submitted', submittedAt: new Date(), resubmitCount: existing.resubmitCount + 1 });
      existing.history.push({ by: req.user._id, byName: req.user.name, action: 'resubmitted' });
      report = await existing.save();
    } else {
      report = await EodReport.create({ user: req.user._id, date, summary: req.valid.body.summary, blockers: req.valid.body.blockers || '', snapshot, history: [{ by: req.user._id, byName: req.user.name, action: 'submitted' }] });
    }
  } catch (err) {
    if (err?.code === 11000) throw new AppError(409, 'A report for this day already exists.', 'ALREADY_SUBMITTED');
    throw err;
  }
  const reviewers = await reviewersOf(req.user);
  await notify(reviewers, { actor: req.user, type: 'eod.submitted', title: `${req.user.name} submitted the end-of-day report for ${date}`, message: `${m.completedCount}/${m.plannedCount} tasks completed (${m.completionPct}%)`, link: `/daily/review?id=${report._id}`, entityType: 'EodReport', entityId: report._id });
  await audit(req, { action: existing ? 'eod.resubmitted' : 'eod.submitted', entityType: 'EodReport', entityId: report._id, summary: `${req.user.name} submitted the EOD report for ${date} (${m.completedCount}/${m.plannedCount} tasks done)`, metadata: { date, planned: m.plannedCount, completed: m.completedCount } });
  res.status(existing ? 200 : 201).json({ id: String(report._id), status: report.status });
});

async function loadEodForReview(req, id) {
  const r = await EodReport.findById(id).populate('user', 'name reportsTo isActive');
  if (!r) throw new AppError(404, 'Report not found.', 'NOT_FOUND');
  if (same(r.user, req.user)) throw new AppError(403, 'You cannot review your own end-of-day report.', 'FORBIDDEN');
  if (!inScope(req, r.user)) throw new AppError(404, 'Report not found.', 'NOT_FOUND');
  if (r.status !== 'submitted') throw new AppError(409, `This report is already ${r.status}.`, 'INVALID_TRANSITION');
  return r;
}

export const listEod = asyncHandler(async (req, res) => {
  const { scope, date, status, userId, page, limit } = req.valid.query;
  const reviewer = req.perms.has('daily.eod_review') || req.perms.has('daily.view_team') || req.perms.has('daily.view_all');
  const wantTeam = (scope || (reviewer ? 'team' : 'mine')) === 'team';
  const filter = {};
  if (wantTeam) {
    if (!reviewer) throw new AppError(403, 'You do not have permission to view team reports.', 'FORBIDDEN');
    if (!req.perms.has('daily.view_all')) {
      const team = await User.find({ reportsTo: req.user._id }, '_id');
      filter.user = { $in: team.map((t) => t._id) };
    }
    if (userId) filter.user = req.perms.has('daily.view_all') ? userId : filter.user.$in.some((t) => String(t) === String(userId)) ? userId : { $in: [] };
  } else {
    filter.user = req.user._id;
  }
  if (date) filter.date = date;
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    EodReport.find(filter).populate('user', 'name reportsTo').populate('reviewer', 'name').sort({ date: -1, submittedAt: -1 }).skip((page - 1) * limit).limit(limit),
    EodReport.countDocuments(filter),
  ]);
  res.json({ items: items.map((r) => serializeEod(r, req)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const getEod = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.valid.params.id)) throw new AppError(404, 'Report not found.', 'NOT_FOUND');
  const r = await EodReport.findById(req.valid.params.id).populate('user', 'name reportsTo').populate('reviewer', 'name');
  if (!r || (!same(r.user, req.user) && !inScope(req, r.user))) throw new AppError(404, 'Report not found.', 'NOT_FOUND');
  res.json({ report: serializeEod(r, req), history: r.history });
});

async function review(req, res, { to, action, notifyTitle }) {
  const r = await loadEodForReview(req, req.valid.params.id);
  const body = req.valid.body;
  r.status = to;
  r.reviewer = req.user._id;
  r.reviewedAt = new Date();
  r.reviewerComment = body.comment || '';
  r.rating = to === 'verified' ? body.rating : undefined;
  r.history.push({ by: req.user._id, byName: req.user.name, action, note: body.comment || '' });
  await r.save();
  await notify([r.user._id], { actor: req.user, type: `eod.${action}`, title: notifyTitle(r), message: body.comment || '', link: `/daily?date=${r.date}`, entityType: 'EodReport', entityId: r._id });
  await audit(req, { action: `eod.${action}`, entityType: 'EodReport', entityId: r._id, summary: `${req.user.name} ${action} the EOD report of ${r.user.name} for ${r.date}`, metadata: { date: r.date, rating: r.rating, comment: body.comment } });
  const fresh = await EodReport.findById(r._id).populate('user', 'name reportsTo').populate('reviewer', 'name');
  res.json({ report: serializeEod(fresh, req) });
}

export const verifyEod = asyncHandler((req, res) => review(req, res, { to: 'verified', action: 'verified', notifyTitle: (r) => `Your end-of-day report for ${r.date} was verified` }));
export const returnEod = asyncHandler((req, res) => review(req, res, { to: 'returned', action: 'returned', notifyTitle: (r) => `Your end-of-day report for ${r.date} needs corrections` }));

// ---------------------------------------------------------------- dashboard summary

export const dailySummary = asyncHandler(async (req, res) => {
  const date = todayKey();
  const out = { date };
  if (req.perms.has('daily.view_own')) {
    const [tasks, eod] = await Promise.all([DailyTask.find({ assignee: req.user._id, date }), EodReport.findOne({ user: req.user._id, date })]);
    out.mine = { ...computeMetrics(tasks), eodStatus: eod ? eod.status : 'not_submitted' };
  }
  if (req.perms.has('daily.eod_review') || req.perms.has('daily.view_all')) {
    const filter = { status: 'submitted' };
    if (!req.perms.has('daily.view_all')) {
      const team = await User.find({ reportsTo: req.user._id }, '_id');
      filter.user = { $in: team.map((t) => t._id) };
    }
    out.team = { eodAwaitingReview: await EodReport.countDocuments(filter) };
  }
  res.json(out);
});
