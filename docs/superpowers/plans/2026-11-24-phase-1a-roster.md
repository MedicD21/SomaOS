# Phase 1a — Shift Patterns, Seats, Roster & Credential Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A department can define its shift pattern (24/48 with Kelly days), the seats each unit must staff, and which credentials each seat requires; generate the regular schedule; see a daily roster with vacancies and staffing vs. minimums; fill seats manually with a hard qualification block (audited override); and members see their own schedule on a phone.

**Architecture:** A new pure package `@soma/schedule-engine` (no DB, no framework) expands patterns into DST-correct shift instances, plans the regular roster, computes credential expiry and seat qualification, and returns explain traces. Postgres stores credentials, seats, standing seat assignments and materialized `shift_assignments` (exclusion constraints stop double-booking); shift patterns are `config_versions` documents (kind `schedule.pattern`), reusing Phase 0 versioning. `apps/web` server code loads data with `withCtxDb` (RLS applies), calls the engine, and writes results. `apps/worker` sends credential expiry warnings.

**Tech Stack:** Existing Phase 0 stack (Next.js App Router, Supabase Postgres + RLS, postgres-js, Zod 4, Vitest, Playwright + axe). New dependency: `temporal-polyfill` (Temporal API for wall-clock ↔ instant conversion across DST; Node 22 has no native Temporal).

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` — §5.9 Time handling, §7.1–7.2 (shift pattern, platoon, staffing model, seat, assignment), §7.3 (pure engine, explain trace), §7.4 Credentials. This is sub-plan **1a** of Phase 1; later sub-plans: 1b leave & accruals, 1c pay codes/OT/timesheets/payroll export, 1d vacancy fill & trades, 1e rule-builder UI, simulation, iCal/CAD export.

## Global Constraints

- All Phase 0 global constraints apply (`docs/superpowers/plans/2026-11-24-phase-0-foundation.md`): strict TS, RLS + isolation test on every tenant table, `timestamptz` UTC, half-open `[from, to)` ranges, no hard deletes of people/config, axe scan on every page test, no service-role key in `apps/web`.
- Shifts are defined in **local wall-clock time**; actual hours come from real instants. A 24-hour shift crossing DST is 23 or 25 actual hours (spec §5.9).
- Timezone for a seat's shifts = its org unit's `timezone`, else the tenant's `timezone`.
- Assignment types (spec §7.2): `regular`, `overtime`, `trade`, `holdover`, `callback`, `acting`, `training`, `detail`, plus `kelly` (a scheduled day off that does not occupy the member).
- A member is qualified for a seat only if each required credential is valid **through the end of the shift**; failing is a **hard block** with an **audited override** (reason required) (spec §7.4).
- Credential validity kinds: N months; fixed cycle end (NREMT EMT/AEMT/Paramedic **Mar 31**, EMR **Sep 30**, 2-year cycle); non-expiring. Warnings at **90/60/30/7** days, configurable per credential type.
- Department pattern for fixtures (owner decision 2026-11-24, until research doc 06 exists): 3-platoon **24/48**, shifts start **07:00** local, **Kelly day every 9th shift**, platoons A/B/C offsets 0/1/2 days.
- No regulatory number is hard-coded in engine logic; Mar 31 / Sep 30 / 90-60-30-7 live in template data.
- Customization is configuration: no department-specific code paths.

## Review Focus

1. **24-hour shift crossing DST** (2026-03-08 and 2026-11-01 in America/Chicago) → 23 h and 25 h respectively; a shift whose local start does not exist (02:30 on spring-forward) starts at the next valid instant (Temporal `disambiguation: 'compatible'`). Tests in Task 1.
2. **Credential expires during the shift** (expires 2026-03-31, shift 2026-03-31 07:00 → 04-01 07:00) → not qualified; expires 2026-04-01 → qualified. Tests in Task 3.
3. **Generating the roster twice, or after a manual change** → no duplicates, cancelled generated rows are not resurrected, manual assignments untouched. Test in Task 8.
4. **Pattern or standing seat changes mid-range** (new approved pattern version from 2026-12-15; member moved to another seat on 2026-12-10; member separated) → each date uses the version/seat effective that day; separated members get nothing after `separated_on`. Tests in Tasks 2 and 8.
5. **Two officers fill the same vacant seat at once** → database rejects the second (`shift_assignments_seat_no_overlap`) and the UI shows "That seat is already filled for that time." Tests in Tasks 6 and 9.

---

## File Structure

```
packages/schedule-engine/            NEW pure package @soma/schedule-engine
  src/time.ts                        PlainDate/time helpers over temporal-polyfill
  src/pattern.ts                     ShiftPattern type, expandPattern, kelly
  src/roster.ts                      planRegularRoster
  src/credentials.ts                 credentialExpiry, checkQualification, dueWarning
  src/explain.ts                     Explain type
  src/index.ts
  tests/{pattern,roster,credentials}.test.ts
