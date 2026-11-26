# Phase 4b — Training Suite Framework (replaces NinthBrain training scheduling)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The smallest useful slice that lets the department stop scheduling and recording training in NinthBrain: a customizable **course catalog**, scheduled **class sessions** with audience and capacity, **sign-up** and **append-only attendance** that awards hours, **completion that grants or renews member credentials** through the existing credential rules, per-rank **training requirements** (for example annual hours by category) with a **compliance view** (due, overdue) and **reminders**, and optional **training assignments on the roster**.

**Architecture:** Same pattern as leave, trades and assets. Writes go through `security definer` functions in schema `app` that check scope in SQL; tables have no direct write policies. Categories, courses and requirements are tenant config (archive, never delete). A session changes only through status functions (`draft`, `scheduled`, `completed`, `cancelled`). `training_enrollments` hold sign-up state; `training_attendance` is **insert-only** and is the single source of truth for hours (a correction is a new row with `supersedes_id`; the latest row per enrollment wins). Hours earned are a **view over attendance**, never a cached total. Completion is a function, not a trigger: `app.complete_training_session` marks the session done and, for each qualifying attendee, inserts a `member_credentials` row using the expiry the server computed with the existing `credentialExpiry` rule (`packages/schedule-engine/src/credentials.ts`). Compliance is a pure function in `packages/schedule-engine/src/training.ts` (requirements + hours + today to per-member status with an `Explain` list), the same way credential warnings work, so the web view and the reminder job share one rule. Reminders use the existing `jobs` outbox and `app.notify`, with a worker scan modelled on `credential-expiry-scan`.

**Tech Stack:** Existing stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §6 (Phase 2 training row, "feeds scheduling qualifications; ISO/NREMT reporting"), §11 decision 1 (replace NinthBrain; importer plus reconciliation). Research: `docs/research/04-forms-docs-training-sogs.md` §C2 (NCCP buckets), §C4 (ISO FSRS buckets, task books), §C5 (drills, attendance, instructors).

## Global Constraints

- All earlier global constraints apply: strict TS, `tenant_id` on every table, **composite FKs** `(tenant_id, x_id)` to tenant-owned parents, RLS plus a cross-tenant isolation test per table, scope checks in SQL (never only in the web layer), audit trigger on every table, no hard deletes (archive or cancel with a reason), attendance append-only, permissions in the catalog and role templates, nav entries, axe on every page test, 390 px layout with no horizontal overflow.
- **Categories are tenant data, not code.** A category has `key`, `label`, optional `external_code` (free text such as `ISO-company`, `NCCP-national`). No rule in code names ISO or NCCP; the starter pack ships examples as editable data. Hour splits and ISO figures are unverified in research (04 §C2, §C4), so none are hard-coded.
- **Scope = the session's org unit** (department when null). Creating or running a session needs `training.session.manage` at that unit; marking attendance needs `training.attendance.mark` at that unit **or** the caller is the session's assigned instructor. Nobody marks their own attendance unless they hold department-wide `training.attendance.manage`.
- **Hours:** `numeric(5,2)` per attendance row, capped at the session's `duration_hours`. Only `attended` and `partial` award hours; `partial` requires explicit hours and a note.
- **Credential award is idempotent per (session, member)**: one `training_awards` row (unique), written in the same transaction as the credential insert. A renewal inserts a **new** `member_credentials` row and leaves older rows alone (the shape the credentials UI produces today); it never edits an existing row.
- **Roster assignments are optional and use the existing constraints.** `app.schedule_training_assignments` inserts `shift_assignments` of type `training`, `source = 'manual'`, no seat (type `training` already allows that) and **relies on `shift_assignments_member_no_overlap`**: a member with a conflicting scheduled assignment is skipped with a reason, never overridden. Needs department-wide `scheduling.roster.edit` (seatless rows, per `app.can_write_assignment`) plus `training.session.manage`.
- **Required audience** is a set of rules per session (`role`, `rank`, `shift`, `org_unit`, `member`); on publish it is resolved into `training_enrollments` with `source = 'required'`; an explicit "refresh required list" action adds, never removes.
- Out of scope: LMS content, quizzes, video, SCORM/xAPI, external CE accreditation sync (CAPCE/NREMT), offline or QR attendance, task books and competency programs, instructor qualification enforcement, cost tracking, recurring series beyond "repeat weekly N times" copy, mobile app.

