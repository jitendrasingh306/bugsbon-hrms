import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatBytes, formatDateTime } from '../format.js';
import { BugStatus, BuildStatus, Severity } from '../components/Badges.jsx';
import Timeline from '../components/Timeline.jsx';

function ReportBug({ buildId, onDone }) {
  const [f, setF] = useState({ title: '', description: '', stepsToReproduce: '', expectedResult: '', actualResult: '', severity: 'medium' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
    files.forEach((file) => fd.append('screenshots', file));
    try {
      await api(`/builds/${buildId}/bugs`, { method: 'POST', body: fd });
      onDone();
    } catch (err) {
      setError(err.message + (err.details ? ' ' + err.details.map((d) => `${d.path}: ${d.message}`).join('; ') : ''));
    } finally { setBusy(false); }
  }

  return (
    <form className="card stack form" onSubmit={submit}>
      <h2>Report a bug</h2>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <label>Title<input required minLength={3} maxLength={200} value={f.title} onChange={set('title')} /></label>
      <label>Severity
        <select value={f.severity} onChange={set('severity')}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
        </select>
      </label>
      <label>Description<textarea required rows={3} minLength={5} value={f.description} onChange={set('description')} /></label>
      <label>Steps to reproduce<textarea rows={3} value={f.stepsToReproduce} onChange={set('stepsToReproduce')} /></label>
      <div className="row">
        <label>Expected result<textarea rows={2} value={f.expectedResult} onChange={set('expectedResult')} /></label>
        <label>Actual result<textarea rows={2} value={f.actualResult} onChange={set('actualResult')} /></label>
      </div>
      <label>Screenshots (up to 3 — PNG, JPG, WEBP)
        <input type="file" multiple accept=".png,.jpg,.jpeg,.webp" onChange={(e) => setFiles([...e.target.files].slice(0, 3))} />
      </label>
      <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Submit bug'}</button></div>
    </form>
  );
}

export default function BuildDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [showBug, setShowBug] = useState(false);
  const [notes, setNotes] = useState('');
  const [testers, setTesters] = useState([]);
  const [newTester, setNewTester] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/builds/${id}`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => {
    if (data?.build.actions.reassign) api('/builds/testers').then((d) => setTesters(d.items)).catch(() => {});
  }, [data?.build.actions.reassign]);

  async function act(fn, success) {
    setError(''); setMsg(''); setBusy(true);
    try { await fn(); if (success) setMsg(success); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const post = (path, body = {}) => api(`/builds/${id}/${path}`, { method: 'POST', body });

  if (error && !data) return <div className="alert alert-error" role="alert">{error} <Link to="/builds">Back to builds</Link></div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { build, bugs, lineage, history } = data;
  const a = build.actions;
  const unresolved = bugs.filter((b) => b.status !== 'closed').length;

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/builds" className="small">← All builds</Link>
          <h1>{build.buildNumber} · {build.appName} <span className="muted">v{build.versionName}</span> <BuildStatus status={build.status} /></h1>
        </div>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {msg && <div className="alert alert-ok">{msg}</div>}

      {build.status === 'approved' && <div className="alert alert-ok">✅ Approved by {build.approvedBy?.name} on {formatDateTime(build.approvedAt)} — all tests passed and every bug is closed.</div>}
      {build.status === 'failed' && a.uploadFix && <div className="alert alert-warn">This build failed testing. Fix the bugs below and upload a new APK.</div>}
      {build.status === 'superseded' && <div className="alert alert-warn">A newer build has replaced this one. See the build chain below.</div>}

      <div className="grid">
        <section className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Project</dt><dd>{build.projectName}</dd>
            <dt>Version</dt><dd>{build.versionName}{build.versionCode ? ` (code ${build.versionCode})` : ''}</dd>
            <dt>Developer</dt><dd>{build.developer?.name}</dd>
            <dt>Tester</dt><dd>{build.tester?.name}</dd>
            <dt>Uploaded</dt><dd>{formatDateTime(build.createdAt)}</dd>
            <dt>File</dt><dd>{build.file?.name} · {formatBytes(build.file?.size)}</dd>
            <dt>SHA-256</dt><dd className="mono small">{build.file?.sha256}</dd>
            <dt>Downloads</dt><dd>{build.downloadCount}</dd>
          </dl>
          {build.releaseNotes && <><h3>Release notes</h3><p className="pre">{build.releaseNotes}</p></>}
        </section>

        <section className="card stack">
          <h2>Actions</h2>
          {a.download && build.file && (
            <a className="btn btn-primary" href={`/api/builds/${build.id}/download`} onClick={() => setTimeout(load, 2000)}>⬇ Download APK</a>
          )}
          {a.startTest && <button className="btn" disabled={busy} onClick={() => act(() => post('start-test'), 'Testing started.')}>Start testing</button>}
          {a.reportBug && <button className="btn" onClick={() => setShowBug((s) => !s)}>{showBug ? 'Hide bug form' : 'Report a bug'}</button>}
          {a.uploadFix && <Link className="btn btn-primary" to={`/builds/new?fix=${build.id}`}>Upload fixed build</Link>}
          {a.withdraw && <button className="btn" disabled={busy} onClick={() => window.confirm('Withdraw this build?') && act(() => post('withdraw'), 'Build withdrawn.')}>Withdraw build</button>}
          {a.reassign && (
            <div className="row">
              <select value={newTester} onChange={(e) => setNewTester(e.target.value)}>
                <option value="">Change tester…</option>
                {testers.filter((t) => t.id !== build.tester?.id && t.id !== build.developer?.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn" disabled={!newTester || busy} onClick={() => act(() => post('assign-tester', { testerId: newTester }), 'Tester changed.')}>Assign</button>
            </div>
          )}
          {a.recordResult && (
            <div className="stack">
              <h3>Test result</h3>
              {unresolved > 0 && <p className="small muted">{unresolved} bug(s) are not closed yet — Pass is only possible when all are closed.</p>}
              <textarea rows={3} placeholder="Notes (required when failing, at least 10 characters)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <div className="row">
                <button className="btn btn-primary" disabled={busy || unresolved > 0} onClick={() => act(() => post('test-result', { result: 'pass', notes }), 'Build passed and approved.')}>Pass</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => act(() => post('test-result', { result: 'fail', notes }), 'Build marked as failed.')}>Fail</button>
              </div>
            </div>
          )}
          {build.testerDownloadedAt == null && build.tester && a.startTest === false && build.status === 'in_testing' && <p className="small muted">Waiting for the tester to download the APK.</p>}
          {!a.download && !a.startTest && !a.uploadFix && !a.withdraw && !a.reassign && !a.recordResult && <p className="muted">No actions available for you on this build.</p>}
        </section>
      </div>

      {showBug && a.reportBug && <ReportBug buildId={build.id} onDone={() => { setShowBug(false); setMsg('Bug reported. The developer was notified.'); load(); }} />}

      <section className="card table-wrap">
        <h2 className="pad-h">Bugs in this build chain ({bugs.length})</h2>
        {bugs.length === 0 ? <p className="muted pad">No bugs reported.</p> : (
          <table>
            <thead><tr><th>Bug</th><th>Severity</th><th>Status</th><th>Found in</th><th>Fixed in</th></tr></thead>
            <tbody>
              {bugs.map((b) => (
                <tr key={b.id}>
                  <td><Link to={`/bugs/${b.id}`}><strong>{b.bugNumber}</strong></Link> {b.title}</td>
                  <td><Severity severity={b.severity} /></td>
                  <td><BugStatus status={b.status} /></td>
                  <td>{b.build?.buildNumber}</td>
                  <td>{b.fixedInBuild?.buildNumber || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid">
        <section className="card">
          <h2>Build chain</h2>
          <ol className="chain">
            {lineage.map((l) => (
              <li key={l.id} className={l.id === build.id ? 'current' : ''}>
                <Link to={`/builds/${l.id}`}>{l.buildNumber}</Link> v{l.versionName} <BuildStatus status={l.status} />
              </li>
            ))}
          </ol>
        </section>
        <section className="card"><h2>Activity</h2><Timeline items={history} /></section>
      </div>
    </>
  );
}
