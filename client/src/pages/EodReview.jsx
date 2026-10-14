import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { categoryLabel, formatDateTime, formatDay, formatMinutes } from '../format.js';
import { EodStatus, TaskStatus } from '../components/Badges.jsx';
import PlanVsActual from '../components/PlanVsActual.jsx';
import Pager from '../components/Pager.jsx';

function Report({ r, onChanged, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = r.snapshot;

  async function act(kind) {
    setError(''); setBusy(true);
    try {
      const body = kind === 'verify' ? { comment: comment || undefined, rating: rating ? Number(rating) : undefined } : { comment };
      await api(`/daily/eod/${r.id}/${kind}`, { method: 'POST', body });
      setComment(''); setRating('');
      await onChanged();
    } catch (e) { setError(e.message + (e.details ? ' ' + e.details.map((d) => d.message).join('; ') : '')); } finally { setBusy(false); }
  }

  return (
    <section className="card stack">
      <button className="eod-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div><strong>{r.user?.name}</strong> <span className="muted">· {formatDay(r.date)}</span></div>
        <div className="row">
          <span className="small">{s.completedCount}/{s.plannedCount} tasks · {s.completionPct}%</span>
          <EodStatus status={r.status} />
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && (
        <>
          <h3>Planned vs actual</h3>
          <PlanVsActual m={s} />
          {s.tasks.length === 0 ? <p className="muted">Nothing was planned for this day.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Slot</th><th>Planned</th><th>Target</th><th>Actual status</th><th>Output notes</th></tr></thead>
                <tbody>
                  {s.tasks.map((t) => (
                    <tr key={t.taskId}>
                      <td>{t.startTime}–{t.endTime}<div className="muted small">{formatMinutes(t.minutes)}</div></td>
                      <td>{t.title} <span className="badge">{categoryLabel(t.category)}</span></td>
                      <td>{t.target || '—'}</td>
                      <td><TaskStatus status={t.status} /></td>
                      <td className="pre">{t.outputNotes || <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Employee summary</h3>
          <p className="pre">{r.summary}</p>
          {r.blockers && <><h3>Blockers</h3><p className="pre">{r.blockers}</p></>}
          <p className="muted small">Submitted {formatDateTime(r.submittedAt)}{r.resubmitCount ? ` · resubmitted ${r.resubmitCount}×` : ''}</p>
          {r.status !== 'submitted' && r.reviewer && (
            <div className={`alert ${r.status === 'verified' ? 'alert-ok' : 'alert-error'}`}>
              {r.status === 'verified' ? 'Verified' : 'Returned'} by {r.reviewer.name} on {formatDateTime(r.reviewedAt)}{r.rating ? ` · rating ${r.rating}/5` : ''}{r.reviewerComment ? ` — “${r.reviewerComment}”` : ''}
            </div>
          )}
          {r.actions.verify && (
            <div className="stack form">
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <label>Comment (required when returning)<textarea rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
              <div className="row">
                <label>Rating<select value={rating} onChange={(e) => setRating(e.target.value)}><option value="">No rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></label>
                <button className="btn btn-primary" disabled={busy} onClick={() => act('verify')}>✔ Approve / Verify</button>
                <button className="btn btn-danger" disabled={busy || comment.trim().length < 5} onClick={() => act('return')}>Return for correction</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function EodReview() {
  const [params] = useSearchParams();
  const openId = params.get('id');
  const [filters, setFilters] = useState({ status: 'submitted', date: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page, scope: 'team' });
    if (filters.status) qs.set('status', filters.status);
    if (filters.date) qs.set('date', filters.date);
    return api(`/daily/eod?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [filters, page]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  const set = (k) => (e) => { setPage(1); setFilters((f) => ({ ...f, [k]: e.target.value })); };

  return (
    <>
      <h1>End-of-day review</h1>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="card filters">
        <label>Status
          <select value={filters.status} onChange={set('status')}>
            <option value="submitted">Awaiting review</option><option value="">All</option><option value="verified">Verified</option><option value="returned">Returned</option>
          </select>
        </label>
        <label>Date<input type="date" value={filters.date} onChange={set('date')} /></label>
      </div>
      {loading ? <p className="muted">Loading…</p> : data.items.length === 0 ? <div className="card"><p className="muted">No reports match.</p></div> : data.items.map((r) => (
        <Report key={r.id} r={r} onChanged={load} defaultOpen={r.id === openId || data.items.length === 1} />
      ))}
      <Pager page={page} pages={data.pages} onPage={setPage} />
    </>
  );
}
