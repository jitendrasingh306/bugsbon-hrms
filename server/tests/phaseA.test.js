import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { seedPermissionsAndRoles } from '../src/services/seed.service.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { hashPassword } from '../src/utils/password.js';

const PASSWORD = 'Sup3rSecret-pass';
let app;
const ids = {};

async function makeUser(email, roleKeys, extra = {}) {
  const roles = await Role.find({ key: { $in: roleKeys } });
  return User.create({
    email,
    name: email.split('@')[0],
    passwordHash: await hashPassword(PASSWORD),
    roles: roles.map((r) => r._id),
    ...extra,
  });
}

async function signIn(email, password = PASSWORD) {
  const agent = request.agent(app);
  const c = await agent.get('/api/auth/csrf');
  const res = await agent.post('/api/auth/login').set('X-CSRF-Token', c.body.csrfToken).send({ email, password });
  return { agent, res, csrf: res.body.csrfToken || c.body.csrfToken };
}

beforeAll(async () => {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await seedPermissionsAndRoles();
  await Role.create({ key: 'user-admin', name: 'User Admin', permissions: ['users.manage'] });
  app = createApp();

  ids.founder = (await makeUser('founder@test.local', ['founder']))._id;
  await makeUser('manager@test.local', ['manager']);
  await makeUser('employee@test.local', ['employee']);
  await makeUser('useradmin@test.local', ['user-admin']);
});

afterAll(async () => {
  await disconnectDb();
});

