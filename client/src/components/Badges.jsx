const BUILD = {
  pending_test: ['Waiting for test', 'badge-blue'],
  in_testing: ['In testing', 'badge-amber'],
  failed: ['Failed', 'badge-red'],
  approved: ['Approved', 'badge-green'],
  superseded: ['Superseded', 'badge-grey'],
  withdrawn: ['Withdrawn', 'badge-grey'],
};
const BUG = {
  open: ['Open', 'badge-red'],
  in_progress: ['In progress', 'badge-amber'],
  ready_for_retest: ['Ready for retest', 'badge-blue'],
  reopened: ['Reopened', 'badge-red'],
  closed: ['Closed', 'badge-green'],
};
const SEV = { low: 'badge-grey', medium: 'badge-blue', high: 'badge-amber', critical: 'badge-red' };

export const BuildStatus = ({ status }) => {
  const [label, cls] = BUILD[status] || [status, 'badge-grey'];
  return <span className={`badge ${cls}`}>{label}</span>;
};
export const BugStatus = ({ status }) => {
  const [label, cls] = BUG[status] || [status, 'badge-grey'];
  return <span className={`badge ${cls}`}>{label}</span>;
};
export const Severity = ({ severity }) => <span className={`badge ${SEV[severity] || 'badge-grey'}`}>{severity}</span>;
export const BUILD_STATUS_OPTIONS = Object.entries(BUILD).map(([v, [l]]) => [v, l]);
export const BUG_STATUS_OPTIONS = [['unresolved', 'Not closed'], ...Object.entries(BUG).map(([v, [l]]) => [v, l])];

const TASK = {
  pending: ['Pending', 'badge-blue'],
  in_progress: ['In progress', 'badge-amber'],
  completed: ['Completed', 'badge-green'],
  cancelled: ['Cancelled', 'badge-grey'],
};
const EOD = {
  not_submitted: ['Not submitted', 'badge-grey'],
  submitted: ['Awaiting review', 'badge-amber'],
  verified: ['Verified', 'badge-green'],
  returned: ['Returned', 'badge-red'],
};
export const TaskStatus = ({ status }) => {
  const [label, cls] = TASK[status] || [status, 'badge-grey'];
  return <span className={`badge ${cls}`}>{label}</span>;
};
export const EodStatus = ({ status }) => {
  const [label, cls] = EOD[status] || [status, 'badge-grey'];
  return <span className={`badge ${cls}`}>{label}</span>;
};
