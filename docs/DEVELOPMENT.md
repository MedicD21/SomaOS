# SomaOS — Development Guide

## Prerequisites
- Node 22 (`.nvmrc`), pnpm 10
- Docker (for the local Supabase stack)

## First run
```bash
pnpm install
pnpm db:start        # local Supabase: Postgres, Auth, Storage, Mailpit
pnpm db:reset        # apply migrations + seed "Demo Fire Rescue"
pnpm env:local       # write apps/web/.env.local and apps/worker/.env.local
pnpm -F @soma/web dev     # http://localhost:3000
pnpm -F @soma/worker start   # background jobs (email, invites)
```

Dev logins (local only):

| Email | Password | Notes |
|---|---|---|
| admin@soma.local | somadev123! | Department admin — enrolls TOTP MFA on first sign-in |
| member@soma.local | somadev123! | Plain member |

Local email: Mailpit at http://127.0.0.1:54324.

## Tests
| Command | What |
|---|---|
| `pnpm test:unit` | Pure package tests (no DB) |
| `pnpm test:db` | Database tests: RLS isolation, triggers, functions; worker jobs (needs `pnpm db:start`) |
| `pnpm -F @soma/web e2e` | Playwright end-to-end (resets + seeds the DB, builds and starts the app) |
| `pnpm lint` / `pnpm typecheck` | Static checks |

## How data access works
- **Supabase PostgREST is disabled** (`supabase/config.toml` → `[api] schemas = []`). Browsers never query tables directly.
- The web server verifies the Supabase session, then runs SQL with `withUserDb` / `withCtxDb`: a transaction that sets
  `role authenticated` and the user's JWT claims. **Row-level security applies to every query.**
- The JWT carries `tenant_id` (the active department), added by `public.custom_access_token_hook` only when the user
  has an *active* membership.
- App-level permission checks (`requirePermission`, `check`) run first; RLS is the backstop. Writes to admin tables also
  require the matching `admin.*` permission inside RLS (`app.has_permission`).
- Only `apps/worker` and test harnesses use the service role.
- The tenant claim counts only while the user has an **active** membership in an **active** department
  (`app.tenant_id()` re-checks on every statement), so suspending a member cuts access immediately.
- Database-side admin checks require **department-wide** grants (`app.has_permission_dept`), and nobody can grant a
  permission they do not hold themselves.
- Accounts are **invite-only** (`enable_signup = false`). An invitation is accepted explicitly by the owner of the
  verified invited email on `/invites` (`app.accept_invite`); nothing is linked automatically.
- **Production:** `SOMA_DB_URL` (web) must be a login role that is a member of `authenticated`, not a superuser, and a
  direct/session connection (postgres-js prepares statements; the transaction pooler on port 6543 needs `prepare: false`).
  The worker needs a privileged role (it reads `auth.users` and processes `jobs`).

## Adding a tenant-owned table (checklist)
1. Migration in `supabase/migrations/<timestamp>_<name>.sql`:
   - `tenant_id uuid not null references public.tenants(id) on delete cascade`
   - Composite FKs `(tenant_id, x_id) references x(tenant_id, id)` for every reference to another tenant table
   - `alter table ... enable row level security;`
   - `tenant_read` policy (`tenant_id = app.tenant_id()`) and a `tenant_write` policy that also checks the permission
   - `create trigger audit after insert or update or delete on public.<t> for each row execute function app.audit_trigger();`
2. Add any new permission to `packages/auth/src/permissions.ts`.
3. DB test in `packages/db/tests/` with an isolation test (`expectTenantIsolation`) and permission tests.
4. `rls-coverage.test.ts` fails if RLS or a tenant policy is missing.

## Configuration rules
- Effective-dated data uses half-open ranges `[from, to)`.
- Rule sets (pay, accruals, etc.) live in `config_versions` (versioned, effective-dated, approved versions immutable).
- Never hard-code regulatory numbers — store them as config/data.
- Customization is configuration, never per-department code.

## Scheduling (Phase 1a)

