# Developer – Tester workflow (Build testing)

Everything runs locally with free tools. APK files are stored in `server/storage/` (private, git-ignored) and are only reachable through permission-checked routes.

## Who can do what

| Role | Can do |
|---|---|
| Developer | Upload APK, choose tester, see own builds and bugs, start a fix, upload a fixed build and tick the bugs it fixes, comment, withdraw an untested build |
| Tester | See builds assigned to them, download the APK, start testing, report bugs with screenshots, verify / reopen / close bugs, record **Pass** or **Fail** |
| Manager | See all builds and bugs, change the tester, verify/close/reopen bugs |
| Founder | Everything, plus user creation |
| Employee | No access to builds or bugs |

Rules enforced on the server: a developer cannot test their own build; only the assigned tester can record results or report bugs; a developer cannot close or reopen a bug assigned to them; the tester must download the APK before recording a result or a bug.

## The flow

1. **Developer** uploads an APK (Builds → Upload build): project, app, version, notes, tester. The server checks that the file is really an APK (a ZIP containing `AndroidManifest.xml`), stores it under a random name and records its SHA-256. Status: *Waiting for test*. The tester gets an in-app notification.
2. **Tester** opens the build and downloads the APK. The first download by the assigned tester starts testing (*In testing*) and notifies the developer.
3. **Tester** reports bugs (title, severity, steps, expected/actual, up to 3 screenshots) and finally records the result:
   * **Fail** (reason required, min. 10 characters) → build becomes *Failed*, developer is notified.
   * **Pass** is only allowed when **every bug in the build chain is closed** → build becomes **Approved** automatically; developer and managers are notified.
4. **Developer** fixes the bugs and uses *Upload fixed build* on the failed build, ticking the bugs it fixes. This creates a **new build** (iteration + 1), marks the old one *Superseded* and moves ticked bugs to *Ready for retest*. An APK identical to an earlier upload is rejected.
5. **Tester** retests: *Verified – close bug* or *Reopen* (reason required). Repeat from step 3 until the Pass succeeds.

## Status maps

Build: `pending_test → in_testing → failed | approved`, `failed → superseded`, `pending_test → withdrawn`.
Bug: `open → in_progress → ready_for_retest → closed | reopened`, `reopened → in_progress/ready_for_retest`, `closed → reopened`.

## API summary

`GET /api/builds`, `/summary`, `/testers`, `/:id`, `/:id/download` · `POST /api/builds` (multipart: `apk`, `versionName`, …) · `POST /api/builds/:id/start-test | test-result | assign-tester | withdraw | bugs` · `GET /api/bugs`, `/:id`, `/:id/attachments/:name` · `POST /api/bugs/:id/start-fix | comments | close | reopen` · `GET/POST /api/notifications…` · `POST /api/users`, `PATCH /api/users/:id`.

## Try it with three accounts

1. Sign in as Founder → **Users & Roles → Add user**. Create one Developer and one Tester (each gets a one-time temporary password and must change it at first sign-in).
2. Sign in as the Developer (private window) → **Builds → Upload build**.
3. Sign in as the Tester in another browser → the dashboard shows the build; download, report a bug, **Fail**.
4. As Developer: open the failed build → **Upload fixed build** (a rebuilt APK).
5. As Tester: download, close the bug, **Pass** → build is **Approved**.