## Review Focus

1. Marking attendance without scope, or marking your own, refused by the database. Task 2.
2. Update or delete of `training_attendance` and `training_awards` by any role, including direct SQL as function owner, rejected; a correction supersedes without altering history. Task 2.
3. Completing twice, or re-marking after completion, never awards a credential twice or double-counts hours. Task 3.
4. A renewal never shortens or deletes an existing credential; expiry comes from the same `credentialExpiry` rule as the admin UI. Task 3.
5. Compliance: a member below required hours is due or overdue exactly per the requirement window; hours outside the window, from cancelled sessions, or from `absent`/`excused` rows are not counted; rank-scoped requirements apply only to that rank. Task 4.
6. Roster link: a member with a scheduled assignment in the window is skipped with an explanation and the overlap constraint is not weakened; cancelling the session cancels only its own training assignments. Task 5.
7. A member sees their own enrollments, hours and compliance but not others'; an officer sees only their scope. Tasks 1, 2, 4.

---

## File Structure

```
supabase/migrations/20261124000034_training_catalog.sql       categories, courses, requirements; save/archive functions
supabase/migrations/20261124000035_training_sessions.sql      sessions, audience rules, enrollments, attendance (insert-only), awards; session, attendance, completion functions
supabase/migrations/20261124000036_training_roster_notify.sql schedule_training_assignments, cancel cascade, compliance inputs, reminder log
packages/db/tests/{training-catalog,training-sessions,training-roster}.test.ts
packages/schedule-engine/src/training.ts (+ test)             pure window, hours and compliance rules; exported from index.ts
packages/auth/src/permissions.ts                              + training.course.{view,manage}, training.session.{view,manage}, training.attendance.{mark,manage}, training.compliance.view
packages/templates/src/{roles,training}.ts                    grants and starter categories/courses (+ templates test)
packages/validators/src/training.ts
apps/web/src/server/training/{catalog,sessions,compliance}.ts
apps/web/src/app/(app)/training/{page.tsx,[sessionId]/page.tsx,compliance/page.tsx,actions.ts,forms.tsx}
apps/web/src/app/(app)/admin/training/{courses,categories,requirements}/...
apps/worker/src/jobs/training-reminders.ts (+ test)           modelled on credential-expiry-scan
apps/web/e2e/training.spec.ts
```

Default role grants: Department Admin all; Training Officer `course.manage`, `session.manage`, `attendance.manage`, `compliance.view`; Company Officer `session.view`, `session.manage` and `attendance.mark` at their station, `compliance.view` at their unit; Member and Volunteer `course.view`, `session.view` (sign up, see own hours); Read-only Auditor `view` and `compliance.view`.

---

### Task 1: Catalog and requirements (schema + functions)

**Interfaces — Produces:**
- `training_categories(id, tenant_id, key, label, external_code, archived_at)`; unique `(tenant_id, key)`.
- `training_courses(id, tenant_id, key, label, category_id, default_hours numeric(5,2), credential_type_id nullable, completion_rule jsonb, description, archived_at)`; composite FKs to categories and `credential_types`; `completion_rule` is `{ "minHoursPct": 0-100 }` (default 100); unique `(tenant_id, key)`. Written by `app.save_course(...)` / `app.archive_course(id, reason)` (`training.course.manage`, department-wide).
- `training_requirements(id, tenant_id, label, category_id, rank_id nullable, role_id nullable, required_hours numeric(6,2), window jsonb, effective_from date, effective_to date nullable, archived_at)`; `window` is `{kind:'calendar_year'}`, `{kind:'rolling_months', months}` or `{kind:'fixed_cycle', month, day, years}` (same family as credential validity); null rank/role means everyone. Changes add a new effective-dated row and end the old one in `app.save_requirement`, which refuses overlapping ranges for the same (category, rank, role).
- Read needs `training.course.view`; no direct writes; audited.

