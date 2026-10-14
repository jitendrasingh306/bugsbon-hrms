# Bugsbon HRMS

Employee management, manual daily task assignment, and a development → testing → bug-fix workflow for Bugsbon Software.
**MERN stack, 100% free and open-source, runs entirely on your own Windows PC.**

> **Status: Phase A of F.** Done so far: project setup, MongoDB connection, authentication, role-based access control,
> password change / admin-issued reset codes, audit log, a login-protected React shell.
> Employees, tasks, builds, bugs, notifications etc. arrive in Phases B–F (see the roadmap at the bottom).
> Phase A has **not been executed by its author** (the build environment had no MongoDB/npm) — run the checklist in
> "Verify Phase A" and tell me about any failure.

## 1. Everything you need (all free)

| What | Why | Cost | License |
|---|---|---|---|
| Node.js 20 or 22 LTS | runs backend + builds frontend | Free | MIT |
| MongoDB Community Server 7 or 8 | the database (local) | Free | SSPL (free for your own use) |
| MongoDB Shell (`mongosh`) | only for the optional replica-set step | Free | Apache-2.0 |
| MongoDB Database Tools | `mongodump` / `mongorestore` for backups (later) | Free | Apache-2.0 |
| MongoDB Compass (optional) | GUI to browse the database | Free | SSPL |
| Any browser (Chrome/Edge/Firefox) | use the app | Free | — |
| VS Code (optional) | editing code | Free | MIT |

npm packages — server: `express`, `mongoose`, `express-session`, `connect-mongo`, `bcryptjs`, `helmet`,
`express-rate-limit`, `zod`, `dotenv` (dev: `vitest`, `supertest`). Client: `react`, `react-dom`, `react-router-dom`,
`vite`, `@vitejs/plugin-react`. Root: `concurrently`. All MIT/ISC/Apache licensed, all free.
Later phases add: `multer`, `yauzl` (APK inspection), `node-cron` (deadline reminders).

**Not used / not needed:** paid cloud DB (MongoDB Atlas), hosting, domain, SMTP/email service, SMS gateway, push service, external AI API.

## 2. One-time Windows setup

Use **Command Prompt** (not PowerShell — PowerShell may block `npm` scripts by default).

1. Install Node.js LTS from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`). Check: `node -v`
2. Install MongoDB Community Server from https://www.mongodb.com/try/download/community — choose **"Complete"** and tick
   **"Install MongoD as a Service"**. It then starts automatically with Windows on port 27017.
   (`winget install MongoDB.Server` also works.) Check the service: `net start` should list *MongoDB Server*; if not, run
   `net start MongoDB` in an **Administrator** Command Prompt.
3. (Optional) install MongoDB Compass and `mongosh` from the same MongoDB download site.

## 3. Install and run

```bat
cd bugsbon-hrms
npm run install:all

copy server\.env.example server\.env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Open `server\.env`, paste the printed text after `SESSION_SECRET=`. Leave everything else as is.

```bat
npm run seed
npm run create-admin
npm run dev
```
* `seed` creates permissions, the 5 roles (Founder, Manager, Employee, Developer, Tester), departments and designations. Safe to re-run.
* `create-admin` asks for your name, email and a password (min 10 chars, letters + numbers). There is **no default password** and no public sign-up.
* `dev` starts the API on http://127.0.0.1:5000 and the web app on **http://localhost:5173** — open that and sign in.

## 4. Verify Phase A (please run and report back)

1. `npm run dev` prints `Bugsbon HRMS API listening…` and Vite prints a local URL; no red errors.
2. http://localhost:5173 shows the sign-in page; sign in with the admin you created.
3. Dashboard shows *Database: connected*.
4. **Users & Roles** lists you; **Audit Logs** shows your `auth.login` entry.
5. Wrong password shows "Invalid email or password."; 5 wrong tries locks the account for 15 min.
6. **Change password** works and signs out other browsers.
7. Automated tests (needs the test DB URI in `.env`, default is fine):
   ```bat
   npm test
   ```
   Expect all tests in `server/tests/phaseA.test.js` to pass. **The test run wipes the database named in `MONGODB_URI_TEST`** (`bugsbon_hrms_test`), never your real one.

## 5. Optional: single-node replica set (enables MongoDB transactions, free)

Needed from Phase C onward for all-or-nothing updates (e.g. task status + history + notification). The app works without it
(it logs a warning and runs those steps without rollback), but enabling it is recommended and takes two minutes.

1. Stop the service (Administrator Command Prompt): `net stop MongoDB`
2. Edit `C:\Program Files\MongoDB\Server\<version>\bin\mongod.cfg` (open Notepad as Administrator) and add:
   ```yaml
   replication:
     replSetName: rs0
   ```
3. `net start MongoDB`
4. Run `mongosh`, then:
   ```js
   rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })
   ```
