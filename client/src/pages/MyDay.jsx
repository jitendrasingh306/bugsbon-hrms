import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { categoryLabel, formatDateTime, formatDay, shiftDay } from '../format.js';
import { EodStatus, TaskStatus } from '../components/Badges.jsx';
import PlanVsActual from '../components/PlanVsActual.jsx';

function TaskCard({ task, editable, onSaved, onError }) {
  const [notes, setNotes] = useState(task.outputNotes || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotes(task.outputNotes || ''), [task.outputNotes, task.id]);

  async function send(body) {
    onError('');
    setBusy(true);
    try {
      await api(`/daily/tasks/${task.id}/status`, { method: 'PATCH', body });
      await onSaved();
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  }
  const dirty = notes !== (task.outputNotes || '');

  return (
    <li className={`slot slot-${task.status}`}>
      <div className="slot-time">{task.startTime}<span>–</span>{task.endTime}</div>
      <div className="slot-body">
        <div className="slot-head">
          <strong>{task.title}</strong> <span className="badge">{categoryLabel(task.category)}</span> <TaskStatus status={task.status} />
        </div>
        {task.target && <div className="small">🎯 Target: {task.target}</div>}
        {task.description && <div className="small muted pre">{task.description}</div>}
        {task.status === 'cancelled' && <div className="small muted">Cancelled: {task.cancelReason}</div>}
        {task.status !== 'cancelled' && (
          editable ? (
            <>
              <label className="small">Output notes {task.status !== 'completed' && <span className="muted">(required to complete)</span>}
                <textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you do? What was the result?" />
              </label>
              <div className="row">
                {task.status === 'pending' && <button className="btn" disabled={busy} onClick={() => send({ status: 'in_progress', ...(dirty ? { outputNotes: notes } : {}) })}>▶ Start</button>}
                {task.status !== 'completed' && <button className="btn btn-primary" disabled={busy} onClick={() => send({ status: 'completed', outputNotes: notes })}>✔ Mark completed</button>}
                {task.status === 'in_progress' && <button className="btn btn-ghost" disabled={busy} onClick={() => send({ status: 'pending' })}>Back to pending</button>}
                {task.status === 'completed' && <button className="btn btn-ghost" disabled={busy} onClick={() => send({ status: 'in_progress' })}>Reopen</button>}
                {dirty && <button className="btn btn-ghost" disabled={busy} onClick={() => send({ outputNotes: notes })}>Save notes</button>}
              </div>
            </>
          ) : task.outputNotes ? <div className="small"><span className="muted">Output:</span> <span className="pre">{task.outputNotes}</span></div> : null
        )}
      </div>
    </li>
  );
}

function EodPanel({ data, onDone }) {
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = data.metrics.pendingCount + data.metrics.inProgressCount;

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/daily/eod', { method: 'POST', body: { date: data.date, summary, ...(blockers ? { blockers } : {}) } });
      setSummary(''); setBlockers('');
      await onDone();
    } catch (err) { setError(err.message + (err.details ? ' ' + err.details.map((d) => d.message).join('; ') : '')); } finally { setBusy(false); }
  }

  return (
    <section className="card stack">
      <h2>End-of-day report <EodStatus status={data.eod?.status || 'not_submitted'} /></h2>
      {data.eod?.status === 'verified' && <div className="alert alert-ok">Verified{data.eod.rating ? ` · rating ${data.eod.rating}/5` : ''}.{data.eod.reviewerComment ? ` “${data.eod.reviewerComment}”` : ''}</div>}
      {data.eod?.status === 'submitted' && <div className="alert alert-warn">Submitted {formatDateTime(data.eod.submittedAt)}. Waiting for your manager. Tasks are locked.</div>}
      {data.eod?.status === 'returned' && <div className="alert alert-error">Your manager returned this report: “{data.eod.reviewerComment}”. Update your tasks and submit again.</div>}
      {data.canSubmitEod ? (
        <form className="stack form" onSubmit={submit}>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {open > 0 && <div className="alert alert-warn">{open} task(s) are not completed yet. They will be reported as incomplete — explain why in the summary.</div>}
          <label>Summary of your day<textarea required rows={4} minLength={10} maxLength={3000} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What you achieved compared with the plan, and why anything is incomplete." /></label>
          <label>Blockers / help needed (optional)<textarea rows={2} maxLength={1500} value={blockers} onChange={(e) => setBlockers(e.target.value)} /></label>
          <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : data.eod ? 'Resubmit report' : 'Submit end-of-day report'}</button></div>
        </form>
      ) : !data.eod && <p className="muted">{data.isFuture ? 'You can submit the report once the day arrives.' : 'Reports can only be submitted for the last 3 days.'}</p>}
    </section>
  );
}

export default function MyDay() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const date = params.get('date') || '';

  const load = useCallback(() => api(`/daily/schedule${date ? `?date=${date}` : ''}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [date]);
  useEffect(() => { setData(null); load(); }, [load]);

  if (!data) return error ? <div className="alert alert-error" role="alert">{error}</div> : <p className="muted">Loading…</p>;
  const go = (d) => setParams(d === data.today ? {} : { date: d });
  const editable = !data.isFuture && !data.locked;

  return (
    <>
      <div className="page-head">
        <h1>My Day <span className="muted">· {formatDay(data.date)}{data.isToday ? ' (today)' : ''}</span></h1>
        <div className="row">
          <button className="btn" onClick={() => go(shiftDay(data.date, -1))} aria-label="Previous day">‹</button>
          <input type="date" value={data.date} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Choose date" />
          <button className="btn" onClick={() => go(shiftDay(data.date, 1))} aria-label="Next day">›</button>
          {!data.isToday && <button className="btn btn-ghost" onClick={() => go(data.today)}>Today</button>}
        </div>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {data.isFuture && <div className="alert alert-warn">This is a future day. You can preview the plan, but tasks can only be updated on the day itself.</div>}

      <section className="card">
        <h2>Plan vs actual</h2>
        <PlanVsActual m={data.metrics} />
      </section>

      <section className="card">
        <h2>Schedule</h2>
        {data.tasks.length === 0 ? <p className="muted">No time-slot tasks are assigned for this day.</p> : (
          <ul className="slots">
            {data.tasks.map((t) => <TaskCard key={t.id} task={t} editable={editable} onSaved={load} onError={setError} />)}
          </ul>
        )}
      </section>

      {!data.isFuture && <EodPanel data={data} onDone={load} />}
    </>
  );
}