describe('health', () => {
  it('reports status without authentication', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('authentication', () => {
  it('rejects state-changing requests without a CSRF token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'founder@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('signs in with valid credentials and sets an HttpOnly cookie', async () => {
    const { agent, res } = await signIn('founder@test.local');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('founder@test.local');
    expect(res.body.user.permissions).toEqual(['*']);
    expect(res.headers['set-cookie'].join(';')).toMatch(/HttpOnly/i);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
  });

  it('signs in with a saved mobile number using the identifier field', async () => {
    await makeUser('mobilelogin@test.local', ['employee'], { mobileNumber: '9876543210' });
    const agent = request.agent(app);
    const csrf = await agent.get('/api/auth/csrf');
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ identifier: '9876543210', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('mobilelogin@test.local');
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const wrong = await signIn('founder@test.local', 'totally-wrong-pass1');
    const unknown = await signIn('nobody@test.local', 'totally-wrong-pass1');
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.body.error.message).toBe(unknown.res.body.error.message);
  });

  it('returns 401 for protected routes when signed out', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/audit-logs')).status).toBe(401);
    expect((await request(app).get('/api/users')).status).toBe(401);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    await makeUser('lockme@test.local', ['employee']);
    for (let i = 0; i < 5; i += 1) await signIn('lockme@test.local', 'wrong-password-1');
    const { res } = await signIn('lockme@test.local');
    expect(res.status).toBe(423);
  });

  it('blocks deactivated users and invalidates their existing session', async () => {
    const u = await makeUser('leaver@test.local', ['employee']);
    const { agent } = await signIn('leaver@test.local');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    await User.updateOne({ _id: u._id }, { isActive: false });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await signIn('leaver@test.local')).res.status).toBe(403);
  });

  it('changes password, signs out other sessions and rejects the old password', async () => {
    await makeUser('changer@test.local', ['employee']);
    const a = await signIn('changer@test.local');
    const b = await signIn('changer@test.local');
    const bad = await b.agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', b.csrf)
      .send({ currentPassword: 'not-the-password1', newPassword: 'BrandNewPass-77' });
    expect(bad.status).toBe(400);

    const ok = await b.agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', b.csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass-77' });
    expect(ok.status).toBe(200);
    expect((await b.agent.get('/api/auth/me')).status).toBe(200);
    expect((await a.agent.get('/api/auth/me')).status).toBe(401);
    expect((await signIn('changer@test.local')).res.status).toBe(401);
    expect((await signIn('changer@test.local', 'BrandNewPass-77')).res.status).toBe(200);
  });

  it('rejects weak new passwords', async () => {
    await makeUser('weak@test.local', ['employee']);
    const s = await signIn('weak@test.local');
    const res = await s.agent
      .post('/api/auth/change-password')
      .set('X-CSRF-Token', s.csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'short1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('forces a password change when mustChangePassword is set', async () => {
    await makeUser('forced@test.local', ['employee'], { mustChangePassword: true });
    const s = await signIn('forced@test.local');
    expect(s.res.status).toBe(200);
    expect((await s.agent.get('/api/auth/me')).status).toBe(200);
    const blocked = await s.agent.get('/api/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('authorization (server-side RBAC)', () => {
  it('denies employees and managers access to admin endpoints', async () => {
    const emp = await signIn('employee@test.local');
    expect((await emp.agent.get('/api/audit-logs')).status).toBe(403);
    expect((await emp.agent.get('/api/users')).status).toBe(403);
    expect((await emp.agent.get('/api/roles')).status).toBe(403);
    const mgr = await signIn('manager@test.local');
    expect((await mgr.agent.get('/api/audit-logs')).status).toBe(403);
    expect((await mgr.agent.get('/api/users')).status).toBe(403);
  });

  it('lets the founder use admin endpoints', async () => {
    const f = await signIn('founder@test.local');
    expect((await f.agent.get('/api/audit-logs')).status).toBe(200);
    expect((await f.agent.get('/api/users')).status).toBe(200);
    const roles = await f.agent.get('/api/roles');
    expect(roles.status).toBe(200);
    expect(roles.body.items.map((r) => r.key)).toEqual(expect.arrayContaining(['founder', 'manager', 'employee', 'tester', 'developer']));
  });

  it('uses explicit permissions, not job titles (user-admin can list users but not audit logs)', async () => {
    const ua = await signIn('useradmin@test.local');
    expect((await ua.agent.get('/api/users')).status).toBe(200);
    expect((await ua.agent.get('/api/audit-logs')).status).toBe(403);
  });
});

describe('password reset codes', () => {
  it('lets an authorised admin issue a one-time code that works exactly once', async () => {
    await makeUser('forgetful@test.local', ['employee']);
    const target = await User.findOne({ email: 'forgetful@test.local' });
    const ua = await signIn('useradmin@test.local');
    const issued = await ua.agent
      .post(`/api/users/${target._id}/password-reset-token`)
      .set('X-CSRF-Token', ua.csrf);
    expect(issued.status).toBe(200);
    const { token } = issued.body;

    const anon = request.agent(app);
    const c = await anon.get('/api/auth/csrf');
    const body = { email: 'forgetful@test.local', token, newPassword: 'ResetPass-4242' };
    const first = await anon.post('/api/auth/password-reset/confirm').set('X-CSRF-Token', c.body.csrfToken).send(body);
    expect(first.status).toBe(200);
    const again = await anon.post('/api/auth/password-reset/confirm').set('X-CSRF-Token', c.body.csrfToken).send(body);
    expect(again.status).toBe(400);
    expect((await signIn('forgetful@test.local', 'ResetPass-4242')).res.status).toBe(200);
  });

  it('does not let a non-Founder reset a Founder account', async () => {
    const ua = await signIn('useradmin@test.local');
    const res = await ua.agent
      .post(`/api/users/${ids.founder}/password-reset-token`)
      .set('X-CSRF-Token', ua.csrf);
    expect(res.status).toBe(403);
  });

  it('never stores the reset code or any password in the audit log', async () => {
    const entries = await AuditLog.find({ action: 'user.password_reset_issued' }).lean();
    expect(entries.length).toBeGreaterThan(0);
    const dump = JSON.stringify(await AuditLog.find().lean());
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('ResetPass-4242');
  });
});

describe('audit log', () => {
  it('records sign-ins', async () => {
    expect(await AuditLog.countDocuments({ action: 'auth.login' })).toBeGreaterThan(0);
  });

  it('is append-only', async () => {
    await expect(AuditLog.updateOne({}, { $set: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    const one = await AuditLog.findOne();
    one.summary = 'edited';
    await expect(one.save()).rejects.toThrow(/append-only/);
  });
});