Design: `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §5.9, §7. Plan:
`docs/superpowers/plans/2026-11-24-phase-1a-roster.md`.

### Concepts
- **Shift pattern** — a `config_versions` document (kind `schedule.pattern`), so it is versioned, effective-dated and
  approved like any other config. Payload (`ShiftPattern` in `@soma/schedule-engine`): `cycle` of `on`/`off` days,
  `shiftStart` (local `HH:MM`), `shiftHours`, `anchorDate`, `platoons` (shift key → day offset) and optional
  `kelly: { everyNthShift }`. Edit under **Admin → Scheduling → Patterns**: save a draft, then approve it with the date
  it takes effect.
- **Seat** — a position a unit must staff, with required credentials (`anyOf` groups) and a minimum rank. Defined under
  **Admin → Scheduling → Seats**.
- **Standing seat** — a member's regular seat, platoon and Kelly group, effective-dated. Setting a new one ends the
  current one. Set on the member's admin page.
- **Shift assignment** — one materialized shift on one seat. Exclusion constraints stop double-booking a person or a
  seat (`shift_assignments_seat_no_overlap`).
- **Credential type / member credential** — validity is N months, a fixed cycle end (NREMT EMT/AEMT/Paramedic **Mar 31**,
  EMR **Sep 30**) or never expires. The numbers live in template data, not engine code.

### Engine
`packages/schedule-engine` is pure (no DB, no framework): `expandPattern`, `planRegularRoster`, `credentialExpiry`,
`checkQualification`, `dueWarning`. Results carry `Explain` traces (rule + message) so the UI can say *why*. The web
server loads data with `withCtxDb` (RLS applies), calls the engine and writes results.

### Regenerating the roster
- **Roster** page → **Generate schedule** (needs `scheduling.config.manage`) creates regular and Kelly assignments from
  standing seats, at most 120 days at a time.
- Generation is idempotent: existing rows, including generated rows an officer cancelled, are not recreated or
  resurrected, and manual assignments are untouched.
- Approving a new pattern version supersedes future generated, still-scheduled shifts from its effective date
  (`supersedeGenerated`); generate again to recreate them from the new version. Separated members get nothing after
  their `separated_on` date.

### Credential gating and override
A member is qualified for a seat only if every required credential is valid **through the end of the shift**, not just
today (credential expiring 2026-03-31 does not cover a shift ending 2026-04-01 07:00). Filling an unqualified member is
a **hard block**. Someone holding `scheduling.qualification.override` for that unit may fill anyway by entering a reason
(at least 5 characters); the reason is stored on the assignment and audited.

### Expiry warnings
`apps/worker` runs `credential-expiry-scan` daily at 06:00 UTC. Warnings go out at 90/60/30/7 days (configurable per
credential type) and when a credential has expired, via `app.notify`; `last_warned_days` prevents repeats. The worker
inserts the first scan job on start if none is pending.

### Time and DST
Shifts are defined in local wall-clock time; the time zone is the seat's org unit's `timezone`, else the department's.
Actual hours come from real instants, so a 24-hour shift is 23 h across spring-forward and 25 h across fall-back. A local
start time that does not exist (02:30 on spring-forward) starts at the next valid instant.

## Leave and accruals (Phase 1b)

Design: master design §7.2. Plan: `docs/superpowers/plans/2026-11-24-phase-1b-leave.md`.

### Concepts
- **Leave bank** — a balance members draw from (Vacation, Sick, Compensatory time…). **Leave type** — what a member
  requests (Vacation, FMLA…). A type draws from one bank, or from none (balance-free types such as FMLA are only logged).
  Both are managed under **Admin → Leave**.
- **Ledger** — a bank's balance is the sum of `leave_ledger` rows (`earn`, `use`, `reversal`, `adjust`, `expire`,
  `payout`; signed hours). The ledger is **append-only**: no API role can update, delete or truncate it. Mistakes are
  fixed with a new `adjust` or `reversal` row. Automated postings carry a `run_key` (unique per member and bank), which is
  what makes accrual runs idempotent.
- **Accrual policy** — one `config_versions` document per bank (kind `leave.accrual`, key = bank key), versioned and
  effective-dated like shift patterns: save a draft, preview it, approve it from a date.
- **Request** — a date range. Hours debited are the **scheduled wall-clock hours** of the member's scheduled, non-Kelly
  shifts whose local start date falls in the range (a 24-hour shift counts 24 even across a daylight-saving change).
  No scheduled shifts in the range means no request.

### Writing leave: only through database functions
Requests and the ledger have no direct write access. `app.request_leave`, `app.decide_leave`, `app.cancel_leave` and
`app.adjust_leave` run as the database owner and check the caller **in SQL**:

| Function | Who | Rules |
|---|---|---|
| `request_leave` | a member, for themselves (`leave.request`) | lead time; enough balance after other pending requests unless the approved policy has `negativeAllowed` |
| `decide_leave` | someone with `leave.approve` whose grant covers the member | covers = department scope, or an org-unit subtree containing the member's station, and the grant's shift (if any) matches the member's shift. The member's place is their primary assignment, else their standing seat. **Nobody decides their own leave.** Balance is re-checked at approval. |
| `cancel_leave` | the member (before it starts) or an approver | approved leave is reversed once and its shifts restored; if a seat was refilled meanwhile it fails and nothing changes |
| `adjust_leave` | department-wide `leave.manage` | needs a note of at least 5 characters |

Approving cancels the member's scheduled shifts in the range (`cancelled_reason = 'Leave: <type>'`, linked by
`leave_request_id`), so the roster shows the vacancy; cancelling the leave puts them back.

### Accrual policy reference
Edit as JSON under **Admin → Leave → Accrual policies** (a guided editor comes in Phase 1e). Example:

```json
{
  "period": { "kind": "monthly" },
  "tiers": [
    { "fromYears": 0, "earn": { "method": "per_period", "hours": 10 } },
    { "fromYears": 5, "earn": { "method": "per_period", "hours": 14 } }
  ],
  "cap": 200,
  "waitingPeriodDays": 0,
  "prorateFirstPeriod": true,
  "fractionByEmploymentType": { "career_part_time": 0.5 },
  "negativeAllowed": false,
  "carryover": { "max": 40, "resetOn": "01-01" }
}
```

| Field | Meaning |
|---|---|
| `period` | `monthly`, or `{ "kind": "fixed_days", "days": 14, "anchor": "2026-01-02" }` for pay-period-style blocks |
| `tiers` | by whole years of service on the last day of the period; the first tier starts at 0 and years must increase |
| `earn.method` | `per_period` (`hours`), `per_hours_worked` (`perHours`, `earnHours`), `annual_front_load` (`hours`, credited in the period containing Jan 1), or `manual` (never accrues automatically — used for comp time) |
| `cap` | maximum balance; earning stops there (`null` = none). For comp time, 480 h is the usual public-safety ceiling but it is policy data |
| `waitingPeriodDays` | nothing accrues until hire date + N days |
| `prorateFirstPeriod` | scale `per_period` in the hire month by days employed |
| `fractionByEmploymentType` | e.g. part-time earns half |
| `negativeAllowed` | whether a request may take the balance below zero |
| `carryover` | on `resetOn` (MM-DD) hours above `max` expire (`max: null` = carry everything) |

Use **Preview** to see what a sample member would earn, with the reasons, before saving. **Starter values from the
department template are placeholders**: they are created as drafts and nothing accrues until an administrator edits and
approves them. Approving needs `leave.manage` and `admin.config.manage`. A policy may be approved from a past date: the
worker then catches up every completed period since then (up to two years back).

### Worker
`leave-accrual` runs daily at 06:00 UTC (and is queued when the worker starts). For each approved policy version it posts
the completed, unposted periods for each active member and applies carryover at each reset date, using the department's
local date. It uses the version that was effective for each period, skips separated members, and one failing member does
not stop the others (failures are reported when the run ends).

### Running the tests
Run `pnpm db:reset` before `pnpm test:db` if you have just run the end-to-end suite: the end-to-end tests generate rosters
in the demo department, and a few database tests expect a freshly seeded database. CI uses a separate database per job.

## Onboarding a new member
1. An admin adds the member (with an email) and clicks **Send sign-in invitation** on their page. This queues an
   `invite-member` job and an invitation record; nothing is linked to any account yet.
2. The worker emails the invitee. A **new** email gets Supabase's invitation link; an email that already has an account
   gets a notice to sign in and accept at `/invites`.
3. The invitation link opens `/auth/welcome`. The link delivers one-time tokens in the URL **fragment**, which only the
   browser can read. The app's client uses PKCE, which refuses fragment callbacks, so the page sets the session explicitly
   with `setSession` and removes the tokens from the address bar and history.
4. The invitee chooses a password (at least 12 characters; Supabase enforces the same minimum,
   `minimum_password_length` in `supabase/config.toml`), then accepts the invitation at `/invites`.

Local email (including these links) is in Mailpit at http://127.0.0.1:54324.

## Pay (Phase 1c-1)

Design: master design §7.2–7.3. Plan: `docs/superpowers/plans/2026-11-24-phase-1c-pay-engine.md`.

**What it is:** hours and dollars by pay code for a pay period, calculated from **scheduled shifts, recorded time
entries and approved leave**. It is a calculation until payroll **closes** the period (see *Time and payroll close*).

### Concepts
- **Pay code** — a named kind of pay (Regular, Overtime, Holdover, a leave type…), with a multiplier and an optional
  **export code** for your payroll system. Leave pay codes use the **leave type's key** as their key; a multiplier of 0
  means unpaid. Managed under **Admin → Pay**.
- **Employee group** — members who share one set of pay rules. Members with no group use the group keyed `default`.
- **Hourly rate** — effective-dated per member. Setting a new rate from a date ends the previous one the day before.
  Rates are visible only to department-wide `pay.view` / `pay.manage` holders (not even to the member).
- **Pay rules** — one versioned document per group (`config_versions`, kind `pay.rules`, key = group key): draft →
  approve from a date, like shift patterns and leave policies. Approving needs `pay.manage` and `admin.config.manage`.
  Rules in force on the **first day of the pay period** apply to the whole period.

### How a period is calculated (`computePay` in `@soma/schedule-engine`)
1. Shifts and counted leave are processed in date order within each **work period** (a block of N days aligned to an
   anchor; it can be longer than the pay period).
2. Hours worked above the work period's `threshold` are **federal overtime** at its `multiplier`. A shift that crosses the
   threshold is split exactly (e.g. 20 h regular + 4 h overtime).
3. Each shift type maps to a pay code and multiplier (`assignments`). For an hour that is both contract overtime and
   above the threshold, `overtimeCombination` decides: `highest` (the larger multiplier applies once) or `stack`
   (premiums add: 1.5 + 0.5 = 2.0).
4. Leave counts toward the threshold only if its leave type has *counts as time worked*; it is always paid straight under
   its own code.
5. A callback shorter than `minimumHours` is topped up; the top-up is paid but is not time worked.
6. `compTime`: with `always`, or `member_choice` when the member prefers it, overtime lines earn comp credit
   (hours × `compTime.multiplier`) and **no cash**. A member's preference is the custom field `prefers_comp_time`
   (yes/no) on their member record — create it under **Admin → Custom fields**. Comp credit is shown and exported, and
   is posted to the leave ledger when the period is closed.
7. Each line's dollars are rounded to cents; a member with no rate gets blank amounts, not zero.

```json
{
  "payPeriod": { "kind": "fixed_days", "days": 14, "anchor": "2026-01-01" },
  "workPeriod": { "days": 28, "anchor": "2026-01-01", "threshold": 212, "multiplier": 1.5, "code": "ot" },
  "overtimeCombination": "highest",
  "assignments": {
    "regular":  { "code": "reg",  "multiplier": 1 },
    "overtime": { "code": "ot",   "multiplier": 1.5 },
    "trade":    { "code": "reg",  "multiplier": 1 },
    "holdover": { "code": "hold", "multiplier": 1.5 },
    "callback": { "code": "call", "multiplier": 1.5, "minimumHours": 2 },
    "acting":   { "code": "act",  "multiplier": 1 },
    "training": { "code": "reg",  "multiplier": 1 },
    "detail":   { "code": "reg",  "multiplier": 1, "countsTowardFlsa": false }
  },
  "compTime": { "mode": "never", "multiplier": 1.5, "bankKey": "comp_time" }
}
```
**Every number above is a starter value**, including the 28-day / 212 h work period: verify them against your own work
period election and agreement. Starter rules are created as drafts; nothing is calculated until you approve them.

### Pages
- **Pay → period** (`/pay`, `?start=YYYY-MM-DD`): per-member totals; *Show lines* lists every line with the reason for
  each number. Members without approved rules are reported, never guessed.
- **CSV** (`/pay/export`): one row per member and pay code with export codes and cents, plus a comp-credit row.
  Free text that starts with `=`, `+`, `-` or `@` is prefixed with `'` so spreadsheets do not run it as a formula.
