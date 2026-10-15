import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDateTime } from '../format.js';

function UserForm({ roles, managers, user, onClose, onSaved }) {
  const editing = !!user;
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [mobileNumber, setMobileNumber] = useState(user?.mobileNumber || '');
  const [roleIds, setRoleIds] = useState(user?.roleIds || []);
  const [reportsToId, setReportsToId] = useState(user?.reportsTo?.id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id) => setRoleIds((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const d = editing
        ? await api(`/users/${user.id}`, { method: 'PATCH', body: { name, mobileNumber: mobileNumber.trim(), roleIds, reportsToId: reportsToId || null } })
        : await api('/users', { method: 'POST', body: { name, email, mobileNumber: mobileNumber.trim(), roleIds, ...(reportsToId ? { reportsToId } : {}) } });
      onSaved(d);
    } catch (err) {
      setError(err.message + (err.details ? ' ' + err.details.map((x) => x.message).join('; ') : ''));
    } finally { setBusy(false); }
  }

  return (
    <form className="card stack form" onSubmit={submit}>
      <h2>{editing ? `Edit ${user.name}` : 'Create user'}</h2>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <label>Full name<input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      {!editing && <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
      <label>Mobile Number
        <input
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="e.g. 9876543210 or +919876543210"
          pattern="\\+?[0-9]{10,15}"
          title="Enter 10–15 digits, optionally starting with +"
          value={mobileNumber}
          onChange={(e) => setMobileNumber(e.target.value)}
        />
        <span className="muted small">Optional. The user can use this number to sign in.</span>
      </label>
      <label>Reports to (manager — can assign this person's daily tasks and verify their end-of-day report)
        <select value={reportsToId} onChange={(e) => setReportsToId(e.target.value)}>
          <option value="">— nobody —</option>
          {managers.filter((m) => m.id !== user?.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>Roles</legend>
        {roles.map((r) => (
          <label key={r.id} className="check">
            <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggle(r.id)} />
            <span><strong>{r.name}</strong> <span className="muted small">{r.description}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || roleIds.length === 0}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export default function Users() {
  const [items, setItems] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState(null);
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState(null); // null | 'new' | user

  const load = useCallback(() => api('/users').then((d) => setItems(d.items)).catch((e) => setError(e.message)).finally(() => setLoading(false)), []);
  useEffect(() => {
    load();
    api('/roles').then((d) => setRoles(d.items)).catch(() => {});
  }, [load]);

  async function issue(u) {
    if (!window.confirm(`Issue a one-time password reset code for ${u.name}? Any earlier unused code is replaced.`)) return;
    setError('');
    try {
      const d = await api(`/users/${u.id}/password-reset-token`, { method: 'POST' });
      setIssued({ ...d, name: u.name });
    } catch (e) { setError(e.message); }
  }

  async function toggleActive(u) {
    const verb = u.isActive ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${verb} ${u.name}?${u.isActive ? ' They will be signed out immediately.' : ''}`)) return;
    setError('');
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }); await load(); } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="page-head">
        <h1>Users & Roles</h1>
        {!form && <button className="btn btn-primary" onClick={() => setForm('new')}>+ Add user</button>}
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {created && (
        <div className="alert alert-ok">
          <strong>User created: {created.user.name} ({created.user.email})</strong>
          {created.user.mobileNumber && <div>Mobile: {created.user.mobileNumber}</div>}
          <div>Temporary password (shown once — they must change it at first sign-in):</div>
          <div className="code">{created.temporaryPassword}</div>
          <button className="btn btn-ghost" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}
      {issued && (
        <div className="alert alert-ok">
          <strong>Reset code for {issued.name}</strong> (shown once, valid until {formatDateTime(issued.expiresAt)}):
          <div className="code">{issued.token}</div>
          Give it to them privately; they enter it at <code>/reset-password</code> with their email.
          <div><button className="btn btn-ghost" onClick={() => setIssued(null)}>Dismiss</button></div>
        </div>
      )}
      {form && (
        <UserForm
          roles={roles}
          managers={items.filter((u) => u.isActive && u.roles.some((r) => ['manager', 'founder'].includes(r.key)))}
          user={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={(d) => { if (d.temporaryPassword) setCreated(d); setForm(null); load(); }}
        />
      )}
      <div className="card table-wrap">
        {loading ? <p className="muted pad">Loading…</p> : items.length === 0 ? <p className="muted pad">No users yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Mobile Number</th><th>Roles</th><th>Reports to</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.mobileNumber || <span className="muted">—</span>}</td>
                  <td>{u.roles.map((r) => <span key={r.key} className="badge">{r.name}</span>)}</td>
                  <td>{u.reportsTo?.name || <span className="muted">—</span>}</td>
                  <td>{!u.isActive ? <span className="badge badge-grey">Deactivated</span> : u.lockedUntil ? <span className="badge badge-red">Locked</span> : <span className="badge badge-green">Active</span>}</td>
                  <td>{formatDateTime(u.lastLoginAt)}</td>
                  <td className="actions">
                    <button className="btn btn-ghost" onClick={() => setForm(u)}>Edit</button>
                    <button className="btn btn-ghost" onClick={() => issue(u)}>Reset code</button>
                    <button className="btn btn-ghost" onClick={() => toggleActive(u)}>{u.isActive ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