- [ ] **Step 1:** Tests first (Review Focus 7): non-manager cannot write; duplicate keys refused; a credential type from another tenant refused by the composite FK; overlapping requirement ranges refused; isolation test per table.
- [ ] **Steps 2–5:** FAIL → migration → `pnpm db:reset && pnpm test:db` PASS → commit `feat(db): training categories, courses and requirements`.

### Task 2: Sessions, sign-up and append-only attendance (schema + functions)

**Interfaces — Produces:**
- `training_sessions(id, tenant_id, course_id, title, starts_at, ends_at, org_unit_id nullable, location_text, instructor_member_id nullable, capacity int nullable, assigned_only boolean, duration_hours numeric(5,2), status, cancelled_reason, notes, created_by, created_at)`; check `ends_at > starts_at`; composite FKs to course, org unit, member. Drafts need `training.session.view` at the unit; published sessions are readable department-wide so members can sign up.
- `training_audience_rules(id, tenant_id, session_id, kind, ref_id uuid)`; `training_enrollments(id, tenant_id, session_id, member_id, source in ('required','signed_up','added'), status in ('enrolled','waitlisted','withdrawn'), created_at)`, unique `(session_id, member_id)`.
- `training_attendance(id, tenant_id, enrollment_id, session_id, member_id, status in ('attended','partial','absent','excused'), hours numeric(5,2) check (hours >= 0), marked_by, marked_at, supersedes_id nullable, note)`; **insert-only** (trigger rejects update/delete; `revoke update, delete`). View `training_attendance_current` (latest row per enrollment) and view `training_hours(member_id, category_id, session_id, credited_on, hours)` over current rows of non-cancelled sessions with status attended or partial.
- Functions: `app.create_session`, `app.publish_session` (resolves audience into enrollments, notifies via `app.notify`), `app.refresh_required`, `app.sign_up(p_session)` (self; waitlists past `capacity`; refused when `assigned_only`), `app.withdraw(p_session)` (self, before start; promotes the first waitlisted member and notifies), `app.add_attendee`, `app.mark_attendance(p_enrollment, p_status, p_hours, p_note)` (scope rules above; refused on cancelled sessions or after `config.training.correction_days`, default 30, unless department-wide manager), `app.cancel_session(p_session, p_reason)` (reason ≥ 5 characters; notifies enrollees).

- [ ] **Step 1:** Tests first (Review Focus 1, 2, 7): officer at station A cannot manage or mark for station B; instructor can mark their own session but not themselves; a plain member cannot mark; capacity waitlists and promotion works; update/delete on attendance raises (also direct SQL as owner); a correction supersedes and `training_hours` shows only the new value; hours above duration refused; cancelled-session hours vanish from the view; audience resolution adds each matching member once; archived course refused for new sessions; isolation per table.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): training sessions, enrollments and append-only attendance`.

### Task 3: Completion awards and renews credentials

**Interfaces — Produces:**
- `training_awards(id, tenant_id, session_id, member_id, credential_id, kind in ('granted','renewed'), awarded_by, awarded_at)`; unique `(session_id, member_id)`; insert-only; composite FKs.
- `app.complete_training_session(p_session, p_awards jsonb)` with `p_awards = [{member_id, issued_on, expires_on}]` computed by the server module from `credentialExpiry(type.validity, issuedOn)` (the web layer never invents expiry). The function verifies each member is `attended`, or `partial` with hours ≥ `minHoursPct` of `duration_hours`, and that the course has a credential type. Needs `training.session.manage` at the unit **and** `credentials.manage`. One transaction: session to `completed`, insert `member_credentials` (active), insert `training_awards`, notify each awardee. Refuses `draft`/`cancelled`; idempotent for members already awarded.
- Attendance corrected after completion never revokes automatically; the session page flags "attendance changed after award" for an officer to handle.

- [ ] **Step 1:** Tests first (Review Focus 3, 4): qualifying attendee gets exactly one credential; second call adds none; below-threshold partial refused; an existing active credential is untouched and the new row carries the later expiry; an officer without `credentials.manage` is refused; a course with no credential type completes with no awards; awards update/delete raises; `app.member_qualifications` sees the new credential.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): training completion awards and renews member credentials`.

