import fs from 'node:fs';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Build } from '../models/Build.js';
import { Bug } from '../models/Bug.js';
import { nextSeq, formatNumber } from '../models/Counter.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { withTransaction } from '../utils/transaction.js';
import { objectIdSchema } from '../validators/common.js';
import {
  assertValidApk,
  removeFile,
  safeDisplayName,
  sha256File,
  sniffImage,
  storedPath,
  randomStoredName,
  uploadDir,
} from '../utils/files.js';
import {
  applyStatus,
  BUILD_TRANSITIONS,
  BUG_TRANSITIONS,
  BUILD_ACTIVE_FOR_TESTING,
} from '../services/workflow.js';
import { notify, usersWithPermission } from '../services/notify.js';
import { assertValidTester, getBuildForUser, buildScope, same, userRef } from '../services/access.js';
import { serializeBug } from './bugs.controller.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (max, min = 0) => z.string().trim().min(min).max(max);

export const idParams = z.object({ id: objectIdSchema });

export const listQuery = z.object({
  status: z.enum(['pending_test', 'in_testing', 'failed', 'approved', 'superseded', 'withdrawn']).optional(),
  scope: z.enum(['all', 'testing', 'developing']).default('all'),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const submitBody = z.object({
  projectName: text(120).optional(),
  appName: text(120).optional(),
  versionName: text(40, 1),
  versionCode: text(20).optional(),
  releaseNotes: text(5000).optional(),
  testerId: objectIdSchema.optional(),
  previousBuildId: objectIdSchema.optional(),
  fixedBugIds: z.string().max(2000).optional(),
});
export const assignBody = z.object({ testerId: objectIdSchema });
export const resultBody = z.object({
  result: z.enum(['pass', 'fail']),
  notes: text(3000).optional(),
});
export const bugBody = z.object({
  title: text(200, 3),
  description: text(5000, 5),
  stepsToReproduce: text(5000).optional(),
  expectedResult: text(2000).optional(),
  actualResult: text(2000).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

/** Computes what the current user may do on a build; the UI only mirrors this, the routes enforce it. */
export function buildActions(build, req) {
  const isDev = same(build.developer, req.user);
  const isTester = same(build.tester, req.user);
  const p = req.perms;
  const testing = BUILD_ACTIVE_FOR_TESTING.includes(build.status);
  return {
    download: p.has('builds.download'),
    startTest: isTester && p.has('tests.perform') && build.status === 'pending_test',
    recordResult: isTester && p.has('tests.perform') && testing && !!build.testerDownloadedAt,
    reportBug: isTester && p.has('bugs.report') && testing && !!build.testerDownloadedAt,
    uploadFix: isDev && p.has('builds.submit') && build.status === 'failed',
    withdraw: build.status === 'pending_test' && ((isDev && p.has('builds.submit')) || p.has('builds.assign_tester')),
    reassign: p.has('builds.assign_tester') && testing,
  };
}

export function serializeBuild(b, req) {
  const out = {
    id: String(b._id),
    buildNumber: b.buildNumber,
    projectName: b.projectName,
    appName: b.appName,
    versionName: b.versionName,
    versionCode: b.versionCode || '',
    releaseNotes: b.releaseNotes,
    iteration: b.iteration,
    previousBuild: b.previousBuild ? String(b.previousBuild._id ?? b.previousBuild) : null,
    rootBuild: b.rootBuild ? String(b.rootBuild) : null,
    developer: userRef(b.developer),
    tester: userRef(b.tester),
    status: b.status,
    file: b.file ? { name: b.file.originalName, size: b.file.size, sha256: b.file.sha256 } : null,
    downloadCount: b.downloadCount,
    testerDownloadedAt: b.testerDownloadedAt || null,
    testResult: b.testResult?.result ? { result: b.testResult.result, notes: b.testResult.notes, at: b.testResult.at } : null,
    approvedAt: b.approvedAt || null,
    approvedBy: userRef(b.approvedBy),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
  if (req) out.actions = buildActions(b, req);
  return out;
}

const sess = (session) => (session ? { session } : {});

// ---------------------------------------------------------------- list / summary / testers

export const listBuilds = asyncHandler(async (req, res) => {
  const { status, scope, q, page, limit } = req.valid.query;
  const filter = { ...buildScope(req) };
  const and = [];
  if (status) filter.status = status;
  if (scope === 'testing') filter.tester = req.user._id;
  if (scope === 'developing') filter.developer = req.user._id;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ buildNumber: rx }, { projectName: rx }, { appName: rx }, { versionName: rx }] });
  }
  if (and.length) filter.$and = and;

  const [items, total] = await Promise.all([
    Build.find(filter)
      .populate('developer tester', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Build.countDocuments(filter),
  ]);
  res.json({ items: items.map((b) => serializeBuild(b, req)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const summary = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const count = (filter) => Build.countDocuments(filter);
  const bugCount = (filter) => Bug.countDocuments(filter);
  const out = {};

  if (req.perms.has('tests.perform')) {
    const [pending, inTesting, retest] = await Promise.all([
      count({ tester: me, status: 'pending_test' }),
      count({ tester: me, status: 'in_testing' }),
      bugCount({ currentTester: me, status: 'ready_for_retest' }),
    ]);
    out.asTester = { pending, inTesting, bugsToRetest: retest };
  }
  if (req.perms.has('builds.submit')) {
    const [pending, inTesting, failed, approved, toFix] = await Promise.all([
      count({ developer: me, status: 'pending_test' }),
      count({ developer: me, status: 'in_testing' }),
      count({ developer: me, status: 'failed' }),
      count({ developer: me, status: 'approved' }),
      bugCount({ assignee: me, status: { $in: ['open', 'in_progress', 'reopened'] } }),
    ]);
    out.asDeveloper = { pending, inTesting, failed, approved, bugsToFix: toFix };
  }
  if (req.perms.has('builds.view_all')) {
    const rows = await Build.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.n]));
    out.overall = { byStatus, openBugs: await bugCount({ status: { $ne: 'closed' } }) };
  }
  res.json(out);
});

export const listTesters = asyncHandler(async (req, res) => {
  const users = await usersWithPermission('tests.perform', { excludeIds: [req.user._id] });
  res.json({ items: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email })) });
});