packages/validators/src/scheduling.ts  zod: pattern payload, seat, credential type, assignment forms
packages/auth/src/permissions.ts       + scheduling.* and credentials.* permissions
supabase/migrations/20261124000013_credentials.sql   credential_types, member_credentials, app.member_qualifications
supabase/migrations/20261124000014_scheduling.sql    seats, seat_requirements, standing_seats, shift_assignments
packages/db/tests/{credentials,scheduling}.test.ts
packages/templates/src/{types,career-3-platoon,volunteer,roles,apply}.ts   + pattern, credential types, role perms
scripts/seed-dev.ts                  + seats, standing seats, credentials for demo members
apps/web/src/server/scheduling/{load.ts,roster.ts,generate.ts}   server-only services
apps/web/src/app/(app)/roster/{page.tsx,actions.ts,assign-form.tsx}
apps/web/src/app/(app)/schedule/page.tsx
apps/web/src/app/(app)/admin/scheduling/{patterns,seats,credential-types}/{page.tsx,actions.ts,forms.tsx}
apps/web/src/app/(app)/admin/members/[id]/{standing-seat-form.tsx,credentials-section.tsx}
apps/web/src/server/nav.ts           + Schedule, Roster, admin entries
apps/worker/src/jobs/credential-expiry-scan.ts
apps/web/e2e/scheduling.spec.ts
docs/DEVELOPMENT.md                  + Scheduling section
```

---

### Task 1: Engine package, time helpers, pattern expansion

**Files:**
- Create: `packages/schedule-engine/{package.json,tsconfig.json,src/time.ts,src/pattern.ts,src/explain.ts,src/index.ts,tests/pattern.test.ts}` (copy package.json/tsconfig shape from `packages/config-core`)
- Modify: `pnpm-lock.yaml` (add `temporal-polyfill` to this package only)

**Interfaces:**
- Produces:
  - `type IsoDate = string` (`YYYY-MM-DD`); `type Explain = { rule: string; message: string; data?: Record<string, unknown> }`.
  - `type ShiftPattern = { cycle: ('on' | 'off')[]; shiftStart: string /* HH:MM */; shiftHours: number; anchorDate: IsoDate; platoons: Record<string, number> /* shift key → offset days */; kelly?: { everyNthShift: number } }`
  - `type ShiftInstance = { date: IsoDate; start: Date; end: Date; hours: number; index: number /* nth on-shift of this platoon since anchor, 0-based */ }`
  - `expandPattern(p: ShiftPattern, platoon: string, from: IsoDate, toExclusive: IsoDate, tz: string): ShiftInstance[]`
  - `isKellyShift(p: ShiftPattern, index: number, kellyGroup: number | null): boolean` — true when `p.kelly` set, group non-null and `index % everyNthShift === kellyGroup`.
  - `addDays(d: IsoDate, n: number): IsoDate`, `localDateOf(instant: Date, tz: string): IsoDate`, `startOfLocalDay(d: IsoDate, tz: string): Date`.

- [ ] **Step 1: Write failing tests** in `tests/pattern.test.ts` using `p24 = { cycle: ['on','off','off'], shiftStart: '07:00', shiftHours: 24, anchorDate: '2026-01-01', platoons: { a: 0, b: 1, c: 2 }, kelly: { everyNthShift: 9 } }`, tz `America/Chicago`:
  - `expandPattern(p24,'a','2026-01-01','2026-01-10',tz).map(s=>s.date)` equals `['2026-01-01','2026-01-04','2026-01-07']`; `'b'` gives `['2026-01-02','2026-01-05','2026-01-08']`.
  - First A shift: `start.toISOString() === '2026-01-01T13:00:00.000Z'`, `hours === 24`, `index === 0`.
  - A shift on `2026-03-07` (spring-forward night) has `hours === 23`; the A/B/C shift starting `2026-10-31` has `hours === 25` (pick the platoon whose dates hit these; assert via `.find(s => s.date === ...)`).
  - `shiftStart: '02:30'` on `2026-03-08` → `start.toISOString() === '2026-03-08T08:30:00.000Z'` (03:30 CDT).
  - Dates before `anchorDate` work (negative offsets): `expandPattern(p24,'a','2025-12-26','2026-01-01',tz).map(s=>s.date)` equals `['2025-12-26','2025-12-29']` and their `index` values are `-2, -1`.
  - `isKellyShift(p24, 9, 0) === true`, `isKellyShift(p24, 10, 0) === false`, `isKellyShift(p24, 10, 1) === true`, `isKellyShift(p24, 9, null) === false`, `isKellyShift({...p24, kelly: undefined}, 9, 0) === false`.
- [ ] **Step 2:** `pnpm -F @soma/schedule-engine test` → FAIL (module not found).
- [ ] **Step 3: Implement** `time.ts` and `pattern.ts` with `temporal-polyfill`. Start = `PlainDateTime(date, shiftStart).toZonedDateTime(tz, { disambiguation: 'compatible' })`. End = the **wall-clock** `PlainDateTime(date, shiftStart).add({ hours: shiftHours })` converted the same way (not `ZonedDateTime.add`, which adds exact hours and would hide DST). `hours = (end − start) / 3.6e6`. Cycle position for date d = `mod(daysBetween(anchorDate, d) − offset, cycle.length)`; `index` = count of `'on'` positions in full cycles before plus position — use floor division so negatives work.
- [ ] **Step 4:** Tests pass; `pnpm -F @soma/schedule-engine lint typecheck` clean.
- [ ] **Step 5:** Commit `feat(schedule-engine): DST-correct shift pattern expansion with Kelly days`.

### Task 2: Regular roster planning

**Files:** Create `packages/schedule-engine/src/roster.ts`, `tests/roster.test.ts`; export from `index.ts`.

**Interfaces:**
- Consumes: `expandPattern`, `isKellyShift`, `ConfigVersion`/`resolveEffective` from `@soma/config-core` (add workspace dep).
- Produces:
  - `type StandingSeat = { memberId: string; seatId: string; platoon: string; kellyGroup: number | null; effectiveFrom: IsoDate; effectiveTo: IsoDate | null; tz: string }`
  - `type MemberStatus = { memberId: string; separatedOn: IsoDate | null }`
  - `type PlannedAssignment = { memberId: string; seatId: string | null; type: 'regular' | 'kelly'; start: Date; end: Date; date: IsoDate; patternVersion: number; explain: Explain[] }`
  - `planRegularRoster(input: { patterns: ConfigVersion<ShiftPattern>[]; standing: StandingSeat[]; members: MemberStatus[]; from: IsoDate; toExclusive: IsoDate }): PlannedAssignment[]` — sorted by `start`, then `memberId`. Kelly rows have `seatId: null`, `type: 'kelly'`.

- [ ] **Step 1: Write failing tests** (pattern v1 = `p24` effective `[2026-01-01, 2026-12-15)`, v2 = same but `shiftStart: '08:00'` effective `[2026-12-15, null)`; versions' `effectiveFrom` = local midnight of the date in tz):
  - One A-platoon member, standing seat from `2026-01-01`, `kellyGroup: 0`, range `2026-01-01..2026-02-01` → 11 rows; indices 0 and 9 (`2026-01-01`, `2026-01-28`) are `type 'kelly'` with `seatId null`, the other 9 are `regular` in the seat.
  - Range `2026-12-12..2026-12-20` → shifts dated before 12-15 start 07:00, on/after start 08:00; each row's `patternVersion` is 1 or 2 accordingly; `explain[0].rule === 'pattern'` and message names the version.
  - Member with seat S1 `[2026-01-01, 2026-01-10)` and S2 `[2026-01-10, null)` → shifts dated ≥ 01-10 use S2.
  - `separatedOn: '2026-01-05'` → no assignments dated on or after 01-05.
  - Dates with no effective pattern version → no rows (no throw).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `planRegularRoster`: for each standing seat, clip to range/effective/separation, expand each effective pattern version over its sub-range, map instances via `isKellyShift`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(schedule-engine): plan regular roster from standing seats and pattern versions`.