### Task 4: Compliance engine, view and reminders

**Interfaces — Produces:**
- `packages/schedule-engine/src/training.ts`: `windowFor(window, today)` → `{start, end}` ISO dates; `trainingCompliance({requirements, hours, members, today, dueSoonDays})` → per member and requirement `{earned, required, remaining, status: 'met'|'on_track'|'due_soon'|'overdue', windowEnd, explain}`. `overdue` = window ended short; `due_soon` = within `dueSoonDays` of window end and short; earlier windows never count in later ones. Pure and unit-tested including leap day, window boundaries, mid-year effective-date change and members with no rank.
- `app.training_compliance_inputs(p_org_unit)` (security definer; `training.compliance.view` at the unit; in-scope members only; members may call it for themselves) returns members with rank and role ids plus hours by category. No cached compliance table.
- Worker `training-reminders` (kind `training-reminder-scan`, daily, self-rescheduling like `credential-expiry-scan`): per member runs the same pure function and sends one `app.notify` per (member, requirement, window, level) with `training_reminder_log(tenant_id, member_id, requirement_id, window_end, level)` unique for idempotency; levels `due_soon`, `overdue`; plus a digest to officers with `compliance.view` listing overdue members in their unit; plus a session reminder 24 hours before start to enrollees.

- [ ] **Step 1:** Unit tests first (Review Focus 5), then DB tests for the inputs scope, then worker tests with a fake clock: rerun sends nothing twice; hours earned after a reminder stop later reminders; cancelled-session hours not counted; officer digest limited to their unit.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat: training compliance engine and reminder scan`.

### Task 5: Roster link

**Interfaces — Produces:** `app.schedule_training_assignments(p_session, p_members uuid[], p_during tstzrange)` returns `{created: uuid[], skipped: [{member_id, reason}]}`; each insert runs in a savepoint so an exclusion violation skips only that member; rows carry `explain [{rule:'training.session', data:{session_id}}]` and link through `training_session_assignments(session_id, assignment_id)` (composite FKs). `cancel_session` and `withdraw` cancel linked rows still `scheduled`, with `cancelled_reason`. Pay and staffing already treat type `training`; no engine change.

- [ ] **Step 1:** Tests first (Review Focus 6): rows are type `training`, no seat, correct range; an overlapping regular shift is skipped with a readable reason and left intact; a kelly day does not block (existing rule); non-roster-editors refused; cancel cascades only linked rows; a closed pay period refuses via the existing lock.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): optional roster assignments for training sessions`.

### Task 6: Permissions, templates, validators

**Files:** `packages/auth/src/permissions.ts`, `packages/templates/src/{roles,training}.ts` (+ test), `packages/validators/src/training.ts`.

- [ ] **Tests first:** every new permission is in the catalog and held only by the intended templates; zod rejects unknown statuses, negative hours, hours over duration, capacity below 1, reason under 5 characters, inverted times, `minHoursPct` outside 0-100, bad window months or days.
- [ ] Starter pack as editable data: categories (Fire, EMS, Hazmat, Driver/Operator, Officer, Safety, Policy/Other), a few example courses and requirements labelled "example, edit for your department". Commit `feat: training permissions, validators and starter pack`.

### Task 7: Web servers and admin pages

**Files:** `apps/web/src/server/training/*.ts`; admin pages for categories, courses, requirements.

Thin server modules: validate with zod, open the request transaction with the caller's RLS context, call the `app.*` function, map known database errors (capacity, scope, late correction, overlap skipped) to plain messages as in leave and trades. The completion action computes expiry with `credentialExpiry` and shows a preview ("these 14 members will receive X, expiring ...") before submitting. Admin pages archive with a reason; a requirement edit creates a new effective-dated row and says so.

