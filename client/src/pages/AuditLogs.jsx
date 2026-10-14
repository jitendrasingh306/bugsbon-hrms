import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDateTime } from '../format.js';

export default function AuditLogs() {
  const [filters, setFilters] = useState({ action: '', entityType: '' });
  const [applied, setApplied] = useState({ action: '', entityType: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({ page, limit: 25 });
    if (applied.action) q.set('action', applied.action);
    if (applied.entityType) q.set('entityType', applied.entityType);
    api(`/audit-logs?${q}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, applied]);

  function onSubmit(e) {
    e.preventDefault();
    setPage(1);
    setApplied({ ...filters });
  }

  return (
    <>
      <h1>Audit Logs</h1>
      <form className="card filters" onSubmit={onSubmit}>
        <label>Action starts with
          <input value={filters.action} placeholder="e.g. auth." onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} />
        </label>
        <label>Record type
          <input value={filters.entityType} placeholder="e.g. User" onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))} />
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="card table-wrap">
        {loading ? <p className="muted">Loading…</p> : data.items.length === 0 ? <p className="muted">No audit entries match.</p> : (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Summary</th><th>IP</th></tr></thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.createdAt)}</td>
                  <td>{a.actorName}</td>
                  <td><code>{a.action}</code></td>
                  <td>{a.summary}</td>
                  <td className="muted small">{a.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="pager">
        <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span className="muted">Page {data.page ?? page} of {data.pages} · {data.total} entries</span>
        <button className="btn" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </>
  );
}