- To see results, a viewer needs department-wide `pay.view` (or `pay.manage`) **and** the ability to read shifts and
  leave (`scheduling.roster.view`, `leave.view`); the Payroll / HR role has all of these.

### Not yet
Whole-timesheet officer sign-off before close, per-payroll-system file formats, salaried members, regular-rate adjustments for non-discretionary pay, and rates or rules that change in the
middle of a pay period (they take effect at the start of the next one).

## Time and payroll close (Phase 1c-2)

Plan: `docs/superpowers/plans/2026-11-24-phase-1c2-time-and-close.md`.

### Recording time (`/time`)
- A **time entry** is hours worked that differ from the schedule (a holdover, a callback, extra hours): member, date,
  hours (0–48), a work type (the same eight as the pay rules) and a reason. It is added to the pay period as extra work,
  so it counts toward the work-period threshold and is paid by the group's `assignments` rule for that type.
- Who may record it is decided **in the database** (`app.can_edit_time`): an officer with `scheduling.roster.edit` whose
  grant covers the member's station (primary assignment, else standing seat) and, if the grant is limited to a shift,
  the member's shift; or department-wide `pay.manage` (payroll). **Nobody records time for themselves.** The page lists
  only the members the caller covers.
- Entries are never edited or deleted. A mistake is **voided** with a reason (who/when/why kept) and recorded again.
- Writes only go through `app.add_time_entry` / `app.void_time_entry`; the table has no direct insert/update/delete.