- [ ] **Tests (web DB):** error mapping; an officer's session list excludes other stations' drafts; the completion preview matches what the function writes. Commit `feat(web): training servers and admin pages`.

### Task 8: Pages and e2e

**Pages:** `/training` (upcoming sessions with sign-up; *My training* with hours by category and status chips; past attendance), `/training/[sessionId]` (details, roster, attendance marking with *Present for all* then adjust, complete-and-award, *Schedule on roster*, cancel), `/training/compliance` (member by requirement table, filter by unit, rank, status; overdue first; CSV export of visible rows). Nav: `Training` (view permissions), `Compliance` for `compliance.view`. Labels go through terminology overrides.

- [ ] **Playwright:** training officer creates a course linked to a credential type and a session for a rank audience; a required member sees it and gets a notification; another member signs up and the waitlist fills at capacity; the instructor marks attendance and completes, and the credential appears on the member's credentials page with the expected expiry; an N-hour requirement shows the member due, then met; scheduling on the roster skips an already-working member and says why; cancel notifies and clears roster rows; an officer at another station cannot see the draft; axe on all three pages and 390 px without horizontal overflow (tables become stacked cards).
- [ ] Commit `feat(web): training sessions, my training and compliance pages`.

### Task 9: Docs and full verification

- [ ] Add a Training section to `docs/DEVELOPMENT.md` (data model, who can do what, attendance and award rules, adding a category or requirement, how compliance is computed, the NinthBrain import hook). `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → pass. Commit `docs: training`; open a draft PR.

---

## Deferred

- NinthBrain importer (open question 1) and a reconciliation report of imported hours against legacy totals before cutover.
- Competency programs and task books (NFPA 1001/1021/1002 JPR sign-offs, FTO/FTEP daily observation reports, wet-ink print export); instructor qualification checks and evaluations.
- Quizzes, post-tests, evaluations, SCORM/xAPI, content hosting; CAPCE AMS XML export and NREMT NCCP topic-domain tracking; ISO FSRS facility and location metadata rules.
- QR, geofenced and offline attendance (Phase 3 mobile sync); recurring series, room and equipment booking, outside-vendor courses with certificate uploads, cost tracking, consortium-shared classes.
- Policy read-and-sign linkage with Phase 4a documents.

## Open questions for the owner (each with a recommended default)

1. **How should NinthBrain history be brought in?** Default: a one-time CSV import of **completed training records and current credentials only** (member, course name, date, hours, category, credential, expiry) through a preview-and-map screen; unmatched course names become archived catalog entries; no import of future classes (re-enter the few that exist) and no live sync. Needs a sample NinthBrain export; capture its fields and category names in the planned `docs/research/06-current-systems.md` first.
2. **Which hour categories do you report against today?** Default: ship the neutral starter set plus whatever NinthBrain uses, with ISO, state and NCCP tags as free-text `external_code` only; add rule packs after primary-source verification (research 04 flags those figures unverified).
3. **Who can mark attendance?** Default: the session's assigned instructor and officers with scope at the session's unit; nobody marks their own except a department-wide training manager. Confirm whether company officers may mark drills for their own crew without being the listed instructor.
4. **Credential awarded at completion or after officer review?** Default: awarded when the officer clicks complete, after a preview list; later attendance edits flag but never auto-revoke.
5. **May members self sign-up for any published class?** Default: yes (waitlist past capacity), except sessions marked "assigned only"; withdrawal allowed until start.
6. **Should sessions create roster assignments by default?** Default: no, optional per session via *Schedule on roster*, department-scope only, never overriding an existing assignment; on-duty station drills can be recorded without touching the roster.
7. **Attendance correction window.** Default: 30 days (`config.training.correction_days`); department-wide training managers may correct older rows with a reason.
8. **Reminder cadence.** Default: requirement reminders at 30 days before the window ends and when overdue, session reminder 24 hours before, daily officer digest of overdue members; email plus in-app per each member's existing notification preferences.
9. **Do hour requirements prorate for volunteers or part-time?** Default: no proration in this slice; requirements are per rank or role with their own hour values, so a volunteer role simply carries a smaller number.
