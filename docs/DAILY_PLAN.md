# Daily Time-Slot Tasks & End-of-Day (EOD) Verification

Works for every role (Sales, HR, Developer, Tester, Employee, Manager, Founder). All free, all local, in-app notifications only.

## Roles and permissions

| Permission | Who has it by default | Allows |
|---|---|---|
| `daily.view_own`, `daily.update_own`, `daily.eod_submit` | every role (Employee, Developer, Tester, **Sales**, **HR**, Manager) | See own schedule, update status + output notes, submit EOD |
| `daily.assign` | Manager, Founder | Create / edit / cancel time-slot tasks for people in scope |
| `daily.view_team` | Manager, Founder | See the team board |
| `daily.eod_review` | Manager, Founder | Verify or return EOD reports |
| `daily.view_all` | Founder (all permissions) | Scope = every user |

New roles **Sales** and **HR** were added. **Scope:** a Manager sees and manages only people whose *Reports to* is that Manager. Set it in **Users & Roles → Add/Edit user → Reports to**. Founder sees everyone.

After updating run `npm run seed` once: it creates the Sales/HR roles and gives the new permissions to the existing system roles (only once; later removals by an admin are respected).

## Flow

1. **Manager → Assign Tasks:** pick one or more people, a date (today or later), add several time slots (`11:00–14:00 Cold calls, target 40 calls`). Overlaps are refused; nothing is created if any person has a conflict. People get an in-app notification.
2. **Employee → My Day:** sees today's slots in time order, presses *Start* / *Mark completed* / *Reopen*, and writes output notes (required to complete). Future days are preview-only.
3. **Employee → End-of-day report:** summary (min 10 chars) + blockers. A snapshot of planned vs actual is frozen at submission; the day becomes locked (no task updates, no new assignments). Reports can be submitted for today and the previous 3 days.
4. **Manager → EOD Review:** sees planned vs actual (tasks and minutes), per-slot output notes, summary and blockers, then **Approve / Verify** (optional 1–5 rating) or **Return for correction** (comment required). A returned report unlocks the day; the employee fixes it and resubmits. Verified is final. Nobody can review their own report.

States: task `pending → in_progress → completed` (+ `cancelled` by manager); EOD `submitted → verified | returned`, `returned → submitted`.

## API (all under `/api/daily`, session + CSRF)

`GET /schedule?date=` · `PATCH /tasks/:id/status` · `GET /assignees` · `POST /tasks` · `PATCH /tasks/:id` · `POST /tasks/:id/cancel` · `GET /team?date=` · `POST /eod` · `GET /eod?scope=mine|team&status=&date=` · `GET /eod/:id` · `POST /eod/:id/verify` · `POST /eod/:id/return` · `GET /summary`

## Audit and notifications

Audit actions: `dailytask.created/updated/cancelled/status_changed/notes_updated`, `eod.submitted/resubmitted/verified/returned`. Notifications: tasks assigned/changed/cancelled → employee; EOD submitted → manager (or Founders if no manager); verified/returned → employee.

"Today" uses `COMPANY_TIMEZONE` (default `Asia/Kolkata`) in `server/.env`.

## Try it

1. Founder: Users & Roles → create a Manager, then a Sales user with *Reports to* = that Manager.
2. Manager (private window): Assign Tasks → select the Sales user → add two slots → Assign.
3. Sales user: My Day → Start, write notes, Mark completed → submit the end-of-day report.
4. Manager: EOD Review → Approve / Verify.