### Closing a pay period (`/pay`)
- **Close** (department-wide `pay.manage`) recalculates the period, **refuses if any member could not be calculated**
  (for example no approved rules — nothing is guessed), then in one database call stores the frozen result
  (`pay_period_closes.snapshot`), credits comp time to each member's bank (`earn` ledger rows, `run_key comp:<close id>`,
  dated the period's last day) and locks the dates.
- A **closed period is read from its snapshot**: later changes to rates, pay rules or the roster do not change it, and the
  CSV export carries the frozen numbers. Time entries dated in a closed period cannot be added or voided
  (`That pay period is closed`).
- **Reopen** needs a reason (5+ characters). It posts a matching `reversal` for the comp credit (once), unlocks the dates,
  and the page is live again; closing again posts fresh credit. Every close and reopen is audited.
- Closing is exact-period: the close covers the pay period shown (its start is the period start). Overlapping closed
  periods are refused.

### Tests
`pnpm -F @soma/db test` (`pay-close`, `time-entries`), `pnpm -F @soma/web test:db` (loader with entries and snapshots),
`pnpm -F @soma/web e2e e2e/time-close.spec.ts`.

### Not yet
Early-relief (negative) adjustments, whole-timesheet officer sign-off, per-payroll-system formats, mid-period rate or rule
changes.

## Shift trades (Phase 1d-1)

Plan: `docs/superpowers/plans/2026-11-24-phase-1d-trades.md`. Page: `/trades`.

- **Flow:** a member with `scheduling.trade.request` proposes swapping one of their upcoming shifts with another
  member's → the other member accepts or declines → an officer with `scheduling.roster.edit` at **both** stations
  approves or denies (never a party to the trade) → on approval the two shifts change hands in one database step.
