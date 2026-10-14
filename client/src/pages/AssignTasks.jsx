import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { CATEGORIES, categoryLabel, formatDay, shiftDay } from '../format.js';
import { EodStatus, TaskStatus } from '../components/Badges.jsx';
import PlanVsActual from '../components/PlanVsActual.jsx';

const blank = (start = '09:00', end = '10:00') => ({ title: '', category: 'other', startTime: start, endTime: end, target: '', description: '' });

function nextSlot(last) {
  if (!last) return blank();
  const [h, m] = last.endTime.split(':').map(Number);
  const end = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  const hh = String(Math.floor(end / 60)).padStart(2, '0');
  const mm = String(end % 60).padStart(2, '0');
  return blank(last.endTime, `${hh}:${mm}`);
}

function EditTask({ task, onClose, onSaved }) {
  const [f, setF] = useState({ title: task.title, category: task.category, startTime: task.startTime, endTime: task.endTime, target: task.target, description: task.description });
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setError('');
    try { await api(`/daily/tasks/${task.id}`, { method: 'PATCH', body: f }); await onSaved(); onClose(); } catch (err) { setError(err.message); }
  }
  async function cancel() {
    setError('');
    try { await api(`/daily/tasks/${task.id}/cancel`, { method: 'POST', body: { reason } }); await onSaved(); onClose(); } catch (err) { setError(err.message); }
  }

  return (
    <form className="stack form edit-box" onSubmit={save}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="row">
        <label>Title<input required minLength={3} maxLength={120} value={f.title} onChange={set('title')} /></label>
        <label>Category<select value={f.category} onChange={set('category')}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <div className="row">
        <label>From<input type="time" required value={f.startTime} onChange={set('startTime')} /></label>
        <label>To<input type="time" required value={f.endTime} onChange={set('endTime')} /></label>
        <label>Target<input maxLength={200} value={f.target} onChange={set('target')} /></label>
      </div>
      <label>Details<textarea rows={2} maxLength={1000} value={f.description} onChange={set('description')} /></label>
      <div className="row">
        <button className="btn btn-primary">Save</button>
        <button type="button" className="btn" onClick={onClose}>Close</button>
        {!cancelling ? <button type="button" className="btn btn-danger" onClick={() => setCancelling(true)}>Cancel task…</button> : (
          <>
            <input placeholder="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="btn btn-danger" disabled={reason.trim().length < 3} onClick={cancel}>Confirm cancel</button>
          </>
        )}
      </div>
    </form>
  );
}

