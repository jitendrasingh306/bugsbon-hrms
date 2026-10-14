import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { api } from '../api.js';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/daily', label: 'My Day', perm: 'daily.view_own', end: true },
  { to: '/daily/assign', label: 'Assign Tasks', perm: 'daily.assign' },
  { to: '/daily/review', label: 'EOD Review', perm: 'daily.eod_review' },
  { to: '/builds', label: 'Builds', any: ['builds.view_all', 'builds.view_assigned', 'builds.submit', 'tests.perform'] },
  { to: '/bugs', label: 'Bugs', any: ['bugs.view_all', 'bugs.view_assigned'] },
  { to: '/users', label: 'Users & Roles', perm: 'users.manage' },
  { to: '/audit-logs', label: 'Audit Logs', perm: 'audit.view' },
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    api('/notifications/unread-count').then((d) => setUnread(d.unreadCount)).catch(() => {});
  }, []);
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 30000);
    window.addEventListener('notifications:changed', refreshUnread);
    return () => { clearInterval(t); window.removeEventListener('notifications:changed', refreshUnread); };
  }, [refreshUnread]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">B</span> Bugsbon HRMS
        </div>
        <nav>
          {NAV.filter((n) => (n.any ? n.any.some(can) : !n.perm || can(n.perm))).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">☰</button>
          <div className="spacer" />
          <div className="who">
            <strong>{user.name}</strong>
            <span className="muted small">{user.roles.map((r) => r.name).join(', ') || 'No role'}</span>
          </div>
          <NavLink to="/notifications" className="btn btn-ghost bell" aria-label={`Notifications, ${unread} unread`}>
            🔔{unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
          <NavLink to="/change-password" className="btn btn-ghost">Change password</NavLink>
          <button className="btn" onClick={handleLogout}>Sign out</button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