### Task 3: Credential expiry, qualification check, warning due

**Files:** Create `packages/schedule-engine/src/credentials.ts`, `tests/credentials.test.ts`.

**Interfaces:**
- Produces:
  - `type Validity = { kind: 'none' } | { kind: 'months'; months: number } | { kind: 'fixed_cycle'; month: number; day: number; years: number }`
  - `credentialExpiry(v: Validity, issuedOn: IsoDate): IsoDate | null` — `months`: issuedOn + months; `fixed_cycle`: `month/day` of year `year(issuedOn) + years`, plus one more year when issuedOn falls after `month/day` of its own year. Pinned by tests: issued `2026-02-10`, Mar 31, 2 y → `2028-03-31`; issued `2026-05-01` → `2029-03-31`; issued `2026-03-31` → `2028-03-31`.
  - Expiry dates are **inclusive** (valid through that local date).
  - `type SeatRequirement = { anyOf: string[] /* credential type ids */ }[]` (all groups must be met); `type SeatRule = { requirements: SeatRequirement; minRankSort: number | null; actingAllowed: boolean }`
  - `type MemberQual = { rankSort: number | null; credentials: { typeId: string; typeLabel: string; expiresOn: IsoDate | null }[] }`
  - `checkQualification(seat: SeatRule, member: MemberQual, shiftEnd: Date, tz: string): { qualified: boolean; acting: boolean; explain: Explain[] }` — credential valid iff `expiresOn === null` or `shiftEnd <= startOfLocalDay(addDays(expiresOn, 1), tz)`. Rank: lower `sort` = more senior; `rankSort > minRankSort` fails unless `actingAllowed` (then `qualified: true, acting: true`). Null rank with a min rank fails the same way.
  - `dueWarning(expiresOn: IsoDate, today: IsoDate, warnDays: number[], lastWarnedDays: number | null): number | null` — `daysUntil = expiresOn − today`. If `daysUntil < 0`: return `0` unless `lastWarnedDays === 0` (then `null`). Otherwise return the smallest `t` in `warnDays` with `daysUntil ≤ t` and (`lastWarnedDays === null` or `t < lastWarnedDays`), else `null`. (A missed day still warns once at the current threshold; skipped thresholds are not replayed.)

