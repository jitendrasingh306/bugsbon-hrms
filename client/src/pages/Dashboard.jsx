import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { formatDateTime } from '../format.js';

export default function Dashboard() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [sum, setSum] = useState(null);
  const [day, setDay] = useState(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    api('/builds/summary').then(setSum).catch(() => setSum(null));
    api('/daily/summary').then(setDay).catch(() => setDay(null));
  }, []);

  return (
    <>
      <h1>Welcome, {user.name}</h1>
      <div className="grid">
        <section className="card">
          <h2>Your account</h2>
          <dl className="kv">
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Roles</dt><dd>{user.roles.map((r) => r.name).join(', ') || '—'}</dd>
            <dt>Permissions</dt><dd>{user.isSuperAdmin ? 'Full access' : `${user.permissions.length} granted`}</dd>
            <dt>Last sign-in</dt><dd>{formatDateTime(user.lastLoginAt)}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>System status</h2>
          {health ? (
            <dl className="kv">
              <dt>API</dt><dd>{health.status}</dd>
              <dt>Database</dt><dd>{health.database}</dd>
              <dt>Transactions</dt><dd>{health.transactions ? 'enabled (replica set)' : 'off (standalone MongoDB)'}</dd>
              <dt>Timezone</dt><dd>{health.timezone}</dd>
            </dl>
          ) : <p className="muted">Status unavailable.</p>}
        </section>
      </div>
      {day && (day.mine || day.team) && (
        <>
          <h2>Today's plan</h2>
          <div className="stats">
            {day.mine && (
              <>
                <Link to="/daily" className="stat"><b>{day.mine.pendingCount + day.mine.inProgressCount}</b><span>My open time-slot tasks</span></Link>
                <Link to="/daily" className="stat ok"><b>{day.mine.completedCount}/{day.mine.plannedCount}</b><span>My tasks completed</span></Link>
                <Link to="/daily" className={`stat ${day.mine.eodStatus === 'not_submitted' && day.mine.plannedCount ? 'warn' : ''}`}><b>{{ not_submitted: 'Due', submitted: 'Sent', verified: 'Verified', returned: 'Returned' }[day.mine.eodStatus]}</b><span>My end-of-day report</span></Link>
              </>
            )}
            {day.team && <Link to="/daily/review" className="stat warn"><b>{day.team.eodAwaitingReview}</b><span>EOD reports awaiting my review</span></Link>}
          </div>
        </>
      )}
      {sum && (sum.asTester || sum.asDeveloper || sum.overall) && (
        <>
          <h2>Build testing</h2>
          <div className="stats">
            {sum.asTester && (
              <>
                <Link to="/builds?scope=testing" className="stat"><b>{sum.asTester.pending}</b><span>Builds waiting for me to test</span></Link>
                <Link to="/builds?scope=testing" className="stat"><b>{sum.asTester.inTesting}</b><span>Builds I am testing</span></Link>
                <Link to="/bugs" className="stat"><b>{sum.asTester.bugsToRetest}</b><span>Bugs to retest</span></Link>
              </>
            )}
            {sum.asDeveloper && (
              <>
                <Link to="/builds" className="stat"><b>{sum.asDeveloper.pending + sum.asDeveloper.inTesting}</b><span>My builds with testers</span></Link>
                <Link to="/builds" className="stat warn"><b>{sum.asDeveloper.failed}</b><span>My failed builds (fix needed)</span></Link>
                <Link to="/bugs" className="stat warn"><b>{sum.asDeveloper.bugsToFix}</b><span>Bugs assigned to me</span></Link>
                <Link to="/builds" className="stat ok"><b>{sum.asDeveloper.approved}</b><span>My approved builds</span></Link>
              </>
            )}
            {sum.overall && (
              <>
                <Link to="/builds" className="stat"><b>{(sum.overall.byStatus.pending_test || 0) + (sum.overall.byStatus.in_testing || 0)}</b><span>All builds in testing</span></Link>
                <Link to="/builds" className="stat ok"><b>{sum.overall.byStatus.approved || 0}</b><span>Approved builds</span></Link>
                <Link to="/builds" className="stat warn"><b>{sum.overall.byStatus.failed || 0}</b><span>Failed builds</span></Link>
                <Link to="/bugs" className="stat warn"><b>{sum.overall.openBugs}</b><span>Bugs not closed</span></Link>
              </>
            )}
          </div>
        </>
      )}
      <p className="muted small">Task and employee dashboards will appear here when those modules are added.</p>
    </>
  );
}