- **Rules (all enforced in SQL, `app.request_trade` / `respond_trade` / `cancel_trade` / `decide_trade`):** both shifts must
  be upcoming, scheduled, seated and not Kelly days; an assignment is in at most one open trade; either party can withdraw
  until it is decided; if a shift changes before approval the approval is refused. Writes to `shift_trades` only go through
  these functions.
- **Conflicts:** the swap relies on the roster's overlap constraints, so a trade that would double-book a member or a
  seat is refused and nothing moves. Same-time swaps (trading stations) work because the first shift is freed during
  the swap.
- **Qualification:** the web layer re-checks credentials and rank for each member in the other's seat with the same
  engine as manual fills (`tradeBlocks`). A block can be waived with a reason only by someone holding
  `scheduling.qualification.override` at both stations; the database re-checks that and records the reason on the
  assignments and the trade.
- **Afterwards:** swapped shifts become type `trade` (paid by the pay rules' `trade` mapping) with a line in their
  explain trail; both members are notified at each step.
- **Known limit:** the "Their shift" list shows the next 60 days of other members' shifts, capped at 2000 rows (a 150-member department can exceed that); a picker that filters by member or date is the follow-up.
- **Not yet:** hours-owed/payback trades, one-way give-aways and open vacancy fill with call-back lists (1d-2), leave
  limits per shift or station (1d-3), per-member trade limits.
- **Existing departments:** the new permission is in the starter roles; a department created earlier must add
  `scheduling.trade.request` to its member roles (Admin → Roles).

## Open shifts (Phase 1d-2)

Plan: `docs/superpowers/plans/2026-11-25-phase-1d2-open-shifts.md`. Page: `/open-shifts`.

- **Flow:** an officer with `scheduling.roster.edit` at a seat's unit posts an unfilled seat and time (regular or overtime, with a
  reason, at most 48 h, in the future) → members with `scheduling.openshift.claim` claim it → an officer at that unit approves one
  claim → the assignment is created and the other pending claims are superseded (everyone is notified).
- **Rules (SQL: `post_open_shift`, `cancel_open_shift`, `claim_open_shift`, `withdraw_claim`, `decide_claim`):** the seat must not already be
  filled or posted for that time; a claim is refused if it overlaps the member's own scheduled shift; one pending claim per member per
  open shift; nobody decides their own claim; cancelling withdraws pending claims. Tables have no direct writes.
- **Conflicts on approval:** the assignment is inserted inside `decide_claim`, so the roster's overlap constraints refuse a double-booked
  member or an already-filled seat, and nothing changes.
- **Qualification:** the web layer checks the claimant against the seat with the same engine as manual fills and trades
  (`claimQualification`); a block needs an override reason from someone holding `scheduling.qualification.override` at the unit,
  which the database re-checks. Acting (below minimum rank where allowed) is recorded on the assignment.
- **Visibility:** open shifts are visible to claim-permission holders and to officers of the seat's unit; claims to the claimant and those officers.
- **Not yet:** call-back lists and mandatory hold-over ordering, special pay rules for open shifts, leave limits (1d-3).
- **Existing departments:** add `scheduling.openshift.claim` to their member roles (Admin → Roles).

## Assets, checklists and inventory (Phase 3a)

Plan: `docs/superpowers/plans/2026-11-25-phase-3a-assets-inventory.md`. Module key `inventory` (Admin → Settings). Pages:
`/assets`, `/checks`, `/inventory`; admin: Asset types, Checklists, Items and locations, and Custom fields → Asset fields.

### Who can do what
- **Reads are department-wide** for holders of `inventory.asset.view` / `inventory.stock.view` (every station's assets and
  stock are visible); **writes are scoped to the location's org unit** and checked in SQL. A stock location with no station
  inherits its nearest ancestor's; with none, department-wide permission is needed. Moving an asset needs the permission at
  both stations. Members choose their station from the full list when recording a check or stock movement.
- Permissions: `inventory.asset.{view,manage,event}`, `inventory.check.{perform,manage}`, `inventory.stock.{view,use,manage}`.
  Members get view/perform/use; officers add `asset.event`; Logistics and Fleet roles manage; the Auditor reads.
- Existing departments created before this need these permissions added to their roles and the module turned on.

### Data model and rules
- **Assets:** typed (`asset_types`, archived never deleted), status `in_service | out_of_service | reserve | maintenance | retired`,
  location = an org unit, custom fields from the `asset` registry (validated: known, unarchived, required present).
  `assets.status` and location change only inside `app.record_asset_event`, which writes the `asset_events` row in the
  same transaction. `out_of_service` and `retired` need a reason; `retired` is terminal (notes only) and must precede archiving.
  **A failed check never changes status**: people set the truck in or out of service.
- **Checklists:** versioned JSON items (`pass_fail | number | text`, required or optional). Every save is a new version and
  the old one stops accepting completions; a completion stores a snapshot of the version it answered, so history never
  changes. Completions are by the caller's own member, append-only, and log one `check` event on the asset.
  Starter: **Daily Truck Check** (generic) and **Drug Inventory** — a seal/count verification checklist only; chain of custody,
  witnessed waste and discrepancies for controlled substances are Phase 3b.
