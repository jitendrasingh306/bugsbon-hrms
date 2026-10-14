import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { formatDateTime } from '../format.js';
import { BugStatus, BUG_STATUS_OPTIONS, Severity } from '../components/Badges.jsx';
import Pager from '../components/Pager.jsx';

export default function Bugs() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ status: '', severity: '', scope: 'all', q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ page, scope: filters.scope });
    ['status', 'severity', 'q'].forEach((k) => filters[k] && qs.set(k, filters[k]));
    api(`/bugs?${qs}`).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [filters, page]);
  const set = (k) => (e) => { setPage(1); setFilters((f) => ({ ...f, [k]: e.target.value })); };

  return (
    <>
      <h1>Bugs</h1>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="card filters">
        <label>Search<input value={filters.q} onChange={set('q')} placeholder="Bug no. or title" /></label>
        <label>Status<select value={filters.status} onChange={set('status')}><option value="">All</option>{BUG_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Severity<select value={filters.severity} onChange={set('severity')}><option value="">All</option>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Show
          <select value={filters.scope} onChange={set('scope')}>
            <option value="all">Everything I can see</option>
            {can('bugs.fix') && <option value="assigned">Assigned to me to fix</option>}
            {can('bugs.report') && <option value="reported">Reported by me</option>}
          </select>
        </label>
      </div>
      <div className="card table-wrap">
        {loading ? <p className="muted pad">Loading…</p> : data.items.length === 0 ? <p className="muted pad">No bugs found.</p> : (
          <table>
            <thead><tr><th>Bug</th><th>Severity</th><th>Status</th><th>Build</th><th>Reporter</th><th>Developer</th><th>Reported</th></tr></thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b.id}>
                  <td><Link to={`/bugs/${b.id}`}><strong>{b.bugNumber}</strong></Link> {b.title}</td>
                  <td><Severity severity={b.severity} /></td>
                  <td><BugStatus status={b.status} /></td>
                  <td>{b.build?.id ? <Link to={`/builds/${b.build.id}`}>{b.build.buildNumber}</Link> : '—'}</td>
                  <td>{b.reporter?.name}</td>
                  <td>{b.assignee?.name}</td>
                  <td>{formatDateTime(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pager page={page} pages={data.pages} onPage={setPage} />
    </>
  );
}