- [ ] **Step 1: Write failing tests**, tz `America/Chicago`:
  - The three `credentialExpiry` fixed-cycle cases above; `{kind:'months',months:24}` from `2026-01-15` → `2028-01-15`; `{kind:'none'}` → `null`.
  - Seat needs `[{anyOf:['pm']}]`; credential `pm` expires `2026-03-31`; shift end `2026-04-01T12:00:00Z` (07:00 CDT) → `qualified false`, explain contains rule `credential.expired_before_shift_end`; expires `2026-04-01` → `qualified true`.
  - anyOf `['emt','pm']` satisfied by either; missing group → rule `credential.missing` naming the group.
  - `minRankSort: 5`, member `rankSort: 7`, `actingAllowed: false` → not qualified (`rank.below_minimum`); `actingAllowed: true` → `qualified true, acting true`.
  - `dueWarning('2026-03-31','2026-01-01',[90,60,30,7],null) === 90`; same with `lastWarnedDays: 90` → `null`; today `2026-03-01` (30 days), last 90 → `30` (skips 60 already passed — returns smallest crossed threshold); today `2026-04-02`, last 7 → `0`; last 0 → `null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(schedule-engine): credential expiry, seat qualification and warning thresholds`.

### Task 4: Validators and permissions

**Files:** Create `packages/validators/src/scheduling.ts` (+ export), `packages/validators/tests/scheduling.test.ts`; modify `packages/auth/src/permissions.ts`.

**Interfaces:**
- Produces permissions (module `scheduling` unless noted):
  - `scheduling.roster.view` "View roster", `scheduling.roster.edit` "Fill and change roster", `scheduling.qualification.override` "Override qualification blocks", `scheduling.config.manage` "Manage shift patterns and seats"; module `credentials`: `credentials.view` "View member credentials" (`sensitive: 'HR'`), `credentials.manage` "Record member credentials" (`sensitive: 'HR'`).
- Produces zod schemas (types via `z.infer`): `shiftPatternSchema` (matches `ShiftPattern`; `cycle` length 1–56 with ≥1 `'on'`; `shiftHours` 1–48; `shiftStart` `/^([01]\d|2[0-3]):[0-5]\d$/`; `kelly.everyNthShift` 2–30; platoon offsets int 0–55), `validitySchema`, `credentialTypeSchema { key, label, validity, warnDays: number[] (each 1–365, default [90,60,30,7]) }`, `seatSchema { orgUnitId, label, sort, required: boolean, minRankId?: uuid, actingAllowed: boolean, requirementGroups: uuid[][] }`, `assignSchema { seatId, memberId, start: iso datetime, end, type: AssignmentType, overrideReason?: string (trim, 5–500) }`, `memberCredentialSchema { memberId, typeId, issuedOn: date, number?: string }`, `standingSeatSchema { memberId, seatId, platoonShiftId, kellyGroup?: int 0–29, effectiveFrom: date }`.