export default function AssignTasks() {
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState({});
  const [date, setDate] = useState('');
  const [today, setToday] = useState('');
  const [rows, setRows] = useState([blank('11:00', '14:00')]);
  const [board, setBoard] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadBoard = useCallback((d) => api(`/daily/team${d ? `?date=${d}` : ''}`).then((b) => { setBoard(b); if (!d) { setDate(b.date); setToday(b.date); } }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    api('/daily/assignees').then((d) => setPeople(d.items)).catch((e) => setError(e.message));
    loadBoard('');
  }, [loadBoard]);
  useEffect(() => { if (date) loadBoard(date); }, [date, loadBoard]);

  const chosen = Object.keys(selected).filter((k) => selected[k]);
  const setRow = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function submit(e) {
    e.preventDefault();
    setError(''); setMsg('');
    if (!chosen.length) return setError('Choose at least one person.');
    setBusy(true);
    try {
      const body = { assigneeIds: chosen, date, tasks: rows.map((r) => ({ ...r, description: r.description || undefined, target: r.target || undefined })) };
      const d = await api('/daily/tasks', { method: 'POST', body });
      setMsg(`${d.created} task(s) assigned to ${d.people} person(s). They were notified.`);
      setRows([blank('11:00', '14:00')]);
      await loadBoard(date);
    } catch (err) {
      setError(err.message + (err.details ? ' ' + err.details.map((x) => `${x.path}: ${x.message}`).join('; ') : ''));
    } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Assign daily tasks</h1>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      <form className="card stack form" onSubmit={submit}>
        <h2>New time-slot plan</h2>
        <fieldset>
          <legend>People ({chosen.length} selected)</legend>
          {people.length === 0 ? <p className="muted">Nobody reports to you yet. Ask a Founder to set “Reports to” on the people you manage (Users &amp; Roles).</p> : (
            <>
              <div className="people-grid">
                {people.map((p) => (
                  <label key={p.id} className="check">
                    <input type="checkbox" checked={!!selected[p.id]} onChange={(e) => setSelected((s) => ({ ...s, [p.id]: e.target.checked }))} />
                    <span>{p.name} <span className="muted small">{p.roles.join(', ')}</span></span>
                  </label>
                ))}
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(Object.fromEntries(people.map((p) => [p.id, chosen.length !== people.length])))}>{chosen.length === people.length ? 'Clear all' : 'Select all'}</button>
            </>
          )}
        </fieldset>
        <label>Date<input type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>

        <div className="stack">
          {rows.map((r, i) => (
            <div key={i} className="slot-row">
              <input type="time" required value={r.startTime} onChange={(e) => setRow(i, 'startTime', e.target.value)} aria-label="From" />
              <input type="time" required value={r.endTime} onChange={(e) => setRow(i, 'endTime', e.target.value)} aria-label="To" />
              <input required minLength={3} maxLength={120} placeholder="Task, e.g. Cold calls" value={r.title} onChange={(e) => setRow(i, 'title', e.target.value)} aria-label="Task title" />
              <select value={r.category} onChange={(e) => setRow(i, 'category', e.target.value)} aria-label="Category">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input maxLength={200} placeholder="Target, e.g. 40 calls" value={r.target} onChange={(e) => setRow(i, 'target', e.target.value)} aria-label="Target" />
              <button type="button" className="btn btn-ghost" disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remove slot">✕</button>
            </div>
          ))}
          <div><button type="button" className="btn" disabled={rows.length >= 20} onClick={() => setRows((x) => [...x, nextSlot(x[x.length - 1])])}>+ Add time slot</button></div>
        </div>
        <div><button className="btn btn-primary" disabled={busy || !chosen.length}>{busy ? 'Assigning…' : `Assign to ${chosen.length || 'selected'} ${chosen.length === 1 ? 'person' : 'people'}`}</button></div>
      </form>

      <div className="page-head">
        <h2>Team plan · {formatDay(date)}</h2>
        <div className="row">
          <button className="btn" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day">‹</button>
          <button className="btn" onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day">›</button>
        </div>
      </div>
      {!board ? <p className="muted">Loading…</p> : board.people.length === 0 ? <div className="card"><p className="muted">No people in your team.</p></div> : board.people.map((p) => (
        <section key={p.id} className="card stack">
          <div className="page-head tight">
            <h3>{p.name} <span className="muted small">{p.roles.join(', ')}</span></h3>
            <EodStatus status={p.eod?.status || 'not_submitted'} />
          </div>
          {p.tasks.length === 0 ? <p className="muted small">No tasks planned.</p> : (
            <>
              <PlanVsActual m={p.metrics} />
              <ul className="slots">
                {p.tasks.map((t) => (
                  <li key={t.id} className={`slot slot-${t.status}`}>
                    <div className="slot-time">{t.startTime}<span>–</span>{t.endTime}</div>
                    <div className="slot-body">
                      <div className="slot-head"><strong>{t.title}</strong> <span className="badge">{categoryLabel(t.category)}</span> <TaskStatus status={t.status} />
                        {!['completed', 'cancelled'].includes(t.status) && !(p.eod && p.eod.status !== 'returned') && <button className="btn btn-ghost" onClick={() => setEditing(editing === t.id ? null : t.id)}>Edit</button>}
                      </div>
                      {t.target && <div className="small">🎯 {t.target}</div>}
                      {t.outputNotes && <div className="small"><span className="muted">Output:</span> <span className="pre">{t.outputNotes}</span></div>}
                      {editing === t.id && <EditTask task={t} onClose={() => setEditing(null)} onSaved={() => loadBoard(date)} />}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </>
  );
}
