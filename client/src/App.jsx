import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Users from './pages/Users.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import Builds from './pages/Builds.jsx';
import BuildUpload from './pages/BuildUpload.jsx';
import BuildDetail from './pages/BuildDetail.jsx';
import Bugs from './pages/Bugs.jsx';
import BugDetail from './pages/BugDetail.jsx';
import Notifications from './pages/Notifications.jsx';
import MyDay from './pages/MyDay.jsx';
import AssignTasks from './pages/AssignTasks.jsx';
import EodReview from './pages/EodReview.jsx';

export const BUILD_VIEW = ['builds.view_all', 'builds.view_assigned', 'builds.submit', 'tests.perform'];
export const BUG_VIEW = ['bugs.view_all', 'bugs.view_assigned'];

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

// UI-level convenience only — the server enforces every permission independently.
function RequirePermission({ perm, any, children }) {
  const { can } = useAuth();
  const allowed = any ? any.some(can) : can(perm);
  if (!allowed) {
    return (
      <div className="card narrow">
        <h1>Access denied</h1>
        <p className="muted">You do not have permission to view this page.</p>
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/builds" element={<RequirePermission any={BUILD_VIEW}><Builds /></RequirePermission>} />
        <Route path="/builds/new" element={<RequirePermission perm="builds.submit"><BuildUpload /></RequirePermission>} />
        <Route path="/builds/:id" element={<RequirePermission any={BUILD_VIEW}><BuildDetail /></RequirePermission>} />
        <Route path="/bugs" element={<RequirePermission any={BUG_VIEW}><Bugs /></RequirePermission>} />
        <Route path="/bugs/:id" element={<RequirePermission any={BUG_VIEW}><BugDetail /></RequirePermission>} />
        <Route path="/daily" element={<RequirePermission perm="daily.view_own"><MyDay /></RequirePermission>} />
        <Route path="/daily/assign" element={<RequirePermission perm="daily.assign"><AssignTasks /></RequirePermission>} />
        <Route path="/daily/review" element={<RequirePermission perm="daily.eod_review"><EodReview /></RequirePermission>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/users" element={<RequirePermission perm="users.manage"><Users /></RequirePermission>} />
        <Route path="/audit-logs" element={<RequirePermission perm="audit.view"><AuditLogs /></RequirePermission>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
