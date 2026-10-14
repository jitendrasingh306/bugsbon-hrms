import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatDateTime } from '../format.js';
import { BugStatus, Severity } from '../components/Badges.jsx';
import Timeline from '../components/Timeline.jsx';

const Block = ({ title, text }) => (text ? <><h3>{title}</h3><p className="pre">{text}</p></> : null);

export default function BugDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/bugs/${id}`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function run(path, body, after) {
    setError(''); setBusy(true);
    try { await api(`/bugs/${id}/${path}`, { method: 'POST', body }); after?.(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (error && !data) return <div className="alert alert-error" role="alert">{error} <Link to="/bugs">Back to bugs</Link></div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { bug, comments, history } = data;
  const a = bug.actions;

  return (
    <>
      <Link to="/bugs" className="small">← All bugs</Link>
      <h1>{bug.bugNumber} · {bug.title} <BugStatus status={bug.status} /> <Severity severity={bug.severity} /></h1>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="grid">
        <section className="card">
          <dl className="kv">
            <dt>Found in</dt><dd>{bug.build?.id ? <Link to={`/builds/${bug.build.id}`}>{bug.build.buildNumber} (v{bug.build.versionName})</Link> : '—'}</dd>
            <dt>Fixed in</dt><dd>{bug.fixedInBuild?.id ? <Link to={`/builds/${bug.fixedInBuild.id}`}>{bug.fixedInBuild.buildNumber} (v{bug.fixedInBuild.versionName})</Link> : '—'}</dd>
            <dt>Reporter</dt><dd>{bug.reporter?.name}</dd>
            <dt>Developer</dt><dd>{bug.assignee?.name}</dd>
            <dt>Reported</dt><dd>{formatDateTime(bug.createdAt)}</dd>
          </dl>
          <Block title="Description" text={bug.description} />
          <Block title="Steps to reproduce" text={bug.stepsToReproduce} />
          <Block title="Expected result" text={bug.expectedResult} />
          <Block title="Actual result" text={bug.actualResult} />
          {bug.attachments.length > 0 && (
            <>
              <h3>Screenshots</h3>
              <div className="shots">
                {bug.attachments.map((s) => (
                  <a key={s.name} href={`/api/bugs/${bug.id}/attachments/${s.name}`} target="_blank" rel="noreferrer">
                    <img src={`/api/bugs/${bug.id}/attachments/${s.name}`} alt={s.originalName} />
                  </a>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card stack">
          <h2>Actions</h2>
          {a.startFix && <button className="btn" disabled={busy} onClick={() => run('start-fix')}>Start working on fix</button>}
          {['open', 'in_progress', 'reopened'].includes(bug.status) && bug.actions.startFix !== undefined && !a.close && !a.reopen && (
            <p className="muted small">To mark this bug as fixed, upload a fixed build from the failed build’s page and tick this bug.</p>
          )}
          {(a.close || a.reopen) && (
            <div className="stack">
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={bug.status === 'ready_for_retest' ? 'Retest note (required to reopen)' : 'Reason (required)'} />
              <div className="row">
                {a.close && <button className="btn btn-primary" disabled={busy} onClick={() => run('close', { note }, () => setNote(''))}>{bug.status === 'ready_for_retest' ? 'Verified – close bug' : 'Close bug'}</button>}
                {a.reopen && <button className="btn btn-danger" disabled={busy} onClick={() => run('reopen', { note }, () => setNote(''))}>Reopen</button>}
              </div>
            </div>
          )}
          {!a.startFix && !a.close && !a.reopen && <p className="muted">No status actions available for you right now.</p>}
        </section>
      </div>

      <div className="grid">
        <section className="card stack">
          <h2>Comments ({comments.length})</h2>
          {comments.map((c) => (
            <div key={c.id} className="comment"><strong>{c.authorName}</strong> <span className="muted small">{formatDateTime(c.createdAt)}</span><p className="pre">{c.body}</p></div>
          ))}
          <textarea rows={2} value={comment} maxLength={3000} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" />
          <div><button className="btn" disabled={busy || !comment.trim()} onClick={() => run('comments', { body: comment }, () => setComment(''))}>Add comment</button></div>
        </section>
        <section className="card"><h2>Activity</h2><Timeline items={history} /></section>
      </div>
    </>
  );
}
