// Backend-enforced state machines. Every status change in the system goes through assertTransition().
import { AppError } from '../utils/AppError.js';

export const BUILD_TRANSITIONS = {
  pending_test: ['in_testing', 'withdrawn'],
  in_testing: ['failed', 'approved'],
  failed: ['superseded'],
  approved: [],
  superseded: [],
  withdrawn: [],
};

export const BUG_TRANSITIONS = {
  open: ['in_progress', 'ready_for_retest', 'closed'],
  in_progress: ['ready_for_retest', 'closed'],
  ready_for_retest: ['closed', 'reopened'],
  reopened: ['in_progress', 'ready_for_retest', 'closed'],
  closed: ['reopened'],
};

export const BUILD_ACTIVE_FOR_TESTING = ['pending_test', 'in_testing'];

function check(map, from, to, label) {
  if (!map[from]?.includes(to)) {
    throw new AppError(409, `A ${label} cannot change from "${from}" to "${to}".`, 'INVALID_TRANSITION');
  }
}
export const assertBuildTransition = (from, to) => check(BUILD_TRANSITIONS, from, to, 'build');
export const assertBugTransition = (from, to) => check(BUG_TRANSITIONS, from, to, 'bug');

/** Applies a status change and appends a history entry (caller saves the document). */
export function applyStatus(doc, map, to, actor, action, note = '') {
  const from = doc.status;
  check(map, from, to, doc.constructor.modelName.toLowerCase());
  doc.status = to;
  doc.history.push({ by: actor._id, byName: actor.name, action, fromStatus: from, toStatus: to, note });
}