5. In `server\.env` change both URIs to end with `?replicaSet=rs0`, e.g.
   `MONGODB_URI=mongodb://127.0.0.1:27017/bugsbon_hrms?replicaSet=rs0`
6. Restart `npm run dev`. The dashboard's System status should say *Transactions: enabled*.

## 6. Using it from other PCs on your office network (optional)

```bat
npm run build
```
In `server\.env` set `SERVE_CLIENT=true` and `HOST=0.0.0.0`, then `npm start` and open
`http://<your-PC-IP>:5000` from other computers (allow Node.js through Windows Firewall for private networks).
This is plain HTTP on a trusted LAN. Do not expose it to the internet without HTTPS (set `COOKIE_SECURE=true` once you do).

## 7. Phase A design decisions

* **Relational data in MongoDB:** references + Mongoose; multi-document consistency through transactions (replica set) via `withTransaction()`.
* **Auth:** server-side sessions in MongoDB (`httpOnly` cookie, `sameSite=lax`), session id regenerated at login/password change,
  bcrypt (`bcryptjs`, pure JS so no Windows compiler needed), account lockout, rate limits, CSRF synchronizer token,
  Helmet headers, Zod validation, generic error responses (no stack traces to clients).
* **RBAC:** `permissions` and `roles` collections; a role stores its permission keys; users hold one or more roles. Every route is guarded by
  `requirePermission()` on the server; the React UI only hides links as a convenience. Founder = wildcard. Manager scope is enforced per query in later phases using `managedDepartments` and reporting lines.
* **Default `builds.approve`** goes to Founder only (the spec leaves "authorised reviewer" open); grant it to other roles later in Roles management.
* **Password reset without email (free):** an authorised admin issues a one-time code (valid 1 hour, only its hash is stored) and hands it to the user. Only a Founder can reset a Founder.
* **Audit log:** append-only at application level; credential-like keys are redacted before saving. (For stronger protection, a dedicated MongoDB DB user without update/delete rights on `auditlogs` can be added at deployment.)
* **Account lockout message** reveals that an account is locked (usability on a small internal system).

## 8. Roadmap

| Phase | Content |
|---|---|
| A ✅ | Setup, auth, RBAC, audit, React shell |
| B | Employees, departments/designations, employee profile, user + role management |
| C | Manual tasks, assignments, submissions/review, employee & manager dashboards, daily overview |
| D | Projects, APK builds, testers, test results, bugs, retest, approval |
| E | In-app notifications (+deadline reminders), activity timelines, full audit coverage |
| F | Full QA, security review, ER diagram, permission docs, backup/restore guide |

## 9. Free alternatives to normally-paid features

| Normally paid | Free replacement here |
|---|---|
| Cloud database | Local MongoDB Community |
| Email for reset/notifications | Admin-issued reset codes; in-app notifications (SMTP optional, off by default) |
| SMS / push | Not used; in-app notification polling |
| Hosting / domain | Runs on your PC / office LAN |
| File storage (S3) | Private folder on disk, served through authorised download routes |

## 10. Developer – Tester build workflow (added)

Upload APK → assigned tester downloads and tests → Pass/Fail + bug reports → developer uploads a fixed build → retest → **Approved**. Full description, permissions and a 5-step demo: [docs/BUILD_TESTING.md](docs/BUILD_TESTING.md).

New in this version: **Builds**, **Bugs**, **Notifications** (🔔 in the top bar) and **Add/Edit/Deactivate user** on the Users & Roles page.

New optional settings in `server/.env` (defaults are fine): `UPLOAD_DIR=storage`, `MAX_APK_MB=300`, `MAX_IMAGE_MB=5`, `SESSION_AUTO_REMOVE=native`.
After pulling this version run `npm run install:all` once (adds the `multer` package). No database migration is needed — new collections are created automatically.

Run on Windows (Command Prompt): `npm run install:all`, `npm run seed`, `npm run dev`, `npm test`.

Limitations: reopening a *closed* bug after its build was already approved does not change the approved build; APKs are checked for structure (ZIP + AndroidManifest.xml), not scanned for malware; only the tester assigned to a build can record its result (a Manager can reassign the tester).

## 11. Daily time-slot tasks & EOD verification (added)

Managers assign time-bound tasks per person ("11:00–14:00 Calls"); people update status and output notes in **My Day**, submit an end-of-day summary, and managers compare **planned vs actual** and **Approve / Verify** (or return) in **EOD Review**. New roles **Sales** and **HR**; new setting **Reports to** on users. Full description: [docs/DAILY_PLAN.md](docs/DAILY_PLAN.md).

After pulling this version: `npm run seed` once (adds roles/permissions; safe to re-run), restart `npm run dev`, then `npm test`. No other setup, no new packages.