// ---------------------------------------------------------------- detail

export const getBuild = asyncHandler(async (req, res) => {
  const build = await getBuildForUser(req, req.valid.params.id);
  const bugs = await Bug.find({ rootBuild: build.rootBuild })
    .populate('reporter assignee currentTester', 'name email')
    .populate('build fixedInBuild', 'buildNumber versionName iteration status')
    .sort({ createdAt: 1 });
  const lineage = await Build.find({ rootBuild: build.rootBuild }, 'buildNumber versionName iteration status createdAt')
    .sort({ iteration: 1 });
  res.json({
    build: serializeBuild(build, req),
    history: build.history,
    bugs: bugs.map((b) => serializeBug(b)),
    lineage: lineage.map((l) => ({
      id: String(l._id),
      buildNumber: l.buildNumber,
      versionName: l.versionName,
      iteration: l.iteration,
      status: l.status,
      createdAt: l.createdAt,
    })),
  });
});

// ---------------------------------------------------------------- submit (upload)

export const submitBuild = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) throw new AppError(400, 'Please choose an APK file to upload.', 'FILE_REQUIRED');
  try {
    const body = submitBody.parse(req.body);
    await assertValidApk(file.path);
    const sha256 = await sha256File(file.path);

    let previous = null;
    let fixedIds = [];
    if (body.fixedBugIds) {
      try {
        fixedIds = z.array(objectIdSchema).max(100).parse(JSON.parse(body.fixedBugIds));
      } catch {
        throw new AppError(400, 'fixedBugIds must be a JSON array of bug ids.', 'VALIDATION_ERROR');
      }
    }

    if (body.previousBuildId) {
      previous = await Build.findById(body.previousBuildId);
      if (!previous || !same(previous.developer, req.user)) {
        throw new AppError(404, 'The build you are fixing was not found.', 'NOT_FOUND');
      }
      if (previous.status !== 'failed') {
        throw new AppError(409, 'A fixed build can only be uploaded for a build that failed testing.', 'INVALID_TRANSITION');
      }
    } else {
      if (fixedIds.length) throw new AppError(400, 'Bugs can only be marked fixed when uploading a fix for a failed build.', 'VALIDATION_ERROR');
      if (!body.projectName || !body.appName) {
        throw new AppError(400, 'Project name and app name are required.', 'VALIDATION_ERROR');
      }
      if (!body.testerId) throw new AppError(400, 'Please choose a tester.', 'VALIDATION_ERROR');
    }

    const duplicate = await Build.findOne({ 'file.sha256': sha256, status: { $ne: 'withdrawn' } }, 'buildNumber');
    if (duplicate) {
      throw new AppError(409, `This exact APK was already uploaded as ${duplicate.buildNumber}. Upload the rebuilt APK that contains your fix.`, 'DUPLICATE_BUILD');
    }

    const testerId = body.testerId || previous.tester;
    const tester = await assertValidTester(testerId, req.user._id);

    let fixedBugs = [];
    if (fixedIds.length) {
      fixedBugs = await Bug.find({
        _id: { $in: fixedIds },
        rootBuild: previous.rootBuild,
        assignee: req.user._id,
        status: { $in: ['open', 'in_progress', 'reopened'] },
      });
      if (fixedBugs.length !== new Set(fixedIds).size) {
        throw new AppError(400, 'Some selected bugs do not belong to this build, are not assigned to you, or are not open.', 'VALIDATION_ERROR');
      }
    }

    const _id = new mongoose.Types.ObjectId();
    const base = previous || body;
    const build = await withTransaction(async (session) => {
      const seq = await nextSeq('build', session);
      const doc = new Build({
        _id,
        buildNumber: formatNumber('BLD', seq),
        projectName: previous ? previous.projectName : body.projectName,
        appName: previous ? previous.appName : body.appName,
        versionName: body.versionName,
        versionCode: body.versionCode,
        releaseNotes: body.releaseNotes || '',
        iteration: previous ? previous.iteration + 1 : 1,
        previousBuild: previous ? previous._id : null,
        rootBuild: previous ? previous.rootBuild : _id,
        developer: req.user._id,
        tester: tester._id,
        status: 'pending_test',
        file: { originalName: safeDisplayName(file.originalname), storedName: file.filename, size: file.size, sha256, mimeType: 'application/vnd.android.package-archive' },
        history: [{
          by: req.user._id,
          byName: req.user.name,
          action: previous ? 'resubmitted' : 'submitted',
          toStatus: 'pending_test',
          note: previous ? `Fix for ${previous.buildNumber}${fixedBugs.length ? ` (${fixedBugs.length} bug(s) marked fixed)` : ''}` : `Assigned to ${tester.name}`,
        }],
      });
      await doc.save(sess(session));

      if (previous) {
        const prev = await Build.findById(previous._id).session(session || null);
        applyStatus(prev, BUILD_TRANSITIONS, 'superseded', req.user, 'superseded', `Replaced by ${doc.buildNumber}`);
        await prev.save(sess(session));

        for (const bug of fixedBugs) {
          const fresh = await Bug.findById(bug._id).session(session || null);
          applyStatus(fresh, BUG_TRANSITIONS, 'ready_for_retest', req.user, 'fixed', `Fix delivered in ${doc.buildNumber}`);
          fresh.fixedInBuild = doc._id;
          await fresh.save(sess(session));
        }
        await Bug.updateMany({ rootBuild: previous.rootBuild }, { $set: { currentTester: tester._id } }, sess(session));
      }

      await notify([tester._id], {
        actor: req.user,
        type: previous ? 'build.resubmitted' : 'build.submitted',
        title: previous ? `Fixed build ${doc.buildNumber} is ready to retest` : `New build ${doc.buildNumber} is ready to test`,
        message: `${doc.appName} ${doc.versionName} uploaded by ${req.user.name}.`,
        link: `/builds/${doc._id}`,
        entityType: 'Build',
        entityId: doc._id,
      }, session);

      await audit(req, {
        action: previous ? 'build.resubmitted' : 'build.submitted',
        entityType: 'Build',
        entityId: doc._id,
        summary: `${doc.buildNumber} (${doc.appName} ${doc.versionName}) uploaded by ${req.user.name}`,
        metadata: { sha256, size: file.size, tester: tester.email, previousBuild: previous?.buildNumber, fixedBugs: fixedBugs.map((b) => b.bugNumber) },
      }, session);
      return doc;
    });

    const populated = await Build.findById(build._id).populate('developer tester', 'name email');
    res.status(201).json({ build: serializeBuild(populated, req) });
  } catch (err) {
    await removeFile(file.path);
    throw err;
  }
});

