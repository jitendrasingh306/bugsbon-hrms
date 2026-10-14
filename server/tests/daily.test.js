import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { seedPermissionsAndRoles } from '../src/services/seed.service.js';
import { Role } from '../src/models/Role.js';
import { Permission } from '../src/models/Permission.js';
import { User } from '../src/models/User.js';
import { DailyTask } from '../src/models/DailyTask.js';
import { Notification } from '../src/models/Notification.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { todayKey, addDays } from '../src/utils/dates.js';
import { makeUser, signIn, PASSWORD } from './helpers.js';

let app;
const s = {};
const ids = {};
const today = todayKey();
const tomorrow = addDays(today, 1);

const post = (who, url) => s[who].agent.post(url).set('X-CSRF-Token', s[who].csrf);
const patch = (who, url) => s[who].agent.patch(url).set('X-CSRF-Token', s[who].csrf);
const slots = [
  { title: 'Cold calls', category: 'sales', startTime: '11:00', endTime: '14:00', target: '40 calls' },
  { title: 'Follow-ups', category: 'sales', startTime: '15:00', endTime: '17:00', target: '10 leads' },
];

beforeAll(async () => {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await seedPermissionsAndRoles();
  app = createApp();
  const manager = await makeUser('manager@test.local', ['manager']);
  await makeUser('manager2@test.local', ['manager']);
  await makeUser('sales@test.local', ['sales'], { reportsTo: manager._id });
  await makeUser('hr@test.local', ['hr'], { reportsTo: manager._id });
  await makeUser('dev@test.local', ['developer'], { reportsTo: manager._id });
  await makeUser('tester@test.local', ['tester']);
  await makeUser('founder@test.local', ['founder']);
  for (const e of ['manager', 'manager2', 'sales', 'hr', 'dev', 'tester', 'founder']) {
    s[e] = await signIn(app, `${e}@test.local`);
    ids[e] = String((await User.findOne({ email: `${e}@test.local` }))._id);
  }
});
afterAll(disconnectDb);

describe('roles and permissions', () => {
  it('every staff role (Sales, HR, Developer, Tester) can see its own schedule', async () => {
    for (const who of ['sales', 'hr', 'dev', 'tester']) {
      const r = await s[who].agent.get('/api/daily/schedule');
      expect(r.status).toBe(200);
      expect(r.body.date).toBe(today);
    }
  });

  it('staff cannot assign tasks or see the team board; unauthenticated is rejected', async () => {
    expect((await post('sales', '/api/daily/tasks').send({ assigneeIds: [ids.sales], date: today, tasks: slots })).status).toBe(403);
    expect((await s.sales.agent.get('/api/daily/team')).status).toBe(403);
    expect((await s.sales.agent.get('/api/daily/assignees')).status).toBe(403);
    const anon = await (await import('supertest')).default(app).get('/api/daily/schedule');
    expect(anon.status).toBe(401);
  });

  it('requires a CSRF token on writes', async () => {
    const r = await s.manager.agent.post('/api/daily/tasks').send({ assigneeIds: [ids.sales], date: today, tasks: slots });
    expect(r.status).toBe(403);
  });

  it('seed gives newly introduced permissions to existing roles once', async () => {
    await Permission.deleteOne({ key: 'daily.assign' });
    await Role.updateOne({ key: 'manager' }, { $pull: { permissions: 'daily.assign' } });
    await seedPermissionsAndRoles();
    expect((await Role.findOne({ key: 'manager' })).permissions).toContain('daily.assign');
    await Role.updateOne({ key: 'manager' }, { $pull: { permissions: 'daily.assign' } }); // admin removes it on purpose
    await seedPermissionsAndRoles();
    expect((await Role.findOne({ key: 'manager' })).permissions).not.toContain('daily.assign');
    await Role.updateOne({ key: 'manager' }, { $addToSet: { permissions: 'daily.assign' } });
  });
});

