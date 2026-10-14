import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { transactionsEnabled } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { loginLimiter, sensitiveLimiter } from '../middleware/rateLimit.js';
import * as auth from '../controllers/auth.controller.js';
import * as users from '../controllers/users.controller.js';
import * as auditCtl from '../controllers/audit.controller.js';
import * as builds from '../controllers/builds.controller.js';
import * as bugs from '../controllers/bugs.controller.js';
import * as daily from '../controllers/daily.controller.js';
import * as notifs from '../controllers/notifications.controller.js';
import { apkUpload, bugImageUpload } from '../middleware/upload.js';

const router = Router();

// Public, non-sensitive status (used by the dashboard and for troubleshooting)
router.get('/health', (req, res) =>
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    transactions: transactionsEnabled,
    timezone: env.COMPANY_TIMEZONE,
  })
);

// Authentication
const authRouter = Router();
authRouter.get('/csrf', auth.getCsrf);
authRouter.post('/login', loginLimiter, validate({ body: auth.loginBody }), auth.login);
authRouter.post('/logout', auth.logout);
authRouter.get('/me', requireAuth({ allowPasswordChange: true }), auth.me);
authRouter.post(
  '/change-password',
  sensitiveLimiter,
  requireAuth({ allowPasswordChange: true }),
  validate({ body: auth.changePasswordBody }),
  auth.changePassword
);
authRouter.post(
  '/password-reset/confirm',
  sensitiveLimiter,
  validate({ body: auth.resetConfirmBody }),
  auth.confirmPasswordReset
);
router.use('/auth', authRouter);

// User administration
const usersRouter = Router();
usersRouter.use(requireAuth(), requirePermission('users.manage'));
usersRouter.get('/', users.listUsers);
usersRouter.post('/', sensitiveLimiter, validate({ body: users.createUserBody }), users.createUser);
usersRouter.patch('/:id', validate({ params: users.idParams, body: users.updateUserBody }), users.updateUser);
usersRouter.post(
  '/:id/password-reset-token',
  sensitiveLimiter,
  validate({ params: users.idParams }),
  users.issuePasswordResetToken
);
router.use('/users', usersRouter);

// Roles & permissions (read-only in Phase A)
const roleAccess = [requireAuth(), requireAnyPermission('roles.manage', 'users.manage')];
router.get('/roles', ...roleAccess, users.listRoles);
router.get('/permissions', ...roleAccess, users.listPermissions);

// Audit log (read-only)
const auditRouter = Router();
auditRouter.use(requireAuth(), requirePermission('audit.view'));
auditRouter.get('/', validate({ query: auditCtl.auditQuery }), auditCtl.listAuditLogs);
router.use('/audit-logs', auditRouter);

// Builds (APK upload -> test -> bugs -> fix -> approve)
const viewBuilds = [requireAuth(), requireAnyPermission('builds.view_all', 'builds.view_assigned', 'builds.submit', 'tests.perform')];
const bp = validate({ params: builds.idParams });
const buildsRouter = Router();
buildsRouter.use(...viewBuilds);
buildsRouter.get('/', validate({ query: builds.listQuery }), builds.listBuilds);
buildsRouter.get('/summary', builds.summary);
buildsRouter.get('/testers', requireAnyPermission('builds.submit', 'builds.assign_tester'), builds.listTesters);
buildsRouter.post('/', sensitiveLimiter, requirePermission('builds.submit'), apkUpload, builds.submitBuild);
buildsRouter.get('/:id', bp, builds.getBuild);
buildsRouter.get('/:id/download', requirePermission('builds.download'), bp, builds.downloadBuild);
buildsRouter.post('/:id/start-test', requirePermission('tests.perform'), bp, builds.startTest);
buildsRouter.post('/:id/test-result', requirePermission('tests.perform'), validate({ params: builds.idParams, body: builds.resultBody }), builds.recordResult);
buildsRouter.post('/:id/assign-tester', requirePermission('builds.assign_tester'), validate({ params: builds.idParams, body: builds.assignBody }), builds.assignTester);
buildsRouter.post('/:id/withdraw', bp, builds.withdrawBuild);
buildsRouter.post('/:id/bugs', requirePermission('bugs.report'), bugImageUpload, validate({ params: builds.idParams }), builds.reportBug);
router.use('/builds', buildsRouter);