// ---------------------------------------------------------------- tester assignment / withdraw

export const assignTester = asyncHandler(async (req, res) => {
  const { testerId } = req.valid.body;
  const existing = await getBuildForUser(req, req.valid.params.id, { populate: false });
  if (!BUILD_ACTIVE_FOR_TESTING.includes(existing.status)) {
    throw new AppError(409, 'The tester can only be changed while the build is waiting for or under testing.', 'INVALID_TRANSITION');
  }
  const tester = await assertValidTester(testerId, existing.developer);
  if (same(existing.tester, tester)) throw new AppError(400, 'That user is already the assigned tester.', 'VALIDATION_ERROR');

  await withTransaction(async (session) => {
    const b = await Build.findById(existing._id).session(session || null);
    const previousTester = b.tester;
    b.tester = tester._id;
    b.testerDownloadedAt = undefined; // the new tester must install and test it themselves
    if (b.status === 'in_testing') b.status = 'pending_test'; // reassignment restarts testing
    b.history.push({ by: req.user._id, byName: req.user.name, action: 'tester_changed', toStatus: b.status, note: `Tester changed to ${tester.name}` });
    await b.save(sess(session));
    await Bug.updateMany({ rootBuild: b.rootBuild }, { $set: { currentTester: tester._id } }, sess(session));
    const link = `/builds/${b._id}`;
    await notify([tester._id], { actor: req.user, type: 'build.assigned', title: `You were assigned to test ${b.buildNumber}`, message: `${b.appName} ${b.versionName}`, link, entityType: 'Build', entityId: b._id }, session);
    await notify([previousTester, b.developer], { actor: req.user, type: 'build.tester_changed', title: `Tester for ${b.buildNumber} is now ${tester.name}`, link, entityType: 'Build', entityId: b._id }, session);
    await audit(req, { action: 'build.tester_changed', entityType: 'Build', entityId: b._id, summary: `Tester of ${b.buildNumber} changed to ${tester.email}` }, session);
  });
  const fresh = await getBuildForUser(req, existing._id);
  res.json({ build: serializeBuild(fresh, req) });
});

