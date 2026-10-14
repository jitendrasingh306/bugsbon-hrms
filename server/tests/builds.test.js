import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { seedPermissionsAndRoles } from '../src/services/seed.service.js';
import { Build } from '../src/models/Build.js';
import { Bug } from '../src/models/Bug.js';
import { Notification } from '../src/models/Notification.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { makeUser, signIn, makeApk, makeZip, PNG } from './helpers.js';

let app;
const s = {}; // signed-in sessions by name
const tmp = process.env.UPLOAD_DIR;

const post = (who, url) => s[who].agent.post(url).set('X-CSRF-Token', s[who].csrf);

async function upload(who, fields, file = makeApk(), filename = 'app-debug.apk') {
  let r = post(who, '/api/builds');
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('apk', file, { filename });
}

const testerId = async (email) => String((await mongoose.model('User').findOne({ email }))._id);

beforeAll(async () => {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await seedPermissionsAndRoles();
  app = createApp();
  await makeUser('dev@test.local', ['developer']);
  await makeUser('dev2@test.local', ['developer']);
  await makeUser('tester@test.local', ['tester']);
  await makeUser('tester2@test.local', ['tester']);
  await makeUser('manager@test.local', ['manager']);
  await makeUser('employee@test.local', ['employee']);
  await makeUser('founder@test.local', ['founder']);
  for (const n of ['dev', 'dev2', 'tester', 'tester2', 'manager', 'employee', 'founder']) {
    s[n] = await signIn(app, `${n}@test.local`);
  }
});

afterAll(async () => {
  await disconnectDb();
});

describe('upload validation and permissions', () => {
  it('lets only users with builds.submit upload', async () => {
    const t = await testerId('tester@test.local');
    const r = await upload('employee', { projectName: 'P', appName: 'A', versionName: '1.0', testerId: t });
    expect(r.status).toBe(403);
    expect((await upload('tester', { projectName: 'P', appName: 'A', versionName: '1.0', testerId: t })).status).toBe(403);
  });

  it('rejects non-APK content, wrong extension and a developer as own tester', async () => {
    const t = await testerId('tester@test.local');
    const fake = await upload('dev', { projectName: 'P', appName: 'A', versionName: '1.0', testerId: t }, Buffer.from('not a zip at all, just text'));
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('INVALID_APK');
    const noManifest = await upload('dev', { projectName: 'P', appName: 'A', versionName: '1.0', testerId: t }, makeZip({ 'readme.txt': 'x' }));
    expect(noManifest.status).toBe(400);
    const ext = await upload('dev', { projectName: 'P', appName: 'A', versionName: '1.0', testerId: t }, makeApk(), 'app.exe');
    expect(ext.status).toBe(400);
    const self = await upload('dev', { projectName: 'P', appName: 'A', versionName: '1.0', testerId: await testerId('dev@test.local') });
    expect(self.status).toBe(400);
    const notTester = await upload('dev', { projectName: 'P', appName: 'A', versionName: '1.0', testerId: await testerId('dev2@test.local') });
    expect(notTester.status).toBe(400);
    const dir = path.join(tmp, 'builds');
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toHaveLength(0); // rejected files are cleaned up
  });

  it('requires a CSRF token', async () => {
    const r = await s.dev.agent.post('/api/builds').attach('apk', makeApk(), { filename: 'a.apk' });
    expect(r.status).toBe(403);
  });
});