describe('manager assigns time-slot tasks', () => {
  it('lists only people in scope as assignable', async () => {
    const r = await s.manager.agent.get('/api/daily/assignees');
    expect(r.body.items.map((u) => u.email).sort()).toEqual(['dev@test.local', 'hr@test.local', 'sales@test.local']);
    expect((await s.founder.agent.get('/api/daily/assignees')).body.items.length).toBeGreaterThanOrEqual(7);
  });

  it('assigns several slots to several people at once, notifies and audits', async () => {
    const r = await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.sales, ids.hr], date: today, tasks: slots });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: 4, people: 2 });
    expect(await DailyTask.countDocuments({ assignee: ids.sales, date: today })).toBe(2);
    expect(await Notification.countDocuments({ user: ids.sales, type: 'daily.assigned' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'dailytask.created' })).toBe(2);
  });

  it('rejects people outside the manager scope, bad times, overlaps and past dates', async () => {
    expect((await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.tester], date: today, tasks: slots })).status).toBe(404);
    expect((await post('manager2', '/api/daily/tasks').send({ assigneeIds: [ids.sales], date: today, tasks: slots })).status).toBe(404);
    const bad = await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.dev], date: today, tasks: [{ title: 'Backwards', startTime: '14:00', endTime: '11:00' }] });
    expect(bad.status).toBe(400);
    expect((await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.dev], date: today, tasks: [{ title: 'Bad time', startTime: '25:00', endTime: '26:00' }] })).status).toBe(400);
    const selfOverlap = await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.dev], date: today, tasks: [{ title: 'One', startTime: '10:00', endTime: '12:00' }, { title: 'Two', startTime: '11:00', endTime: '13:00' }] });
    expect(selfOverlap.status).toBe(400);
    const conflict = await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.sales], date: today, tasks: [{ title: 'Clash', startTime: '13:00', endTime: '15:30' }] });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('SLOT_CONFLICT');
    expect((await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.dev], date: addDays(today, -1), tasks: slots })).status).toBe(400);
    expect(await DailyTask.countDocuments({ assignee: ids.dev })).toBe(0); // nothing half-created
  });

  it('creates nothing when one of several people has a conflict', async () => {
    const r = await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.dev, ids.sales], date: today, tasks: [{ title: 'Standup', startTime: '11:30', endTime: '12:00' }] });
    expect(r.status).toBe(409);
    expect(await DailyTask.countDocuments({ assignee: ids.dev })).toBe(0);
  });

  it('manager can edit and cancel a pending task; the assignee is notified', async () => {
    const t = await DailyTask.findOne({ assignee: ids.hr, title: 'Follow-ups' });
    const bad = await patch('manager', `/api/daily/tasks/${t._id}`).send({ startTime: '12:00', endTime: '15:30' });
    expect(bad.status).toBe(409);
    const ok = await patch('manager', `/api/daily/tasks/${t._id}`).send({ title: 'Follow-ups (hot leads)', startTime: '15:30', endTime: '17:30' });
    expect(ok.status).toBe(200);
    expect(ok.body.task.minutes).toBe(120);
    expect(await Notification.countDocuments({ user: ids.hr, type: 'daily.updated' })).toBe(1);
    expect((await post('manager', `/api/daily/tasks/${t._id}/cancel`).send({ reason: 'x' })).status).toBe(400);
    expect((await post('manager', `/api/daily/tasks/${t._id}/cancel`).send({ reason: 'Client meeting moved' })).status).toBe(200);
    expect((await post('manager', `/api/daily/tasks/${t._id}/cancel`).send({ reason: 'Again please' })).status).toBe(409);
    const sched = await s.hr.agent.get('/api/daily/schedule');
    expect(sched.body.metrics.plannedCount).toBe(1); // cancelled slots are not part of the plan
    expect((await patch('manager2', `/api/daily/tasks/${t._id}`).send({ title: 'Hacked' })).status).toBe(404);
    expect((await patch('sales', `/api/daily/tasks/${t._id}`).send({ title: 'Hacked' })).status).toBe(403);
  });
});

describe('employee works through today\'s schedule', () => {
  let t1;
  let t2;
  it('sees today\'s slots in time order', async () => {
    const r = await s.sales.agent.get('/api/daily/schedule');
    expect(r.body.tasks.map((t) => t.startTime)).toEqual(['11:00', '15:00']);
    [t1, t2] = r.body.tasks;
    expect(r.body.metrics).toMatchObject({ plannedCount: 2, plannedMinutes: 300, completedCount: 0 });
  });

  it('moves a task through its statuses and enforces output notes', async () => {
    expect((await patch('sales', `/api/daily/tasks/${t1.id}/status`).send({ status: 'in_progress' })).status).toBe(200);
    const noNotes = await patch('sales', `/api/daily/tasks/${t1.id}/status`).send({ status: 'completed' });
    expect(noNotes.status).toBe(400);
    expect(noNotes.body.error.code).toBe('OUTPUT_REQUIRED');
    const done = await patch('sales', `/api/daily/tasks/${t1.id}/status`).send({ status: 'completed', outputNotes: '42 calls made, 6 interested' });
    expect(done.status).toBe(200);
    expect(done.body.task.status).toBe('completed');
    expect(done.body.metrics).toMatchObject({ completedCount: 1, completedMinutes: 180, completionPct: 50 });
    expect((await patch('sales', `/api/daily/tasks/${t1.id}/status`).send({ status: 'pending' })).status).toBe(409);
    expect((await patch('manager', `/api/daily/tasks/${t1.id}`).send({ title: 'Edit done task' })).status).toBe(409);
  });

  it('cannot touch other people\'s tasks or future tasks', async () => {
    expect((await patch('hr', `/api/daily/tasks/${t2.id}/status`).send({ status: 'in_progress' })).status).toBe(404);
    await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.dev], date: tomorrow, tasks: [{ title: 'Tomorrow task', startTime: '10:00', endTime: '11:00' }] });
    const future = await DailyTask.findOne({ assignee: ids.dev, date: tomorrow });
    const r = await patch('dev', `/api/daily/tasks/${future._id}/status`).send({ status: 'in_progress' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('FUTURE_TASK');
  });

  it('records audit entries for status changes', async () => {
    expect(await AuditLog.countDocuments({ action: 'dailytask.status_changed' })).toBeGreaterThanOrEqual(2);
  });
});

