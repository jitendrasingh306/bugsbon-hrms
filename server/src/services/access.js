import mongoose from 'mongoose';
import { Build } from '../models/Build.js';
import { Bug } from '../models/Bug.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { buildPermissions } from '../middleware/rbac.js';

export const same = (a, b) => a != null && b != null && String(a._id ?? a) === String(b._id ?? b);

export const userRef = (u) => (u && u.name ? { id: String(u._id), name: u.name, email: u.email } : u ? { id: String(u) } : null);

export function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'Record not found.', 'NOT_FOUND');
}

/** Row-level scope for builds: managers/founders see all; others only builds they uploaded or test. */
export function buildScope(req) {
  if (req.perms.has('builds.view_all')) return {};
  return { $or: [{ developer: req.user._id }, { tester: req.user._id }] };
}

export function bugScope(req) {
  if (req.perms.has('bugs.view_all')) return {};
  return { $or: [{ reporter: req.user._id }, { assignee: req.user._id }, { currentTester: req.user._id }] };
}

/** Loads a build the caller may see. Others get 404 (existence is not leaked). */
export async function getBuildForUser(req, id, { populate = true } = {}) {
  assertObjectId(id);
  let q = Build.findOne({ _id: id, ...buildScope(req) });
  if (populate) q = q.populate('developer tester approvedBy', 'name email');
  const build = await q;
  if (!build) throw new AppError(404, 'Build not found.', 'NOT_FOUND');
  return build;
}

export async function getBugForUser(req, id, { populate = true } = {}) {
  assertObjectId(id);
  let q = Bug.findOne({ _id: id, ...bugScope(req) });
  if (populate) q = q.populate('reporter assignee currentTester', 'name email').populate('build fixedInBuild', 'buildNumber versionName iteration status');
  const bug = await q;
  if (!bug) throw new AppError(404, 'Bug not found.', 'NOT_FOUND');
  return bug;
}

/** A valid tester is an active user whose roles grant tests.perform, and who is not the developer. */
export async function assertValidTester(testerId, developerId) {
  assertObjectId(testerId);
  if (same(testerId, developerId)) {
    throw new AppError(400, 'A developer cannot test their own build. Choose a different tester.', 'INVALID_TESTER');
  }
  const tester = await User.findById(testerId).populate('roles');
  if (!tester || !tester.isActive || !buildPermissions(tester).has('tests.perform')) {
    throw new AppError(400, 'The selected user is not an active tester.', 'INVALID_TESTER');
  }
  return tester;
}