export const withdrawBuild = asyncHandler(async (req, res) => {
  const existing = await getBuildForUser(req, req.valid.params.id, { populate: false });
  const isDev = same(existing.developer, req.user);
  if (!((isDev && req.perms.has('builds.submit')) || req.perms.has('builds.assign_tester'))) {
    throw new AppError(403, 'You do not have permission to withdraw this build.', 'FORBIDDEN');
  }
  await withTransaction(async (session) => {
    const b = await Build.findById(existing._id).session(session || null);
    applyStatus(b, BUILD_TRANSITIONS, 'withdrawn', req.user, 'withdrawn', 'Withdrawn before testing started');
    await b.save(sess(session));
    await notify([b.tester, b.developer], { actor: req.user, type: 'build.withdrawn', title: `Build ${b.buildNumber} was withdrawn`, link: `/builds/${b._id}`, entityType: 'Build', entityId: b._id }, session);
    await audit(req, { action: 'build.withdrawn', entityType: 'Build', entityId: b._id, summary: `${b.buildNumber} withdrawn by ${req.user.name}` }, session);
  });
  const fresh = await getBuildForUser(req, existing._id);
  res.json({ build: serializeBuild(fresh, req) });
});

// ---------------------------------------------------------------- download / start test

async function markTesterDownload(req, build) {
  await withTransaction(async (session) => {
    const b = await Build.findById(build._id).session(session || null);
    b.downloadCount += 1;
    if (same(b.tester, req.user)) {
      b.testerDownloadedAt = new Date();
      if (b.status === 'pending_test') {
        applyStatus(b, BUILD_TRANSITIONS, 'in_testing', req.user, 'testing_started', 'Tester downloaded the APK');
        await notify([b.developer], { actor: req.user, type: 'build.testing_started', title: `Testing started on ${b.buildNumber}`, message: `${req.user.name} downloaded the APK.`, link: `/builds/${b._id}`, entityType: 'Build', entityId: b._id }, session);
      }
    }
    await b.save(sess(session));
    await audit(req, { action: 'build.downloaded', entityType: 'Build', entityId: b._id, summary: `${req.user.name} downloaded ${b.buildNumber}` }, session);
  });
}