describe('end-of-day verification', () => {
  let eodId;
  it('validates and submits the EOD report with a frozen planned-vs-actual snapshot', async () => {
    expect((await post('sales', '/api/daily/eod').send({ summary: 'short' })).status).toBe(400);
    expect((await post('sales', '/api/daily/eod').send({ summary: 'Future report here', date: tomorrow })).status).toBe(400);
    const r = await post('sales', '/api/daily/eod').send({ summary: 'Finished calls, follow-ups still pending.', blockers: 'CRM slow' });
    expect(r.status).toBe(201);
    eodId = r.body.id;
    const manager = await Notification.find({ user: ids.manager, type: 'eod.submitted' });
    expect(manager).toHaveLength(1);
    expect((await post('sales', '/api/daily/eod').send({ summary: 'Submitting twice here' })).status).toBe(409);
    const detail = await s.manager.agent.get(`/api/daily/eod/${eodId}`);
    expect(detail.body.report.snapshot).toMatchObject({ plannedCount: 2, completedCount: 1, pendingCount: 1, completionPct: 50, minutesPct: 60 });
    expect(detail.body.report.actions.verify).toBe(true);
  });

  it('locks the day for the employee and for new assignments after submission', async () => {
    const t = await DailyTask.findOne({ assignee: ids.sales, title: 'Follow-ups' });
    expect((await patch('sales', `/api/daily/tasks/${t._id}/status`).send({ status: 'in_progress' })).body.error.code).toBe('DAY_LOCKED');
    expect((await post('manager', '/api/daily/tasks').send({ assigneeIds: [ids.sales], date: today, tasks: [{ title: 'Late', startTime: '20:00', endTime: '21:00' }] })).body.error.code).toBe('DAY_LOCKED');
    expect((await patch('manager', `/api/daily/tasks/${t._id}`).send({ title: 'Edit after EOD' })).status).toBe(409);
    expect((await s.sales.agent.get('/api/daily/schedule')).body.locked).toBe(true);
  });

  it('only the manager in scope can see and review it; nobody reviews their own', async () => {
    expect((await s.manager2.agent.get(`/api/daily/eod/${eodId}`)).status).toBe(404);
    expect((await post('manager2', `/api/daily/eod/${eodId}/verify`).send({})).status).toBe(404);
    expect((await post('sales', `/api/daily/eod/${eodId}/verify`).send({})).status).toBe(403);
    expect((await s.hr.agent.get(`/api/daily/eod/${eodId}`)).status).toBe(404);
    const team = await s.manager.agent.get('/api/daily/eod?status=submitted');
    expect(team.body.items.map((i) => i.id)).toContain(eodId);
    expect((await s.manager2.agent.get('/api/daily/eod')).body.items).toHaveLength(0);
    const mine = await s.sales.agent.get('/api/daily/eod?scope=team');
    expect(mine.status).toBe(403);
  });

  it('manager approves/verifies with a rating; employee is notified; it is final', async () => {
    expect((await post('manager', `/api/daily/eod/${eodId}/verify`).send({ rating: 9 })).status).toBe(400);
    const v = await post('manager', `/api/daily/eod/${eodId}/verify`).send({ comment: 'Good calls, finish follow-ups tomorrow', rating: 4 });
    expect(v.status).toBe(200);
    expect(v.body.report).toMatchObject({ status: 'verified', rating: 4 });
    expect(v.body.report.reviewer.name).toBe('manager');
    expect(await Notification.countDocuments({ user: ids.sales, type: 'eod.verified' })).toBe(1);
    expect((await post('manager', `/api/daily/eod/${eodId}/verify`).send({})).status).toBe(409);
    expect((await post('manager', `/api/daily/eod/${eodId}/return`).send({ comment: 'Changed my mind' })).status).toBe(409);
    expect((await post('sales', '/api/daily/eod').send({ summary: 'Trying to rewrite a verified day' })).body.error.code).toBe('ALREADY_VERIFIED');
  });

  it('manager can return a report; employee fixes the day and resubmits', async () => {
    const r = await post('hr', '/api/daily/eod').send({ summary: 'Did shortlisting, nothing else.' });
    expect(r.status).toBe(201);
    const id = r.body.id;
    expect((await post('manager', `/api/daily/eod/${id}/return`).send({ comment: 'no' })).status).toBe(400);
    expect((await post('manager', `/api/daily/eod/${id}/return`).send({ comment: 'Please add output notes for the task' })).status).toBe(200);
    expect(await Notification.countDocuments({ user: ids.hr, type: 'eod.returned' })).toBe(1);

    const sched = await s.hr.agent.get('/api/daily/schedule');
    expect(sched.body.locked).toBe(false);
    expect(sched.body.canSubmitEod).toBe(true);
    const task = sched.body.tasks[0];
    expect((await patch('hr', `/api/daily/tasks/${task.id}/status`).send({ status: 'completed', outputNotes: '12 CVs shortlisted' })).status).toBe(200);
    const again = await post('hr', '/api/daily/eod').send({ summary: 'Shortlisted 12 CVs as planned.' });
    expect(again.status).toBe(200);
    const detail = await s.manager.agent.get(`/api/daily/eod/${id}`);
    expect(detail.body.report).toMatchObject({ status: 'submitted', resubmitCount: 1 });
    expect(detail.body.report.snapshot.completedCount).toBe(1);
    expect((await post('manager', `/api/daily/eod/${id}/verify`).send({ rating: 5 })).status).toBe(200);
  });

  it('founder can review anyone; dashboard summary shows pending reviews', async () => {
    await post('dev', '/api/daily/eod').send({ summary: 'No plan today, worked on build fixes.' });
    const sum = await s.manager.agent.get('/api/daily/summary');
    expect(sum.body.team.eodAwaitingReview).toBe(1);
    expect((await s.founder.agent.get('/api/daily/summary')).body.team.eodAwaitingReview).toBe(1);
    expect((await s.sales.agent.get('/api/daily/summary')).body.team).toBeUndefined();
    const list = await s.founder.agent.get('/api/daily/eod?status=submitted');
    expect(list.body.items).toHaveLength(1);
    expect((await post('founder', `/api/daily/eod/${list.body.items[0].id}/verify`).send({})).status).toBe(200);
  });
});