- [ ] **Step 1:** Tests: `shiftPatternSchema` rejects `cycle: ['off']`, `shiftStart: '24:00'`, `shiftHours: 0`; accepts `p24`. `assignSchema` rejects `overrideReason: 'ok'` (too short).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `pnpm -F @soma/validators test` and `pnpm -F @soma/auth test` pass.
- [ ] **Step 5:** Commit `feat: scheduling validators and permissions`.

### Task 5: Credentials schema

**Files:** Create `supabase/migrations/20261124000013_credentials.sql`, `packages/db/tests/credentials.test.ts`; add helpers `createCredentialType(tx, tenantId, key, validity?)` and `addCredential(tx, tenantId, memberId, typeId, expiresOn)` to `packages/db/tests/helpers.ts`.

**Interfaces:**
- Tables (both: `unique (tenant_id, id)`, RLS, audit trigger):
  - `credential_types(id, tenant_id, key text, label text, validity jsonb not null, warn_days int[] not null default '{90,60,30,7}', status text default 'active' check in ('active','archived'), unique(tenant_id,key))` — read: tenant; write: `app.has_permission_dept('scheduling.config.manage')`.
  - `member_credentials(id, tenant_id, member_id, type_id, number text, issued_on date not null, expires_on date /* null = non-expiring; computed by app via credentialExpiry */, last_warned_days int, status text default 'active' check in ('active','revoked'), created_at)`, composite FKs to members/credential_types — read: tenant and (`member_id = app.my_member_id()` or `app.has_permission('credentials.view')`); write: `app.has_permission('credentials.manage')`. Documents use existing `attachments` with `entity = 'member_credential'`.
  - `app.member_qualifications(p_members uuid[]) returns table(member_id uuid, type_id uuid, type_label text, expires_on date)` — security definer, active credentials only, current tenant only, returns empty unless caller `app.has_permission('scheduling.roster.view')`. Lets schedulers check qualification without HR read access.

- [ ] **Step 1: Tests:** `expectTenantIsolation` for both tables; a member without `credentials.view` sees only own `member_credentials`; with it sees all in tenant; insert without `credentials.manage` → RLS error; `member_qualifications` returns rows for a `scheduling.roster.view` holder and zero rows for a caller without it; revoked credential excluded.
- [ ] **Step 2:** `pnpm db:reset && pnpm -F @soma/db test credentials` → FAIL.
- [ ] **Step 3:** Write migration.
- [ ] **Step 4:** Pass, plus `rls-coverage.test.ts` still passes.
- [ ] **Step 5:** Commit `feat(db): credential types and member credentials`.

### Task 6: Seats, standing seats, shift assignments schema

**Files:** Create `supabase/migrations/20261124000014_scheduling.sql`, `packages/db/tests/scheduling.test.ts`; helpers `createSeat(tx, tenantId, orgUnitId, label?)`.

**Interfaces:**
- Tables (all tenant RLS + audit trigger; config tables write = `app.has_permission_dept('scheduling.config.manage')`):
  - `seats(id, tenant_id, org_unit_id, label, sort int, required boolean default true, min_rank_id uuid null, acting_allowed boolean default false, status default 'active' check in ('active','archived'), unique(tenant_id,id))`.
  - `seat_requirements(tenant_id, seat_id, group_no int, credential_type_id, primary key (seat_id, group_no, credential_type_id))` — rows with the same `group_no` are any-of; groups are all-of.
  - `standing_seats(id, tenant_id, member_id, seat_id, platoon_shift_id /* shifts.id */, kelly_group int null check (kelly_group between 0 and 29), effective daterange not null, constraint standing_seats_member_no_overlap exclude using gist (member_id with =, effective with &&))` — write requires `scheduling.config.manage` (dept).
  - `shift_assignments(id, tenant_id, member_id, seat_id null, during tstzrange not null check (not isempty(during)), type text check in (the 9 types), status text default 'scheduled' check in ('scheduled','cancelled'), source text check in ('generated','manual'), pattern_version int null, acting boolean default false, override_reason text null, explain jsonb not null default '[]', created_by uuid default auth.uid(), created_at, cancelled_reason text)`
    - `constraint shift_assignments_member_no_overlap exclude using gist (member_id with =, during with &&) where (status = 'scheduled' and type <> 'kelly')`
    - `constraint shift_assignments_seat_no_overlap exclude using gist (seat_id with =, during with &&) where (status = 'scheduled' and seat_id is not null)`
    - `unique index shift_assignments_generated_key on (member_id, lower(during)) where source = 'generated'` (idempotent generation; includes cancelled rows so they are not resurrected)
    - `check ((type = 'kelly') = (seat_id is null) or type in ('training','detail'))`
    - RLS: read = tenant; insert/update = tenant and `app.has_permission('scheduling.roster.edit')`; and `override_reason is not null` requires `app.has_permission('scheduling.qualification.override')` (put in `with check`). No delete grant (cancel instead).