export const downloadBuild = asyncHandler(async (req, res) => {
  const build = await getBuildForUser(req, req.valid.params.id, { populate: false });
  const filePath = storedPath('builds', build.file.storedName);
  if (!fs.existsSync(filePath)) throw new AppError(410, 'The APK file is missing on the server. Ask the developer to upload it again.', 'FILE_MISSING');
  await markTesterDownload(req, build);
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('X-Checksum-SHA256', build.file.sha256);
  res.download(filePath, build.file.originalName);
});

export const startTest = asyncHandler(async (req, res) => {
  const build = await getBuildForUser(req, req.valid.params.id, { populate: false });
  if (!same(build.tester, req.user)) throw new AppError(403, 'Only the assigned tester can start testing.', 'FORBIDDEN');
  if (build.status !== 'pending_test') throw new AppError(409, 'Testing has already started for this build.', 'INVALID_TRANSITION');
  await withTransaction(async (session) => {
    const b = await Build.findById(build._id).session(session || null);
    applyStatus(b, BUILD_TRANSITIONS, 'in_testing', req.user, 'testing_started', 'Tester started testing');
    await b.save(sess(session));
    await notify([b.developer], { actor: req.user, type: 'build.testing_started', title: `Testing started on ${b.buildNumber}`, link: `/builds/${b._id}`, entityType: 'Build', entityId: b._id }, session);
    await audit(req, { action: 'build.testing_started', entityType: 'Build', entityId: b._id, summary: `${req.user.name} started testing ${b.buildNumber}` }, session);
  });
  const fresh = await getBuildForUser(req, build._id);
  res.json({ build: serializeBuild(fresh, req) });
});

// ---------------------------------------------------------------- test result

function assertAssignedTester(build, req) {
  if (!same(build.tester, req.user)) throw new AppError(403, 'Only the tester assigned to this build can do this.', 'FORBIDDEN');
  if (!BUILD_ACTIVE_FOR_TESTING.includes(build.status)) throw new AppError(409, `This build is already "${build.status}" and cannot be tested.`, 'INVALID_TRANSITION');
  if (!build.testerDownloadedAt) throw new AppError(409, 'Download and install the APK before recording results or reporting bugs.', 'DOWNLOAD_REQUIRED');
}

