import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { formatDateTime } from '../format.js';
import { BuildStatus, BUILD_STATUS_OPTIONS } from '../components/Badges.jsx';
import Pager from '../components/Pager.jsx';

export default function Builds() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const initialScope = ['testing', 'developing'].includes(params.get('scope')) ? params.get('scope') : 'all';
  const [filters, setFilters] = useState({ status: '', scope: initialScope, q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ page, scope: filters.scope });
    if (filters.status) qs.set('status', filters.status);
    if (filters.q) qs.set('q', filters.q);
    api(`/builds?${qs}`).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [filters, page]);

  const set = (k) => (e) => { setPage(1); setFilters((f) => ({ ...f, [k]: e.target.value })); };

  return (
    <>
      <div className="page-head">
        <h1>Builds</h1>
        {can('builds.submit') && <Link className="btn btn-primary" to="/builds/new">Upload build</Link>}
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="card filters">
        <label>Search<input value={filters.q} onChange={set('q')} placeholder="Build no., app, project, version" /></label>
        <label>Status
          <select value={filters.status} onChange={set('status')}>
            <option value="">All</option>
            {BUILD_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Show
          <select value={filters.scope} onChange={set('scope')}>
            <option value="all">Everything I can see</option>
            {can('tests.perform') && <option value="testing">Assigned to me to test</option>}
            {can('builds.submit') && <option value="developing">Uploaded by me</option>}
          </select>
        </label>
      </div>
      <div className="card table-wrap">
        {loading ? <p className="muted pad">Loading…</p> : data.items.length === 0 ? <p className="muted pad">No builds found.</p> : (
          <table>
            <thead><tr><th>Build</th><th>App / Version</th><th>Status</th><th>Developer</th><th>Tester</th><th>Uploaded</th></tr></thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b.id}>
                  <td><Link to={`/builds/${b.id}`}><strong>{b.buildNumber}</strong></Link>{b.iteration > 1 && <span className="muted small"> · fix #{b.iteration - 1}</span>}</td>
                  <td>{b.appName} <span className="muted">v{b.versionName}</span><div className="muted small">{b.projectName}</div></td>
                  <td><BuildStatus status={b.status} /></td>
                  <td>{b.developer?.name}</td>
                  <td>{b.tester?.name}</td>
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
