import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function ChangePassword() {
  const { user, applySession } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setOk(false);
    if (form.newPassword !== form.confirm) return setError('New passwords do not match.');
    setBusy(true);
    try {
      const d = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      applySession(d);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setOk(true);
    } catch (err) {
      setError(err.details?.map((d) => d.message).join(' ') || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card narrow">
      <h1>Change password</h1>
      {user.mustChangePassword && <div className="alert alert-warn">You must choose a new password before continuing.</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {ok && <div className="alert alert-ok">Password changed. Other devices were signed out.</div>}
      <form onSubmit={onSubmit} className="stack">
        <label>Current password<input type="password" value={form.currentPassword} onChange={set('currentPassword')} required autoComplete="current-password" /></label>
        <label>New password<input type="password" value={form.newPassword} onChange={set('newPassword')} required autoComplete="new-password" />
          <span className="muted small">At least 10 characters, with letters and numbers.</span></label>
        <label>Confirm new password<input type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" /></label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </div>
  );
}
