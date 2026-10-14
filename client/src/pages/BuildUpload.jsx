import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function BuildUpload() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const fixId = params.get('fix');
  const [previous, setPrevious] = useState(null);
  const [bugs, setBugs] = useState([]);
  const [testers, setTesters] = useState([]);
  const [form, setForm] = useState({ projectName: '', appName: '', versionName: '', versionCode: '', releaseNotes: '', testerId: '' });
  const [fixed, setFixed] = useState({});
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/builds/testers').then((d) => setTesters(d.items)).catch((e) => setError(e.message));
    if (fixId) {
      api(`/builds/${fixId}`).then((d) => {
        setPrevious(d.build);
        setForm((f) => ({ ...f, testerId: d.build.tester?.id || '' }));
        setBugs(d.bugs.filter((b) => b.assignee?.id === user.id && ['open', 'in_progress', 'reopened'].includes(b.status)));
      }).catch((e) => setError(e.message));
    }
  }, [fixId, user.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(''); setFieldErrors([]);
    if (!file) return setError('Please choose an APK file.');
    const fd = new FormData();
    fd.append('apk', file);
    fd.append('versionName', form.versionName);
    if (form.versionCode) fd.append('versionCode', form.versionCode);
    if (form.releaseNotes) fd.append('releaseNotes', form.releaseNotes);
    if (form.testerId) fd.append('testerId', form.testerId);
    if (fixId) {
      fd.append('previousBuildId', fixId);
      fd.append('fixedBugIds', JSON.stringify(Object.keys(fixed).filter((k) => fixed[k])));
    } else {
      fd.append('projectName', form.projectName);
      fd.append('appName', form.appName);
    }
    setBusy(true);
    try {
      const d = await api('/builds', { method: 'POST', body: fd });
      nav(`/builds/${d.build.id}`);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.details || []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{fixId ? 'Upload fixed build' : 'Upload build for testing'}</h1>
      <form className="card stack form" onSubmit={submit}>
        {error && <div className="alert alert-error" role="alert">{error}{fieldErrors.map((d) => <div key={d.path}>• {d.path}: {d.message}</div>)}</div>}
        {previous && (
          <div className="alert alert-warn">
            Fixing <strong>{previous.buildNumber}</strong> ({previous.appName} v{previous.versionName}). The APK must be a new build — an identical file is rejected.
          </div>
        )}
        {!fixId && (
          <>
            <label>Project name<input required maxLength={120} value={form.projectName} onChange={set('projectName')} /></label>
            <label>App name<input required maxLength={120} value={form.appName} onChange={set('appName')} /></label>
          </>
        )}
        <div className="row">
          <label>Version name<input required maxLength={40} value={form.versionName} onChange={set('versionName')} placeholder="1.0.3" /></label>
          <label>Version code (optional)<input maxLength={20} value={form.versionCode} onChange={set('versionCode')} placeholder="12" /></label>
        </div>
        <label>Assign tester
          <select required value={form.testerId} onChange={set('testerId')}>
            <option value="">Choose a tester…</option>
            {testers.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
          </select>
        </label>
        <label>Release notes / what to test
          <textarea rows={4} maxLength={5000} value={form.releaseNotes} onChange={set('releaseNotes')} />
        </label>
        {fixId && (
          <fieldset>
            <legend>Bugs fixed in this build</legend>
            {bugs.length === 0 ? <p className="muted">No unresolved bugs are assigned to you.</p> : bugs.map((b) => (
              <label key={b.id} className="check">
                <input type="checkbox" checked={!!fixed[b.id]} onChange={(e) => setFixed((f) => ({ ...f, [b.id]: e.target.checked }))} />
                <span><strong>{b.bugNumber}</strong> {b.title} <span className="muted small">({b.severity})</span></span>
              </label>
            ))}
            <p className="muted small">Ticked bugs move to “Ready for retest”. The tester decides whether they are really fixed.</p>
          </fieldset>
        )}
        <label>APK file (.apk)
          <input type="file" accept=".apk" required onChange={(e) => setFile(e.target.files[0] || null)} />
        </label>
        {file && <p className="muted small">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload & send to tester'}</button>
          <Link className="btn" to={fixId ? `/builds/${fixId}` : '/builds'}>Cancel</Link>
        </div>
      </form>
    </>
  );
}