- **Inventory:** items, a tree of stock locations (`storeroom, station, apparatus, compartment, container`), par levels, and
  an append-only `stock_ledger` of signed deltas (`receive, use, adjust, transfer_out, transfer_in`). On-hand is the view
  `stock_levels` (no cached balance); `low_stock` lists pairs below par (`critical` at or below the minimum). Stock can never
  go below zero (refused, not clamped); adjustments need a reason; transfers write two rows with one `transfer_id` and take
  advisory locks so two racing transfers of the last units cannot both succeed.
- `asset_events`, `checklist_completions` and `stock_ledger` raise on update, delete and truncate (`app.forbid_mutation`),
  even for the table owner. Fix mistakes with a compensating entry.
- **Starter pack** (editable, applied with the department template): asset types Apparatus, Cardiac monitor, Cot, Ballistic
  vest, Turnout gear, Equipment; asset fields serial number, size, issue and expiration dates, assigned to; two checklists;
  a few supplies and a Main storeroom. All values are examples.
- **3b hooks (not built):** ledger rows carry `witnessed_by`, `lot_id`, `signature_id` and `reference`; `items.is_controlled`
  exists but a check pins it false; `stock_locations.kind` reserves `container`; checklist completions can reference a stock
  location. Controlled substances will get their own ledger rather than relaxing these rules.

### Tests
`pnpm -F @soma/db test` (`assets`, `checklists`, `inventory` incl. a two-connection race), `pnpm -F @soma/web test:db`
(`inventory-servers`), `pnpm -F @soma/web e2e e2e/inventory.spec.ts`.

### Not yet
Lots and expiry, purchasing, barcode scanning, photos on checks, work orders and maintenance schedules, auto out-of-service
from failed checks, per-member issued gear, mobile/offline entry.

## Leave limits (Phase 1d-3)

Plan: `docs/superpowers/plans/2026-11-25-phase-1d3-leave-limits.md`. Admin: **Admin → Leave → Leave limits**.

- **What it is:** a cap on how many members may be on **approved** leave on the same day, for the whole department or a
  station subtree (`org_unit`, includes sub-units), optionally for one shift and/or one leave type, from a start date.
  A limit of `0` means no one may be off. Archive a limit to lift it.
- **Members can always request.** The limit is enforced when an approver **approves**: `app.decide_leave` refuses with
  `Leave limit: "<label>" allows at most N member(s) on leave on <date> (M already approved)` when any day of the request
  would exceed it. Exactly at the limit is allowed; one over is refused.
- **Counting:** a member counts for a day when an approved request covers that date (pending, denied and cancelled do not).
  A member's scope is where they work now (primary assignment, else standing seat), the same rule as leave approval; a
  leave-type limit only counts, and only applies to, that type. The request's own member is never counted against themselves.
- **Override:** a department-wide `leave.manage` holder can approve anyway by giving a reason (5+ characters); the database
  re-checks the permission and records `Limit override: <reason>` in the request's decision note. Plain approvers cannot waive.
- **Approvals screen:** each pending request shows the days where approving would reach or exceed a limit
  (`app.leave_request_limits`); the override field appears only for managers on a request that is over.
- **Not yet:** seniority-based auto-approval, waitlists, per-leave-type fairness, limits driven by actual roster staffing.
- `app.decide_leave` now takes an optional 4th argument (override reason); the 3-argument call still works.

## Documents, SOGs and forms (Phase 4a)

Plan: `docs/superpowers/plans/2026-11-25-phase-4a-documents-forms.md`. Pages: `/documents`, `/sogs`, `/forms`, `/admin/form-definitions`.
Modules `documents` and `forms` (Admin → Settings turns them on for departments created before this).