// Bugs
const bugsRouter = Router();
bugsRouter.use(requireAuth(), requireAnyPermission('bugs.view_all', 'bugs.view_assigned'));
const bugP = validate({ params: bugs.idParams });
bugsRouter.get('/', validate({ query: bugs.listQuery }), bugs.listBugs);
bugsRouter.get('/:id', bugP, bugs.getBug);
bugsRouter.get('/:id/attachments/:name', validate({ params: bugs.attachmentParams }), bugs.getAttachment);
bugsRouter.post('/:id/start-fix', requirePermission('bugs.fix'), bugP, bugs.startFix);
bugsRouter.post('/:id/comments', validate({ params: bugs.idParams, body: bugs.commentBody }), bugs.addComment);
bugsRouter.post('/:id/close', requirePermission('bugs.close'), validate({ params: bugs.idParams, body: bugs.noteBody }), bugs.closeBug);
bugsRouter.post('/:id/reopen', requirePermission('bugs.verify'), validate({ params: bugs.idParams, body: bugs.noteBody }), bugs.reopenBug);
router.use('/bugs', bugsRouter);

// In-app notifications (own only)
const notifRouter = Router();
notifRouter.use(requireAuth());
notifRouter.get('/', validate({ query: notifs.listQuery }), notifs.listNotifications);
notifRouter.get('/unread-count', notifs.unreadCount);
notifRouter.post('/read-all', notifs.markAllRead);
notifRouter.post('/:id/read', validate({ params: notifs.idParams }), notifs.markRead);
router.use('/notifications', notifRouter);

// Daily time-slot tasks and end-of-day verification
const dailyRouter = Router();
dailyRouter.use(requireAuth());
const D = (...p) => requirePermission(...p);
dailyRouter.get('/summary', daily.dailySummary);
dailyRouter.get('/schedule', D('daily.view_own'), validate({ query: daily.dateQuery }), daily.mySchedule);
dailyRouter.patch('/tasks/:id/status', D('daily.update_own'), validate({ params: daily.idParams, body: daily.statusBody }), daily.updateMyTaskStatus);
dailyRouter.get('/assignees', D('daily.assign'), daily.listAssignees);
dailyRouter.post('/tasks', D('daily.assign'), validate({ body: daily.assignBody }), daily.assignTasks);
dailyRouter.patch('/tasks/:id', D('daily.assign'), validate({ params: daily.idParams, body: daily.updateTaskBody }), daily.updateTask);
dailyRouter.post('/tasks/:id/cancel', D('daily.assign'), validate({ params: daily.idParams, body: daily.cancelBody }), daily.cancelTask);
dailyRouter.get('/team', requireAnyPermission('daily.view_team', 'daily.view_all', 'daily.assign'), validate({ query: daily.teamQuery }), daily.teamBoard);
dailyRouter.post('/eod', D('daily.eod_submit'), validate({ body: daily.eodBody }), daily.submitEod);
dailyRouter.get('/eod', validate({ query: daily.eodListQuery }), daily.listEod);
dailyRouter.get('/eod/:id', validate({ params: daily.idParams }), daily.getEod);
dailyRouter.post('/eod/:id/verify', D('daily.eod_review'), validate({ params: daily.idParams, body: daily.verifyBody }), daily.verifyEod);
dailyRouter.post('/eod/:id/return', D('daily.eod_review'), validate({ params: daily.idParams, body: daily.returnBody }), daily.returnEod);
router.use('/daily', dailyRouter);

export default router;