- [ ] **Step 1: Tests:** isolation for all four tables; overlapping scheduled assignments for one member → error naming `shift_assignments_member_no_overlap`; a `kelly` row overlapping an `overtime` row for the same member is allowed; two members in one seat overlapping → `shift_assignments_seat_no_overlap`; after cancelling the first, the second succeeds; re-inserting a generated row with same member+start → `on conflict do nothing` inserts 0 rows; insert with `override_reason` by a `roster.edit`-only user → RLS error; `standing_seats` overlap rejected.
- [ ] **Step 2:** FAIL → **Step 3:** migration → **Step 4:** `pnpm db:reset && pnpm test:db` passes (incl. RLS coverage).
- [ ] **Step 5:** Commit `feat(db): seats, standing seats and shift assignments with double-booking constraints`.

### Task 7: Templates and dev seed

**Files:** Modify `packages/templates/src/{types.ts,career-3-platoon.ts,volunteer.ts,roles.ts,apply.ts}`, `packages/templates/tests/*`, `scripts/seed-dev.ts`.

**Interfaces:**
- `DepartmentTemplate` gains `credentialTypes: { key; label; validity: Validity; warnDays: number[] }[]` and `schedulePattern: { key: string; payload: ShiftPattern /* platoons keyed by shift key */ } | null`.
- career-3-platoon: pattern key `default`, payload `p24` (Global Constraints values, anchor `2026-01-01`); credential types `emr` (fixed_cycle Sep 30, 2 y), `emt`/`aemt`/`paramedic` (fixed_cycle Mar 31, 2 y), `cpr` (months 24), `driver_operator` (none). volunteer: same credential types, `schedulePattern: null`.
- `applyTemplate` inserts credential types and, if a pattern exists, an **approved** `config_versions` row `kind 'schedule.pattern'`, `key`, `version 1`, `effective [anchor local midnight, null)`.
- Roles: `dept_admin` gets all (already via `ALL_PERMISSIONS`); `scheduler` + `shift_commander` + `company_officer` get `scheduling.roster.view`, `scheduling.roster.edit`; `scheduler` also `scheduling.config.manage`, `scheduling.qualification.override`; `chief_officer` gets roster view/edit/override; `payroll_hr` gets `credentials.view`, `credentials.manage`, `scheduling.roster.view`; `member`, `volunteer`, `probationary` get `scheduling.roster.view`; `training_officer` gets `credentials.view`, `credentials.manage`.
- Seed (Demo Fire Rescue): Station 1 → units Engine 1 (seats Officer [min rank lieutenant, acting allowed, requires emt|paramedic], Driver [driver_operator + emt|paramedic], FF/PM [paramedic]) and Medic 1 (2 seats, paramedic / emt|paramedic); ~9 demo members (3 per platoon) with standing seats, kelly groups 0–2, valid credentials; one member whose paramedic expires in 20 days (exercises warnings and the qualification block).

- [ ] **Step 1:** Template test: applying career-3-platoon creates 6 credential types and one approved `schedule.pattern` version whose payload passes `shiftPatternSchema`; volunteer creates no pattern.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `pnpm -F @soma/templates test` and `pnpm db:reset` succeed.
- [ ] **Step 5:** Commit `feat(templates): scheduling pattern, credential types and roles; seed demo roster`.

### Task 8: Server services — load, generate, assign

