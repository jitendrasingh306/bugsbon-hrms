import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { formatDateTime } from '../format.js';
import Pager from '../components/Pager.jsx';

export default function Notifications() {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pages: 1, unreadCount: 0 });
  const [error, setError] = useState('');
  const load = useCallback(() => api(`/notifications?page=${page}`).then(setData).catch((e) => setError(e.message)), [page]);
  useEffect(() => { load(); }, [load]);

  async function open(n) {
    try { if (!n.read) await api(`/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* ignore */ }
    window.dispatchEvent(new Event('notifications:changed'));
    if (n.link) nav(n.link); else load();
  }
  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' });
    window.dispatchEvent(new Event('notifications:changed'));
    load();
  }

  return (
    <>
      <div className="page-head">
        <h1>Notifications</h1>
        <button className="btn" onClick={readAll} disabled={!data.unreadCount}>Mark all as read</button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="card">
        {data.items.length === 0 ? <p className="muted">No notifications yet.</p> : (
          <ul className="notif-list">
            {data.items.map((n) => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <button className="notif" onClick={() => open(n)}>
                  <strong>{n.title}</strong>
                  {n.message && <div className="small">{n.message}</div>}
                  <div className="muted small">{formatDateTime(n.createdAt)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Pager page={page} pages={data.pages} onPage={setPage} />
    </>
  );
}