describe('team board, reporting line and audit trail', () => {
  it('shows planned vs actual per person for a day', async () => {
    const r = await s.manager.agent.get(`/api/daily/team?date=${today}`);
    const sales = r.body.people.find((p) => p.name === 'sales');
    expect(sales.metrics).toMatchObject({ plannedCount: 2, completedCount: 1 });
    expect(sales.eod.status).toBe('verified');
    expect(r.body.people.map((p) => p.name)).not.toContain('tester');
  });

  it('users can be given a manager through user administration, with validation', async () => {
    const roles = (await s.founder.agent.get('/api/roles')).body.items;
    const salesRole = roles.find((r) => r.key === 'sales');
    const ok = await post('founder', '/api/users').send({ name: 'New Seller', email: 'new.seller@test.local', roleIds: [salesRole.id], reportsToId: ids.manager });
    expect(ok.status).toBe(201);
    const created = await User.findOne({ email: 'new.seller@test.local' });
    expect(String(created.reportsTo)).toBe(ids.manager);
    expect((await post('founder', '/api/users').send({ name: 'Bad Boss', email: 'bad.boss@test.local', roleIds: [salesRole.id], reportsToId: ids.sales })).status).toBe(400);
    const upd = await patch('founder', `/api/users/${ids.tester}`).send({ reportsToId: ids.manager });
    expect(upd.status).toBe(200);
    expect((await s.manager.agent.get('/api/daily/assignees')).body.items.map((u) => u.email)).toContain('tester@test.local');
    expect((await patch('founder', `/api/users/${ids.tester}`).send({ reportsToId: ids.tester })).status).toBe(400);
  });

  it('writes audit entries for every action and never stores credentials', async () => {
    const actions = (await AuditLog.distinct('action')).filter((a) => a.startsWith('dailytask.') || a.startsWith('eod.'));
    expect(actions).toEqual(expect.arrayContaining(['dailytask.created', 'dailytask.updated', 'dailytask.cancelled', 'dailytask.status_changed', 'eod.submitted', 'eod.resubmitted', 'eod.verified', 'eod.returned']));
    const dump = JSON.stringify(await AuditLog.find().lean());
    expect(dump).not.toContain(PASSWORD);
  });
});