**Files:** Create `apps/web/src/server/scheduling/{load.ts,generate.ts,roster.ts}`, `apps/web/tests/scheduling-services.test.ts`, `apps/web/vitest.config.ts` (alias `server-only` to an empty module; `@/` path alias) and a `test:db` script in `apps/web/package.json` (Vitest against the local DB via `@soma/db` test harness, same pattern as `apps/worker`'s `test:db`); add it to root `test:db`; add `@soma/schedule-engine` to web deps; extend `friendlyDbError` in `apps/web/src/server/actions.ts`. Services take `tx` (and a plain `ctx`-like permission checker) as arguments so tests call them inside `withUser`.

**Interfaces:**
- `loadPatterns(tx): Promise<ConfigVersion<ShiftPattern>[]>` (approved `schedule.pattern` versions; platoon keys → shift keys).
- `generateRoster(tx: Tx, from: IsoDate, toExclusive: IsoDate): Promise<{ inserted: number; skipped: number }>` — loads standing seats (with tz from org unit/tenant), members, patterns; calls `planRegularRoster`; inserts `source 'generated'` with `on conflict do nothing`. Max range 120 days (reject longer).
- `loadRoster(tx, date: IsoDate, orgUnitId: string | null): Promise<RosterDay>` where `RosterDay = { units: { orgUnitId; name; path; seats: { seat; assignment: AssignmentView | null; issues: Explain[] }[]; requiredFilled: number; requiredTotal: number }[] }`; `issues` comes from `checkQualification` using `app.member_qualifications` (re-check on every view — lapsed credentials surface on future rosters).
- `assignToSeat(tx, ctx, input: AssignInput): Promise<{ ok: true } | { ok: false; blocked: Explain[] }>` — runs `checkQualification`; if not qualified and no `overrideReason` → `{ ok: false, blocked }`; with reason requires `check(ctx,'scheduling.qualification.override', target)`; stores `explain`, `acting`, `override_reason`.
- `cancelAssignment(tx, id, reason: string)`.
- `friendlyDbError` additions: `shift_assignments_seat_no_overlap` → "That seat is already filled for that time."; `shift_assignments_member_no_overlap` → "That member is already scheduled during that time."; `standing_seats_member_no_overlap` → "That member already has a regular seat for those dates."

- [ ] **Step 1: Tests:** `generateRoster` over the seed for 2026-12-01..12-31 inserts N > 0; running again inserts 0; after cancelling one generated row, a third run inserts 0 and the row stays cancelled; a manual overtime row in a seat is untouched; a range of 121 days throws. `assignToSeat` with the expiring-paramedic member into FF/PM on a shift after expiry → `blocked` contains `credential.expired_before_shift_end`; with `overrideReason` by a dept admin → ok and row has `override_reason`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** pass.
- [ ] **Step 5:** Commit `feat(web): roster generation, loading and qualification-gated assignment`.

### Task 9: Daily roster page

**Files:** Create `apps/web/src/app/(app)/roster/{page.tsx,actions.ts,assign-form.tsx}`; modify `apps/web/src/server/nav.ts` (NAV `{ href: '/roster', label: 'Roster', module: 'scheduling', anyOf: ['scheduling.roster.view'] }`); enable module `scheduling` in both templates' `enabledModules`.

- Behavior: `?date=YYYY-MM-DD` (default today in tenant tz) and optional `?unit=`; prev/next day links; per unit a table of seats → member (with type badge: OT, acting, holdover…), red "Vacant" for empty required seats, amber issue list from `issues`; header shows `requiredFilled/requiredTotal` per unit and station. Users with `scheduling.roster.edit` for that unit/shift (via `check` with seat's org unit path) see "Fill" (member picker + type select) and "Cancel" (reason). A blocked assign shows the explain messages and, if the user holds override, a required reason field to submit again. "Generate schedule" form (from/to) for `scheduling.config.manage`.
- Server actions use `runAdmin`-style pattern (permission → `withCtxDb` → `revalidatePath`).

- [ ] **Step 1:** Playwright `e2e/scheduling.spec.ts` test "roster shows seats, vacancies and staffing": as admin, open `/roster?date=<a seeded A-shift date>`; Engine 1 shows 3 seats, staffing "3/3"; cancel one with reason → seat shows "Vacant" and "2/3"; axe clean.
- [ ] **Step 2:** Test "a second fill of the same seat is rejected": fill vacant seat with member X; a second request (direct action call via second page) for member Y → "That seat is already filled for that time."
- [ ] **Step 3:** Test "unqualified fill is blocked, override needs a reason": choose the expiring paramedic on a post-expiry date → error lists the expired credential; enter reason → saved; audit log shows the reason.
- [ ] **Step 4:** Run `pnpm -F @soma/web e2e -- scheduling` → FAIL; implement; → PASS.
- [ ] **Step 5:** Commit `feat(web): daily roster with vacancies, fills and qualification override`.

### Task 10: My schedule page

**Files:** Create `apps/web/src/app/(app)/schedule/page.tsx`; NAV `{ href: '/schedule', label: 'My schedule', module: 'scheduling' }` (no permission: own data).

- Behavior: month view (`?month=YYYY-MM`) as an accessible table on ≥ md screens and a day list on phones (same data, CSS breakpoints); each scheduled assignment shows local start–end, hours, unit/seat, type; Kelly days labeled "Kelly day"; cancelled hidden. Times rendered in the seat's timezone with the zone abbreviation when it differs from the tenant's.

- [ ] **Step 1:** Playwright test: sign in as a seeded member, open `/schedule?month=2026-12` → shows their A-platoon shifts every third day and one "Kelly day"; at 390×844 viewport the list layout renders; axe clean.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): member schedule month view`.

### Task 11: Admin — patterns, seats, credential types, member standing seat and credentials

**Files:** Create `apps/web/src/app/(app)/admin/scheduling/{patterns,seats,credential-types}/{page.tsx,actions.ts,forms.tsx}`, `apps/web/src/app/(app)/admin/members/[id]/{standing-seat-form.tsx,credentials-section.tsx}`; modify member detail `page.tsx`, `ADMIN_NAV` (Shift patterns, Seats, Credential types under `scheduling.config.manage`).

- Patterns: list versions (status, effective range); form edits a **new draft version** (cycle as on/off toggles, start time, hours, anchor date, platoon → offset per tenant shift, Kelly N); preview shows next 14 days per platoon via `expandPattern` (server-rendered); "Approve effective <date>" (requires `admin.config.manage`) closes the previous approved version's range at that date in the same transaction.
- Seats: per org unit, add/edit/archive seats, required toggle, min rank, acting allowed, requirement groups (each group a multi-select of credential types; "and" between groups).
- Credential types: key, label, validity kind fields, warn days.
- Member page: standing seat (seat, platoon, Kelly group, effective from; ending the current one when a new one starts) and credentials list (type, number, issued, computed expiry via `credentialExpiry`, document upload through existing attachments with `entity 'member_credential'`, `sensitivity 'HR'`) gated by `credentials.view` / `credentials.manage`.

- [ ] **Step 1:** Playwright test "admin configures a seat and a credential, then the roster reflects it": create credential type `hazmat` (months 24); add seat "Hazmat Tech" to Engine 1 requiring `hazmat`; give a member `hazmat` issued today; generate schedule for next 7 days; roster shows Engine 1 staffing `x/4` with the new seat vacant; fill with that member succeeds.
- [ ] **Step 2:** Playwright test "pattern change takes effect from its date": draft v2 with start 08:00, approve effective 7 days out; regenerate; `/schedule` shows 07:00 before and 08:00 after.
- [ ] **Step 3:** FAIL → implement → PASS (all pages axe clean).
- [ ] **Step 4:** Commit `feat(web): admin for shift patterns, seats, credential types and member credentials`.

### Task 12: Credential expiry warnings (worker)

**Files:** Create `apps/worker/src/jobs/credential-expiry-scan.ts`, `apps/worker/tests/credential-expiry-scan.test.ts`; modify `apps/worker/src/index.ts` (handler `'credential-expiry-scan'`), `apps/worker/package.json` (dep `@soma/schedule-engine`).

**Interfaces:**
- `credentialExpiryScan(sql: postgres.Sql, now: Date): Promise<{ warned: number }>` — for each tenant (tenant tz for "today"), each active credential with `expires_on`, `dueWarning(...)`; when non-null: `app.notify(member, 'credential.expiring', title, body, '/admin/members/<id>')` (title e.g. "Paramedic expires in 30 days" / "Paramedic has expired"), set `last_warned_days`. Then enqueues the next scan job `run_after` = next 06:00 UTC. Bootstrap: worker start inserts a pending scan job if none is pending.

- [ ] **Step 1:** Test (DB): credential expiring in 30 days with `last_warned_days 60` → one notification, `last_warned_days = 30`; second run same day → no new notification; next pending `credential-expiry-scan` job exists exactly once.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `pnpm test:db` passes.
- [ ] **Step 5:** Commit `feat(worker): credential expiry warnings`.

### Task 13: Docs and full verification

**Files:** Modify `docs/DEVELOPMENT.md` (Scheduling section: concepts, where pattern versions live, how to regenerate the roster, credential gating and override, DST rule).

- [ ] **Step 1:** Write docs.
- [ ] **Step 2:** `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → all pass.
- [ ] **Step 3:** Commit `docs: scheduling development guide`.

---

## Deferred to later Phase 1 sub-plans (not in 1a)

- Time-of-day minimum staffing windows and department-wide minimums → 1d (needed by vacancy fill).
- Pay codes, work periods, OT, actual time/holdovers, DST pay policy (actual vs scheduled hours) → 1c.
- Leave, trades, vacancy-fill lists, force hire → 1b / 1d.
- iCal feed, CAD roster export, simulation, no-code rule builder → 1e.
