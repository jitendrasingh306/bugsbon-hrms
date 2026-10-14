import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ResetPassword() {
  const [form, setForm] = useState({ email: '', token: '', newPassword: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/auth/password-reset/confirm', { method: 'POST', body: form });
      setDone(true);
    } catch (err) {
      setError(err.details?.map((d) => d.message).join(' ') || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div className="brand"><span className="brand-mark">B</span> Bugsbon HRMS</div>
        <h1>Reset password</h1>
        {done ? (
          <>
            <div className="alert alert-ok">Password updated.</div>
            <Link className="btn btn-primary" to="/login">Go to sign in</Link>
          </>
        ) : (
          <>
            <p className="muted small">Ask your administrator for a one-time reset code (valid for 1 hour).</p>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <label>Email<input type="email" value={form.email} onChange={set('email')} required /></label>
            <label>Reset code<input value={form.token} onChange={set('token')} required autoComplete="off" /></label>
            <label>New password<input type="password" value={form.newPassword} onChange={set('newPassword')} required autoComplete="new-password" />
              <span className="muted small">At least 10 characters, with letters and numbers.</span></label>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
            <Link to="/login" className="small">Back to sign in</Link>
          </>
        )}
      </form>
    </div>
  );
}