describe('full Developer -> Tester -> Approved workflow', () => {
  let b1;
  let b2;
  let bugId;
  const apk1 = makeApk();

  it('developer uploads a build and the tester sees it, others do not', async () => {
    const t = await testerId('tester@test.local');
    const r = await upload('dev', { projectName: 'Bugsbon', appName: 'Bugsbon App', versionName: '1.0.0', versionCode: '1', releaseNotes: 'first', testerId: t }, apk1);
    expect(r.status).toBe(201);
    b1 = r.body.build;
    expect(b1.buildNumber).toBe('BLD-0001');
    expect(b1.status).toBe('pending_test');
    expect(b1.file.sha256).toMatch(/^[a-f0-9]{64}$/);

    const mine = await s.tester.agent.get('/api/builds?scope=testing');
    expect(mine.body.items.map((x) => x.id)).toContain(b1.id);
    expect((await s.tester2.agent.get('/api/builds')).body.items).toHaveLength(0);
    expect((await s.tester2.agent.get(`/api/builds/${b1.id}`)).status).toBe(404);
    expect((await s.employee.agent.get('/api/builds')).status).toBe(403);
    expect((await s.manager.agent.get(`/api/builds/${b1.id}`)).status).toBe(200);

    const n = await Notification.find({ user: await testerId('tester@test.local') });
    expect(n.some((x) => x.type === 'build.submitted')).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'build.submitted' })).toBe(1);
  });

  it('rejects the identical APK being uploaded again', async () => {
    const t = await testerId('tester@test.local');
    const r = await upload('dev', { projectName: 'Bugsbon', appName: 'Bugsbon App', versionName: '1.0.1', testerId: t }, apk1);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_BUILD');
  });

  it('blocks results and bugs before the tester downloaded the APK', async () => {
    const r = await post('tester', `/api/builds/${b1.id}/test-result`).send({ result: 'pass' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOWNLOAD_REQUIRED');
  });

  it('only permitted users can download; the assigned tester download starts testing', async () => {
    expect((await s.tester2.agent.get(`/api/builds/${b1.id}/download`)).status).toBe(404);
    expect((await s.employee.agent.get(`/api/builds/${b1.id}/download`)).status).toBe(403);
    const d = await s.tester.agent.get(`/api/builds/${b1.id}/download`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(d.status).toBe(200);
    expect(d.headers['content-type']).toMatch(/android/);
    expect(Buffer.compare(d.body, apk1)).toBe(0);
    const det = await s.tester.agent.get(`/api/builds/${b1.id}`);
    expect(det.body.build.status).toBe('in_testing');
    expect(det.body.build.actions.recordResult).toBe(true);
    expect(det.body.build.actions.uploadFix).toBe(false);
  });

  it('only the assigned tester can report a bug; screenshots are validated', async () => {
    const fields = { title: 'Crash on login', description: 'App closes when tapping Login', severity: 'high' };
    const asDev = await s.dev.agent.post(`/api/builds/${b1.id}/bugs`).set('X-CSRF-Token', s.dev.csrf).field(fields);
    expect(asDev.status).toBe(403);
    const asOther = await s.tester2.agent.post(`/api/builds/${b1.id}/bugs`).set('X-CSRF-Token', s.tester2.csrf).field(fields);
    expect(asOther.status).toBe(404);

    const bad = await post('tester', `/api/builds/${b1.id}/bugs`).field(fields).attach('screenshots', Buffer.from('not an image'), { filename: 'x.png' });
    expect(bad.status).toBe(400);

    const ok = await post('tester', `/api/builds/${b1.id}/bugs`).field(fields).attach('screenshots', PNG, { filename: 'shot.png' });
    expect(ok.status).toBe(201);
    bugId = ok.body.bug.id;
    const devNotif = await Notification.find({ user: await testerId('dev@test.local'), type: 'bug.reported' });
    expect(devNotif).toHaveLength(1);

    const img = await s.dev.agent.get(`/api/bugs/${bugId}`);
    expect(img.body.bug.attachments).toHaveLength(1);
    const file = await s.dev.agent.get(`/api/bugs/${bugId}/attachments/${img.body.bug.attachments[0].name}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect((await s.tester2.agent.get(`/api/bugs/${bugId}/attachments/${img.body.bug.attachments[0].name}`)).status).toBe(404);
  });

  it('Pass is blocked while a bug is open; Fail needs a reason', async () => {
    const pass = await post('tester', `/api/builds/${b1.id}/test-result`).send({ result: 'pass' });
    expect(pass.status).toBe(409);
    expect(pass.body.error.code).toBe('OPEN_BUGS');
    expect((await post('tester', `/api/builds/${b1.id}/test-result`).send({ result: 'fail', notes: 'bad' })).status).toBe(400);
    const fail = await post('tester', `/api/builds/${b1.id}/test-result`).send({ result: 'fail', notes: 'Login crashes the app, see bug.' });
    expect(fail.status).toBe(200);
    expect(fail.body.build.status).toBe('failed');
    expect(await Notification.countDocuments({ type: 'build.failed' })).toBe(1);
  });

  it('developer cannot close their own bug; can start a fix', async () => {
    expect((await post('dev', `/api/bugs/${bugId}/close`).send({ note: 'closing my own bug' })).status).toBe(403);
    expect((await post('dev', `/api/bugs/${bugId}/reopen`).send({ note: 'whatever it is' })).status).toBe(403);
    const r = await post('dev', `/api/bugs/${bugId}/start-fix`).send({});
    expect(r.status).toBe(200);
    expect(r.body.bug.status).toBe('in_progress');
    expect((await post('tester', `/api/bugs/${bugId}/start-fix`).send({})).status).toBe(403);
    expect((await post('dev', `/api/bugs/${bugId}/comments`).send({ body: 'Looking into it' })).status).toBe(201);
  });

  it('developer uploads a fixed build: old build superseded, bug ready for retest', async () => {
    const wrongProject = await upload('dev2', { versionName: '1.0.1', previousBuildId: b1.id });
    expect(wrongProject.status).toBe(404);
    const noBugs = await upload('dev', { versionName: '1.0.1', previousBuildId: b1.id, fixedBugIds: JSON.stringify(['a'.repeat(24)]) });
    expect(noBugs.status).toBe(400);

    const r = await upload('dev', { versionName: '1.0.1', versionCode: '2', previousBuildId: b1.id, fixedBugIds: JSON.stringify([bugId]), releaseNotes: 'fixed login crash' });
    expect(r.status).toBe(201);
    b2 = r.body.build;
    expect(b2.iteration).toBe(2);
    expect(b2.rootBuild).toBe(b1.rootBuild);
    expect((await Build.findById(b1.id)).status).toBe('superseded');
    const bug = await Bug.findById(bugId);
    expect(bug.status).toBe('ready_for_retest');
    expect(String(bug.fixedInBuild)).toBe(b2.id);
    expect(String(bug.build)).toBe(b1.id);
    expect(await Notification.countDocuments({ type: 'build.resubmitted' })).toBe(1);
    // a second fix upload for the same (now superseded) build is refused
    expect((await upload('dev', { versionName: '1.0.2', previousBuildId: b1.id })).status).toBe(409);
  });

  it('tester reopens a bad fix, build fails again, third build passes', async () => {
    await s.tester.agent.get(`/api/builds/${b2.id}/download`).buffer(true).parse((res, cb) => { res.on('data', () => {}); res.on('end', () => cb(null, null)); });
    expect((await post('tester', `/api/bugs/${bugId}/reopen`).send({ note: '' })).status).toBe(400);
    const re = await post('tester', `/api/bugs/${bugId}/reopen`).send({ note: 'Still crashes on Android 13' });
    expect(re.status).toBe(200);
    expect(re.body.bug.status).toBe('reopened');
    expect((await post('tester', `/api/builds/${b2.id}/test-result`).send({ result: 'pass' })).status).toBe(409);
    expect((await post('tester', `/api/builds/${b2.id}/test-result`).send({ result: 'fail', notes: 'Bug still reproducible.' })).status).toBe(200);

    const r3 = await upload('dev', { versionName: '1.0.2', previousBuildId: b2.id, fixedBugIds: JSON.stringify([bugId]) });
    expect(r3.status).toBe(201);
    const b3 = r3.body.build;
    expect(b3.iteration).toBe(3);
    await s.tester.agent.get(`/api/builds/${b3.id}/download`).buffer(true).parse((res, cb) => { res.on('data', () => {}); res.on('end', () => cb(null, null)); });

    expect((await post('tester', `/api/builds/${b3.id}/test-result`).send({ result: 'pass' })).status).toBe(409); // bug still ready_for_retest
    const close = await post('tester', `/api/bugs/${bugId}/close`).send({ note: 'Verified fixed' });
    expect(close.status).toBe(200);
    expect(close.body.bug.status).toBe('closed');

    const pass = await post('tester', `/api/builds/${b3.id}/test-result`).send({ result: 'pass', notes: 'All good' });
    expect(pass.status).toBe(200);
    expect(pass.body.build.status).toBe('approved');
    expect(pass.body.build.approvedBy.email).toBe('tester@test.local');
    expect(await Notification.countDocuments({ type: 'build.approved' })).toBeGreaterThanOrEqual(2); // developer + manager/founder
    expect((await post('tester', `/api/builds/${b3.id}/test-result`).send({ result: 'fail', notes: 'changing my mind later' })).status).toBe(409);

    const detail = await s.manager.agent.get(`/api/builds/${b3.id}`);
    expect(detail.body.lineage.map((l) => l.status)).toEqual(['superseded', 'superseded', 'approved']);
    expect(detail.body.history.length).toBeGreaterThan(2);
    expect(await AuditLog.countDocuments({ action: 'build.approved' })).toBe(1);
  });
});

describe('tester assignment, withdraw, dashboard, notifications', () => {
  let b;
  it('manager can reassign the tester; the new tester is notified; developer cannot reassign', async () => {
    const r = await upload('dev', { projectName: 'Other', appName: 'Other App', versionName: '2.0', testerId: await testerId('tester@test.local') });
    b = r.body.build;
    expect((await post('dev', `/api/builds/${b.id}/assign-tester`).send({ testerId: await testerId('tester2@test.local') })).status).toBe(403);
    expect((await post('manager', `/api/builds/${b.id}/assign-tester`).send({ testerId: await testerId('dev@test.local') })).status).toBe(400);
    const ok = await post('manager', `/api/builds/${b.id}/assign-tester`).send({ testerId: await testerId('tester2@test.local') });
    expect(ok.status).toBe(200);
    expect(ok.body.build.tester.email).toBe('tester2@test.local');
    expect((await s.tester.agent.get(`/api/builds/${b.id}`)).status).toBe(404);
    expect((await s.tester2.agent.get(`/api/builds/${b.id}`)).status).toBe(200);
    expect(await Notification.countDocuments({ user: await testerId('tester2@test.local'), type: 'build.assigned' })).toBe(1);
  });

  it('summary shows role-specific counters', async () => {
    const t = await s.tester2.agent.get('/api/builds/summary');
    expect(t.body.asTester.pending).toBe(1);
    const d = await s.dev.agent.get('/api/builds/summary');
    expect(d.body.asDeveloper.approved).toBe(1);
    expect(d.body.asDeveloper.pending).toBe(1);
    const m = await s.manager.agent.get('/api/builds/summary');
    expect(m.body.overall.byStatus.approved).toBe(1);
  });

  it('developer can withdraw a build that has not been tested', async () => {
    const w = await post('dev', `/api/builds/${b.id}/withdraw`).send({});
    expect(w.status).toBe(200);
    expect(w.body.build.status).toBe('withdrawn');
    expect((await post('dev', `/api/builds/${b.id}/withdraw`).send({})).status).toBe(409);
  });

  it('notifications are private, countable and can be marked read', async () => {
    const list = await s.tester2.agent.get('/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBeGreaterThan(0);
    const first = list.body.items[0];
    expect((await post('tester', `/api/notifications/${first.id}/read`).send({})).status).toBe(404); // someone else's
    expect((await post('tester2', `/api/notifications/${first.id}/read`).send({})).status).toBe(204);
    expect((await post('tester2', '/api/notifications/read-all').send({})).status).toBe(204);
    expect((await s.tester2.agent.get('/api/notifications/unread-count')).body.unreadCount).toBe(0);
    expect((await request401()).status).toBe(401);
  });
});

async function request401() {
  const { default: request } = await import('supertest');
  return request(app).get('/api/notifications');
}

describe('user management needed for the workflow', () => {
  it('founder creates a tester with a one-time temporary password, who must change it', async () => {
    const roles = (await s.founder.agent.get('/api/roles')).body.items;
    const tester = roles.find((r) => r.key === 'tester');
    const r = await post('founder', '/api/users').send({ name: 'New Tester', email: 'new.tester@test.local', roleIds: [tester.id] });
    expect(r.status).toBe(201);
    expect(r.body.temporaryPassword.length).toBeGreaterThan(10);
    const login = await signIn(app, 'new.tester@test.local', r.body.temporaryPassword);
    const me = await login.agent.get('/api/auth/me');
    expect(me.body.user.mustChangePassword).toBe(true);
    expect((await login.agent.get('/api/builds')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await post('founder', '/api/users').send({ name: 'Dup', email: 'new.tester@test.local', roleIds: [tester.id] })).status).toBe(409);
    expect(await AuditLog.countDocuments({ action: 'user.created' })).toBe(1);
  });

  it('manager cannot create users; user admin rules protect the founder', async () => {
    const roles = (await s.founder.agent.get('/api/roles')).body.items;
    expect((await post('manager', '/api/users').send({ name: 'X Y', email: 'x@test.local', roleIds: [roles[0].id] })).status).toBe(403);
    const founderUser = await mongoose.model('User').findOne({ email: 'founder@test.local' });
    expect((await s.founder.agent.patch(`/api/users/${founderUser._id}`).set('X-CSRF-Token', s.founder.csrf).send({ isActive: false })).status).toBe(400);
  });

  it('deactivating a user ends their session', async () => {
    const u = await mongoose.model('User').findOne({ email: 'dev2@test.local' });
    const r = await s.founder.agent.patch(`/api/users/${u._id}`).set('X-CSRF-Token', s.founder.csrf).send({ isActive: false });
    expect(r.status).toBe(200);
    expect((await s.dev2.agent.get('/api/auth/me')).status).toBe(401);
  });
});