### Documents
- **Folders** nest; a folder can be restricted to department-wide holders of a permission (the starter **HR** folder uses
  `admin.members.manage`). A restricted folder hides everything under it from everyone else, including the file itself
  (`attachments` rows of entity `document_version` follow the version row's visibility, not just `files.view`).
- A **document** has a kind (document / SOG / policy), an optional number (SOG 3.4) and many **versions**. Upload creates a
  *draft*; `documents.publish` publishes it, which **supersedes** the previous version in one transaction (it stays
  readable). A published version's file, label, dates and notes can never change, and versions are never deleted.
  Backdating an effective date needs `documents.backdate` and a reason. Concurrent publishes are serialised per document.
- Writes only go through `app.save_folder`, `create_document`, `add_document_version`, `publish_document_version`, `archive_document`.

### Required reading (SOGs)
- `sog.assign` assigns a *published* version to everyone, to units (and their sub-units) and/or roles, with a due date
  (default 14 days), a statement and an optional typed-name requirement. Assignees are the active members matching the
  audience at that time; the daily job (`reading-reminders`, `app.send_reading_reminders()`) adds later joiners.
- A member acknowledges once (`app.acknowledge_reading`): the row records member, version in force, server time, the
  exact statement and method (click or typed name) plus a SHA-256 `ack_hash`, and **cannot be changed or deleted**.
  Acknowledging for someone else, an unassigned reading, a closed reading or after a newer *major* version is refused.
- **Major vs minor** is the publisher's choice at publish time: a major version closes the old reading and opens a new one
  for the same audience (old acknowledgements remain as history); a minor one keeps the open reading.
- **Reminders** go through the notifications + jobs outbox at assignment, 7 days before due, on the due date, then every 7
  days while overdue; each is logged per (reading, member, kind, day) so a rerun never double-sends. Acknowledged and
  separated members get none; email honours notification preferences.
- Officers with `sog.report` see who has not read it for their unit; members see only their own rows.

### Forms
- A **definition** is versioned JSON: fields use the custom-field types (`text, long_text, number, integer, boolean, date,
  select, multi_select, email, phone`) plus an optional `show_if {field, equals}` on an *earlier* field. It also says
  whether a signature is required (with the statement the signer agrees to) and whether an officer approves. Definitions are
  never edited: **saving creates a new draft version**, publishing retires the old one.
- **Submissions** are append-only and keep a copy of the definition they answered, so editing the form later never changes
  history. The database validates answers (required, type, options, hidden fields must be empty) with the same wording as
  custom fields (`app.validate_form_answers`).
- **Signatures:** typed (the member retypes their own full name) or drawn (PNG stored base64 in the signature row, so
  members need no file permissions). Each records signer, server time, method, the exact statement, IP and browser.
- **Hashes** are computed in SQL in the function that inserts the row:
  `submission_hash = sha256(tenant | definition_id | definition_version | member_id | submitted_at(UTC ISO) | answers jsonb text)`;
  `signature_hash = sha256(submission_hash | signer | signed_at | method | statement | sha256(image))`.
  `app.verify_submission(id)` recomputes both from stored data; the submission page shows *Intact* or a warning. This shows the
  stored record was not altered after submission; it does not make an exported file tamper-evident (see below).
- **Approval:** `approval = officer` needs a `forms.approve` holder whose grant covers the **submitter's station**, never the
  submitter. Decisions (`approved`, `rejected`, `returned` with a note) are append-only rows; status is a view. A returned or
  rejected submission is corrected by a **new submission that links to the original**, which stays visible, marked
  "corrected by". The submitter can void before any decision; `forms.manage` can void any (reason required).
- Starter content (editable, no legal review): folders *Policies and SOGs, Forms Library, Training, HR* and three forms
  (Incident / Injury Report, Vehicle Damage Report — officer approval and signature; Equipment Issue Receipt — signature only).

### Defaults applied for the plan's open questions
Click acknowledgement (typed name per reading); publisher chooses major/minor; HR folder restricted by permission; 14-day
due date with the reminder schedule above; officer sign-off on incident and vehicle reports only; on-screen signatures for
internal forms with legal-grade sealing later; corrected submissions never replace the original; no NinthBrain import (upload
current PDFs as version 1 and rebuild forms in the builder).

### Not yet (needs a later compliance pass)
PDF/A rendering of submissions, platform sealing (PAdES with a KMS key and an RFC 3161 timestamp), step-up authentication at
signing, consumer e-sign consent screens and public signing links, per-form signature policy (witness, countersign order),
retention schedules and legal holds, repeating sections/photo/GPS fields, multi-step approval chains, review-cycle reminders
for documents, redlines between versions, full-text search, offline form sync.
Existing departments: add the new permissions to their roles (Admin → Roles) and enable the modules.
Tests: `packages/db/tests/{documents,readings,forms}.test.ts`, `apps/web/tests/db/documents-forms.test.ts`,
`apps/worker/tests/db/reading-reminders.test.ts`, `apps/web/e2e/{documents,forms}.spec.ts`.

## Controlled substances: custody (Phase 3b)

Plan: `docs/superpowers/plans/2026-11-25-phase-3b-controlled-substances.md`. Module key `custody`, pages under `/custody`, admin at
`/admin/custody`. Migrations `20261124000031` (catalog, locations, lots, seals), `…32` (ledger, witness requests, movements),
`…33` (counts, discrepancies, expiry and recall views).

> **TEST MODE UNTIL REVIEWED.** SomaOS records custody and surfaces problems. It does not decide what the law requires. Do not use it
> as the system of record for controlled substances in a real department until counsel and the medical director have worked through
> the Compliance Boundary checklist below. Every custody page says so.

### What it is
- **Catalog:** `cs_items` (medication, schedule label, unit), `cs_lots` (lot number, expiry, recall), `cs_locations` (vault, station,
  unit, drug box, member; each belongs to an org unit). Separate from the 3a stock tables.
- **Ledger:** `cs_ledger` is append-only (update, delete and truncate are rejected, even for the table owner). Every row is
  attributed to the member who did it (stamped in SQL, never a parameter) and signed: `delta` is positive for receive and transfer in,
  negative for administer, waste and transfer out. A movement can never take a lot below zero at a location (refused, not clamped);
  expired or recalled lots cannot be received, moved or administered (waste, return and adjust stay possible). Mistakes are corrected only
  by a **witnessed adjust**.
- **Hash chain:** each location has its own chain. A new row's hash covers the previous hash and every field that matters; writers to a
  location are serialized by locking its row. `app.verify_cs_chain(location)` (audit or manage) reports the first entry that does not
  verify; the location page shows the result and a count opens a `chain` discrepancy if it fails. A hash chain shows tampering; it does
  not stop someone with database-owner rights (anchoring the chain heads outside the database is future work).
- **Balances** are views over the ledger (`cs_balances`), never a stored number. `cs_expiring` (90 days) and `cs_recalled` are views too.

### Who can do what (four separate permissions; none implies another)
| Permission | Can |
|---|---|
| `custody.record` | At their unit: receive, administer, transfer, return, request waste, seal, count |
| `custody.witness` | Confirm witness requests at their unit (never their own) |
| `custody.audit` | Read everything, department-wide; run the chain check; cannot write |
| `custody.manage` | Catalog, lots, locations, recalls, adjustments, discrepancies (investigate, escalate, resolve) |

The starter roles: **Department Admin holds none by default**; Member, Company Officer and Shift Commander get record and witness;
the new **Controlled-Substance Officer** and the Medical Director get audit and manage; the Read-only Auditor gets audit.
Existing departments must add these permissions to their roles and turn the module on (Admin → Settings).

### Witnessing
A witness is always a **different, authenticated member** confirming from their own session. The performer requests a witness
(`request_cs_witness`); the named witness confirms or declines (`confirm_cs_witness`); the performer then completes the action and the
stored request is **consumed once**, only for exactly the details the witness saw (quantities compare equal however they were typed).
Requests expire after 30 minutes. Waste and adjust always need one; moving stock into or out of a drug box or a member needs one;
seal breaks and counts need one. The UI is `/custody/witness`.

### Counts and discrepancies
The Drug Inventory count is **blind and binding**: the sheet lists the lots held with names only, the counter enters what they see, a
witness confirms, and the expected quantity is read in SQL when the count is submitted. Every lot held must be counted. Any difference
(quantity, seal number, or a failing chain) opens a **discrepancy**: it is never deleted or edited, only its status moves
(open → investigating → escalated → resolved) by appending events. The counter and the witness cannot resolve their own count; a
resolution may post one witnessed `adjust` linked to the discrepancy. "Escalate" records a free-text report reference; nothing is filed
anywhere.

### Defaults applied (the plan's recommended answers to the open questions)
1. Witness confirms from their **own session**; same-device step-up waits for the auth design.
2. Administer needs **no witness**, only a free-text incident/run number (incident numbers only, no patient identifiers).
3. **Every waste** is witnessed by a different member with `custody.witness`.
4. Counts are **blind and two-person** at shift change; frequency is the department's and is not enforced.
5. **Any** difference opens a discrepancy; no automatic location hold; escalation is free text.
6. Discrepancies are resolved by a Controlled-Substance Officer or Medical Director (`custody.manage`), never the counter or witness.
7. `reference` holds an incident number only; no PHI.
8. Ledger rows are **never purged**; counsel confirms the minimum retention.
9. Per-unit scope for record, witness and manage; department-wide for audit.
10. Release is gated on the checklist below; run in test mode until then.

### Compliance Boundary: pre-release checklist for counsel and the medical director
Nothing here is a legal conclusion. Each row is a question to confirm before a real department relies on the module.

| Topic | Source (per research A3) | In this phase | Confirm |
|---|---|---|---|
| Records of receipts and deliveries, retention (reported as 2 years; 21 CFR 1304.04 / 1304.27) | Reported DEA | Ledger rows are kept indefinitely; no purge function exists | Retention period; required data elements; whether the fields satisfy 1304.27 |
| Secure storage in a locked cabinet or vehicle (21 CFR 1301.80) | Reported DEA | Seal tracking is a record only, not a control | Whether seal events are expected as records |
| Theft or significant loss reporting (one business day; Form 106) | Reported DEA | `escalated` status and a free-text report reference; no timers, nothing filed | What counts as significant; who decides; timers |
| Waste of a partial dose: witness (research sources conflict) | Conflicting | Witness required for every waste (stricter, policy) | Whether required, and by whom, in our state |
| Shift-change counts and frequency | Department or state policy | Binding blind count; frequency not enforced | Required frequency and who may count |
| Discrepancy tolerance, officer approval, location hold | Department policy | Any difference opens a discrepancy; an officer resolves it | Zero tolerance for every schedule? |
| Hash chain and separation of permissions | Engineering choice | Built | Whether it conflicts with record-keeping expectations |
| Administer needs a witness or a standing/verbal order reference | Unclear, policy | Not required; free-text reference | Whether orders must be linked |
| State-specific rules (licensing, seal logs, count frequency) | State law | Not configurable | Per-state list |

Hooks left for later: ePCR linkage (the `reference` field), notice timers on `escalated`, DEA registrations and designated locations,
Form 41 destruction and biennial inventory, ordering (Form 222 / CSOS), state rule configuration, external anchoring of chain heads,
step-up PIN or biometric witnessing, barcode and smart-safe ingest.

Tests: `packages/db/tests/{cs-catalog,cs-ledger,cs-counts}.test.ts` (including the tamper test and the concurrent last-units race),
`packages/validators/tests/custody.test.ts`, `apps/web/tests/db/custody.test.ts`, `apps/web/e2e/custody.spec.ts`.