export const recordResult = asyncHandler(async (req, res) => {
  const { result, notes } = req.valid.body;
  const existing = await getBuildForUser(req, req.valid.params.id, { populate: false });
  assertAssignedTester(existing, req);
  if (result === 'fail' && (notes || '').length < 10) {
    throw new AppError(400, 'Please describe why the build failed (at least 10 characters).', 'VALIDATION_ERROR');
  }
  if (result === 'pass') {
    const unresolved = await Bug.countDocuments({ rootBuild: existing.rootBuild, status: { $ne: 'closed' } });
    if (unresolved > 0) {
      throw new AppError(409, `${unresolved} bug(s) are not closed yet. Verify and close every bug (or mark the build as Failed) before passing it.`, 'OPEN_BUGS');
    }
  }

  await withTransaction(async (session) => {
    const b = await Build.findById(existing._id).session(session || null);
    if (b.status === 'pending_test') applyStatus(b, BUILD_TRANSITIONS, 'in_testing', req.user, 'testing_started');
    b.testResult = { result, notes: notes || '', by: req.user._id, at: new Date() };
    if (result === 'fail') {
      applyStatus(b, BUILD_TRANSITIONS, 'failed', req.user, 'test_failed', notes);
    } else {
      applyStatus(b, BUILD_TRANSITIONS, 'approved', req.user, 'approved', `All tests passed and every bug is closed.${notes ? ` ${notes}` : ''}`);
      b.approvedAt = new Date();
      b.approvedBy = req.user._id;
    }
    await b.save(sess(session));

    const link = `/builds/${b._id}`;
    if (result === 'fail') {
      await notify([b.developer], { actor: req.user, type: 'build.failed', title: `Build ${b.buildNumber} failed testing`, message: notes, link, entityType: 'Build', entityId: b._id }, session);
    } else {
      const managers = await usersWithPermission('builds.view_all');
      await notify([b.developer, ...managers.map((m) => m._id)], { actor: req.user, type: 'build.approved', title: `Build ${b.buildNumber} was approved`, message: `${b.appName} ${b.versionName} passed all tests.`, link, entityType: 'Build', entityId: b._id }, session);
    }
    await audit(req, { action: result === 'pass' ? 'build.approved' : 'build.test_failed', entityType: 'Build', entityId: b._id, summary: `${b.buildNumber} ${result === 'pass' ? 'passed and was approved' : 'failed testing'} (${req.user.name})`, metadata: { notes } }, session);
  });
  const fresh = await getBuildForUser(req, existing._id);
  res.json({ build: serializeBuild(fresh, req) });
});

// ---------------------------------------------------------------- report bug

export const reportBug = asyncHandler(async (req, res) => {
  const files = req.files || [];
  try {
    const body = bugBody.parse(req.body);
    const existing = await getBuildForUser(req, req.valid.params.id, { populate: false });
    if (!req.perms.has('bugs.report')) throw new AppError(403, 'You do not have permission to report bugs.', 'FORBIDDEN');
    assertAssignedTester(existing, req);

    const attachments = [];
    for (const f of files) {
      const kind = await sniffImage(f.path);
      if (!kind) throw new AppError(400, `"${safeDisplayName(f.originalname)}" is not a valid PNG, JPG or WEBP image.`, 'INVALID_FILE_TYPE');
      const storedName = randomStoredName(kind.ext);
      await fs.promises.rename(f.path, `${uploadDir('bug-images')}/${storedName}`);
      f.path = `${uploadDir('bug-images')}/${storedName}`;
      attachments.push({ originalName: safeDisplayName(f.originalname), storedName, size: f.size, mimeType: kind.mime });
    }

    const bug = await withTransaction(async (session) => {
      const b = await Build.findById(existing._id).session(session || null);
      const seq = await nextSeq('bug', session);
      const doc = new Bug({
        bugNumber: formatNumber('BUG', seq),
        ...body,
        build: b._id,
        rootBuild: b.rootBuild,
        reporter: req.user._id,
        assignee: b.developer,
        currentTester: b.tester,
        attachments,
        history: [{ by: req.user._id, byName: req.user.name, action: 'reported', toStatus: 'open', note: `Found in ${b.buildNumber}` }],
      });
      await doc.save(sess(session));
      await notify([b.developer], { actor: req.user, type: 'bug.reported', title: `New ${doc.severity} bug ${doc.bugNumber} in ${b.buildNumber}`, message: doc.title, link: `/bugs/${doc._id}`, entityType: 'Bug', entityId: doc._id }, session);
      await audit(req, { action: 'bug.reported', entityType: 'Bug', entityId: doc._id, summary: `${doc.bugNumber} reported on ${b.buildNumber}: ${doc.title}`, metadata: { severity: doc.severity } }, session);
      return doc;
    });
    res.status(201).json({ bug: { id: String(bug._id), bugNumber: bug.bugNumber } });
  } catch (err) {
    await Promise.all(files.map((f) => removeFile(f.path)));
    throw err;
  }
});
