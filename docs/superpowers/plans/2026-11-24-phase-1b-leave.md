# Phase 1b — Leave Banks, Accruals, Comp Time, Requests & Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A department can define leave banks (vacation, sick, comp time…), the accrual policy for each (tiers by years of service, caps, carryover, part-time fractions), and leave types; members see balances and request leave; officers approve or deny within their scope; approval debits the bank and frees the member's rostered shifts; a daily worker job posts accruals and year-end carryover idempotently.

**Architecture:** Pure accrual math in `@soma/schedule-engine` (`accrual.ts`, no DB). Balances are an **append-only ledger** (`leave_ledger`); balance = sum. Accrual policies are `config_versions` documents (kind `leave.accrual`, key = bank key), so they are versioned, effective-dated and approved like shift patterns. **All leave writes go through `security definer` SQL functions** that verify the caller's scope (`app.my_grants()` + ltree), so a captain can act only on their own station/shift and nothing depends on app-side checks alone. Approval cancels the member's scheduled shifts in the range (linked by `leave_request_id`), which the 1a roster already shows as vacancies; cancelling approved leave reverses the ledger and restores them. `apps/worker` runs accruals.

**Tech Stack:** Existing stack (Next.js App Router, Supabase Postgres + RLS, postgres-js, Zod 4, Vitest, Playwright + axe). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §7.2 (leave types, accrual banks & policies, comp time, leave requests), §7.3 (pure engine, explain traces), §5.3–5.5 (RLS, scoped grants). Sub-plan **1b** of Phase 1; after 1a (roster). Later: 1c pay codes/OT/timesheets (comp time *earning* from OT), 1d trades/vacancy fill/leave limits & blackout dates, 1e rule-builder UI, simulation, iCal/CAD export.

## Global Constraints

- All Phase 0/1a global constraints apply: strict TS, RLS + isolation test on every tenant table, `timestamptz` UTC, half-open ranges, no hard deletes, axe scan on every page test, no service-role key in `apps/web`, DB-level checks scope-aware (`app.has_permission_dept` or scope-checking functions), no privilege escalation.
- **No department-specific numbers in code.** Hours, tiers, caps are policy data. Template policies are **drafts** labelled as starter values: a department admin must edit and approve them (interim: validated JSON editor; the no-code builder is 1e).
- Balance ledger is **append-only**: `update`, `delete`, `truncate` revoked from every API role; corrections are new `adjust`/`reversal` entries.
- Hours are `numeric(8,2)`; rounding to 2 decimals happens in the engine only.
- Leave covers **whole scheduled shifts**: hours debited = hours of the member's scheduled, non-Kelly shifts whose local start date falls in `[start_date, end_date]`. No scheduled shifts in range → request rejected ("No scheduled shifts in that range").
- Comp time is a bank with `earn: { method: 'manual' }` and a `cap` (design default 480 h for public safety; **policy data, not code**).
- Timezone for "today" and shift local dates: seat unit's timezone, else the tenant's.

## Review Focus

1. **Accrual runs twice / after a worker crash** → no duplicate `earn` rows (unique `run_key` per member+bank); a policy change mid-year affects only unposted periods. Tests in Tasks 1 and 4.
2. **Request exceeding balance** (with and without `negativeAllowed`), counting other *pending* requests against the balance → rejected with a clear message. Test in Task 4.
3. **A captain approving someone outside their station or shift** → database refuses (`not in your scope`), including via a stale/foreign request id. Test in Task 4.
4. **Cancelling approved leave** → ledger reversed once (double-cancel does nothing), shifts restored; if the seat was refilled meanwhile → clear error, nothing changes. Test in Task 4.
5. **Hire mid-period, waiting period, part-time, cap, separated member** → each computed per spec of the policy with explain lines. Tests in Task 1.
6. **Member requesting for someone else, or editing the ledger directly** → refused by RLS/grants. Tests in Task 3.

---

## File Structure

```
packages/schedule-engine/src/accrual.ts      AccrualPolicy, earnForPeriod, accrualPeriods, yearEndCarryover, canUse, balanceOf
packages/schedule-engine/tests/accrual.test.ts
packages/validators/src/leave.ts             zod: accrual policy payload, bank, leave type, request, adjustment forms
packages/auth/src/permissions.ts             + leave.request, leave.approve, leave.view, leave.manage
supabase/migrations/20261124000017_leave.sql         banks, leave_types, leave_requests, leave_ledger, leave_balances view, notify_internal
supabase/migrations/20261124000018_leave_functions.sql   request_leave, decide_leave, cancel_leave, adjust_leave, leave_requests_in_scope
packages/db/tests/leave.test.ts              schema, RLS, append-only
packages/db/tests/leave-functions.test.ts    request/approve/cancel/scope/balance behaviour
packages/templates/src/leave.ts              starter banks, leave types, DRAFT policies; apply.ts creates them
apps/web/src/server/leave/{load.ts,policies.ts}
apps/web/src/app/(app)/leave/{page.tsx,actions.ts,forms.tsx}            My leave: balances, request, my requests
apps/web/src/app/(app)/leave/approvals/{page.tsx,actions.ts}            approvals in my scope
apps/web/src/app/(app)/admin/leave/{page.tsx,actions.ts,forms.tsx}      banks, types, policy draft/approve, adjustments
apps/worker/src/jobs/leave-accrual.ts        runAccruals(sql, now)
apps/web/e2e/leave.spec.ts
```

---

### Task 1: Accrual engine (pure)

**Files:** Create `packages/schedule-engine/src/accrual.ts`, `tests/accrual.test.ts`; modify `src/index.ts` (export).

**Interfaces — Produces:**
```ts
export type EarnRule =
  | { method: 'per_period'; hours: number }
  | { method: 'per_hours_worked'; perHours: number; earnHours: number }
  | { method: 'annual_front_load'; hours: number }
  | { method: 'manual' };
export type AccrualPolicy = {
  period: { kind: 'monthly' } | { kind: 'fixed_days'; days: number; anchor: IsoDate };
  tiers: { fromYears: number; earn: EarnRule }[];        // >= 1 tier, first fromYears = 0
  cap: number | null;                                    // max balance; earning stops at the cap
  waitingPeriodDays: number;                             // no accrual until hireDate + N days
  prorateFirstPeriod: boolean;                           // scale per_period by days employed
  fractionByEmploymentType: Record<string, number>;      // default 1 when absent
  negativeAllowed: boolean;
  carryover: { max: number | null; resetOn: string | null }; // resetOn 'MM-DD' (local); null = never
};
export type AccrualFacts = { hireDate: IsoDate | null; employmentType: string; hoursWorked: number; balance: number; separatedOn: IsoDate | null };
export type Period = { start: IsoDate; endExclusive: IsoDate };
export function accrualPeriods(p: AccrualPolicy['period'], from: IsoDate, toExclusive: IsoDate): Period[];
export function yearsOfService(hire: IsoDate, on: IsoDate): number;           // whole years
export function earnForPeriod(policy: AccrualPolicy, facts: AccrualFacts, period: Period): { hours: number; explain: Explain[] };
export function yearEndCarryover(policy: AccrualPolicy, balance: number): { carried: number; expired: number; explain: Explain[] };
export function canUse(policy: AccrualPolicy, balance: number, pendingHours: number, hours: number): { ok: boolean; explain: Explain[] };
export function balanceOf(entries: { hours: number }[]): number;
```
`earnForPeriod` order: separated on/before period start → 0; waiting period (hire + N days ≥ `endExclusive` → 0); pick tier with greatest `fromYears` ≤ `yearsOfService(hire, last day of period)`; compute raw per rule (`per_hours_worked` = `hoursWorked / perHours * earnHours`; `annual_front_load` only in the period containing Jan 1; `manual` = 0); × fraction; prorate first period when `prorateFirstPeriod` and hire date inside the period (× days employed ÷ period days); clip to `cap - balance` (never below 0); round to 2 decimals. Every step that changes the number adds an `Explain` line (`rule` ids: `accrual.separated`, `accrual.waiting`, `accrual.tier`, `accrual.fraction`, `accrual.prorate`, `accrual.cap`). `accrualPeriods` monthly = calendar months overlapping the range, `fixed_days` = consecutive blocks from `anchor`.

- [ ] **Step 1:** Tests (names + assertions): per_period 8 h/month, 2026-12 → 8; tier switch exactly at 5 years of service (hire 2021-12-15: Dec 2026 uses tier ≥5, Nov 2026 uses tier <5); `per_hours_worked` 1 h per 20 worked, 120 h → 6; part-time fraction 0.5 → 4; waiting period 90 days blocks Dec when hired 2026-10-15 and allows Jan; first-period proration hired 2026-12-16 (16 of 31 days) → 8 × 16/31 = 4.13; cap: balance 236, cap 240, earn 8 → 4, balance 240 → 0 with `accrual.cap` explain; separated 2026-11-30 → 0 in Dec; `annual_front_load` credited only in the period containing Jan 1; `yearEndCarryover` max 40, balance 55 → carried 40, expired 15; balance 30 → expired 0; `canUse`: balance 10, pending 6, use 5, `negativeAllowed` false → not ok with message containing "4 h available"; `negativeAllowed` true → ok; `accrualPeriods` fixed_days 14 anchored 2026-01-02 yields back-to-back blocks; `balanceOf` sums signed hours.
- [ ] **Step 2:** `pnpm -F @soma/schedule-engine test` → FAIL.
- [ ] **Step 3:** Implement per Interfaces (pure; reuse `time.ts` helpers).
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(schedule-engine): accrual policies, periods, cap and carryover`.

### Task 2: Validators and permissions

**Files:** Create `packages/validators/src/leave.ts`, `tests/leave.test.ts`; modify `packages/auth/src/permissions.ts`, `packages/validators/src/index.ts`.

**Interfaces — Produces:** `accrualPolicySchema` (zod for `AccrualPolicy`, rejects: empty tiers, first tier `fromYears ≠ 0`, unsorted/duplicate tiers, negative numbers, `perHours ≤ 0`, bad `resetOn`, fraction outside (0,1]); `parseAccrualPolicyJson(text): { ok: true; policy } | { ok: false; error: string }` (friendly message with path); `bankSchema` `{ label, key }`; `leaveTypeSchema` `{ label, key, bankId?: uuid|'' , requiresDocumentation: bool, leadTimeDays: int ≥ 0, countsAsWorked: bool }`; `leaveRequestSchema` `{ leaveTypeId, startDate, endDate, reason? }` (end ≥ start); `adjustmentSchema` `{ memberId, bankId, hours (≠ 0, |x| ≤ 2000), note (≥ 5 chars) }`. Permissions: `leave.request` (module leave), `leave.approve`, `leave.view` (sensitive HR), `leave.manage` (sensitive HR).

- [ ] **Step 1:** Tests for each schema's accept/reject cases above and `parseAccrualPolicyJson` error text for malformed JSON and a bad tier path; `isPermission('leave.approve')` true.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat: leave validators and permissions`.

### Task 3: Leave schema and RLS

**Files:** Create `supabase/migrations/20261124000017_leave.sql`, `packages/db/tests/leave.test.ts`.

**Interfaces — Produces tables (all tenant-scoped, RLS, audit trigger; composite `(tenant_id, id)` FKs):**
- `leave_banks(id, tenant_id, key, label, archived_at, unique(tenant_id,key), unique(tenant_id,id))`
- `leave_types(id, tenant_id, key, label, bank_id null → leave_banks, requires_documentation bool, lead_time_days int, counts_as_worked bool, sort, archived_at, unique(tenant_id,key), unique(tenant_id,id))`
- `leave_requests(id, tenant_id, member_id, leave_type_id, start_date date, end_date date, hours numeric(8,2) > 0, status check in ('pending','approved','denied','cancelled'), reason, decided_by uuid, decided_at, decision_note, created_at; check end_date >= start_date; exclusion: member_no_overlap on daterange(start_date,end_date,'[]') where status in ('pending','approved'))`
- `leave_ledger(id bigint identity, tenant_id, member_id, bank_id, kind check in ('earn','use','reversal','adjust','expire','payout'), hours numeric(8,2) (signed, ≠ 0), effective_date date, run_key text null, request_id uuid null, policy_version int null, note text, explain jsonb, created_by uuid default auth.uid(), created_at; unique (tenant_id, member_id, bank_id, run_key) where run_key is not null)`; `revoke insert, update, delete, truncate` from `authenticated, anon`, and `revoke update, delete, truncate` from `service_role` (service role may insert for the worker).
- `shift_assignments.leave_request_id uuid null` (+ FK composite).
- View `leave_balances(tenant_id, member_id, bank_id, hours)` `security_invoker`.
- `app.notify_internal(member uuid, kind, title, body, link) returns uuid` = current `app.notify` body without the permission check, **not granted** to `authenticated`; `app.notify` re-created to check permission then call it (behaviour unchanged).
- RLS: banks/types — tenant read; write `has_permission_dept('leave.manage')`. `leave_requests` — select own (`member_id = app.my_member_id()`) or dept `leave.view`/`leave.manage`; no insert/update/delete policies (functions only). `leave_ledger` — select own or dept `leave.view`/`leave.manage`; no write policies.

- [ ] **Step 1:** Tests: isolation for banks, types, requests, ledger (`expectTenantIsolation` where inserts are possible; reads otherwise); a member sees only their own ledger/requests, a `leave.view` holder sees all; direct `insert/update/delete` on `leave_ledger` and `leave_requests` by `authenticated` → permission denied; `service_role` update/delete on ledger denied; duplicate `run_key` rejected; overlapping pending/approved requests rejected, cancelled ones don't block; `app.notify` still requires `notifications.send` for others (existing test keeps passing); rls-coverage test stays green.
- [ ] **Step 2:** FAIL → **Step 3:** migration → **Step 4:** `pnpm db:reset && pnpm test:db` PASS. **Step 5:** Commit `feat(db): leave banks, types, requests and append-only ledger`.

### Task 4: Leave functions (request, decide, cancel, adjust, scoped list)

**Files:** Create `supabase/migrations/20261124000018_leave_functions.sql`, `packages/db/tests/leave-functions.test.ts`.

**Interfaces — Produces (`security definer`, `search_path = ''`, granted to `authenticated`, never `anon`):**
- `app.request_leave(p_type uuid, p_start date, p_end date, p_reason text) returns uuid` — for the caller's own member; requires `leave.request` (any scope); checks lead time (`p_start >= today + lead_time_days`, today in tenant tz), computes hours from scheduled non-Kelly shifts in range, errors `No scheduled shifts in that range`, enforces `canUse`-equivalent in SQL (balance − other pending hours ≥ hours unless the approved policy has `negativeAllowed`; banks with no policy → treated as not allowed), inserts a `pending` request, notifies approvers is out of scope (the approvals page lists pending).
- `app.decide_leave(p_request uuid, p_approve boolean, p_note text) returns void` — caller must hold `leave.approve` with a **grant covering the member's current primary assignment org unit and shift** (department scope, or org-unit path prefix, honouring `scope_shift_id`); else `not in your scope`. Pending only. Approve: ledger `use` (−hours, `effective_date = start_date`, `request_id`), cancel the member's scheduled shifts in range (`status='cancelled'`, `cancelled_reason='Leave: <type label>'`, `leave_request_id`), set request `approved`; deny: set `denied` (note required, ≥ 5 chars). Both: `app.notify_internal` to the member.
- `app.cancel_leave(p_request uuid, p_note text) returns void` — the member (own, pending or approved, not yet started) or someone with approve scope. Approved: ledger `reversal` (+hours, once — guard by request status), restore `shift_assignments` where `leave_request_id = p_request` to `scheduled` (seat/member exclusion constraint violation → error `A seat was refilled; resolve it in the roster first.` and nothing changes); status `cancelled`.
- `app.adjust_leave(p_member uuid, p_bank uuid, p_hours numeric, p_note text) returns void` — `has_permission_dept('leave.manage')`; note ≥ 5 chars; ledger `adjust`.
- `app.leave_requests_in_scope(p_status text default 'pending') returns table(request_id, member_id, member_name, leave_type, start_date, end_date, hours, reason, status, created_at)` — rows the caller may decide (same scope test), newest first.

- [ ] **Step 1:** Tests (Review Focus 2, 3, 4): request computes hours from seeded roster shifts (3 shifts × 24 = 72); Kelly rows excluded; no shifts → error; lead time enforced; insufficient balance rejected, and a second pending request counts against balance; `negativeAllowed` policy allows it; approve debits ledger and cancels exactly the shifts in range and links them; roster no longer shows them scheduled; a captain scoped to Station 1/B shift cannot decide a Station 2 member's or an A-shift member's request (`not in your scope`); department approver can; a member cannot decide their own request; deny requires note; cancel approved leave reverses once (second call errors/no-ops without a second reversal) and restores shifts; cancel fails cleanly when the seat was refilled and leaves ledger/status unchanged; `adjust_leave` needs dept `leave.manage` (org-unit-scoped manager refused); `leave_requests_in_scope` returns only in-scope pending requests.
- [ ] **Step 2:** FAIL → **Step 3:** implement migration → **Step 4:** `pnpm test:db` PASS. **Step 5:** Commit `feat(db): scoped leave request, decision, cancellation and adjustment functions`.

### Task 5: Templates and dev seed

**Files:** Create `packages/templates/src/leave.ts`, `tests/leave.test.ts`; modify `types.ts`, `career-3-platoon.ts`, `volunteer.ts`, `roles.ts`, `apply.ts`, `scripts/seed-dev.ts`.

**Interfaces — Produces:** `DepartmentTemplate.leave: { banks: {key,label}[]; types: {key,label,bankKey,leadTimeDays,requiresDocumentation,countsAsWorked}[]; policies: {bankKey: string; payload: AccrualPolicy}[] }`. Career template: banks `vacation`, `sick`, `comp_time`, `holiday`; types vacation, sick, comp time, holiday, bereavement (no bank), FMLA (no bank, requires documentation), military (no bank). **Policies are inserted as `draft` config versions (`leave.accrual`/bank key) and are clearly starter values** (the template file comment and the admin page say so); `comp_time` policy is `manual` with `cap: 480`. Roles: `member` gets `leave.request`; `company_officer`, `shift_commander`, `chief_officer` get `leave.approve` + `leave.view`; `payroll_hr` gets `leave.view` + `leave.manage`; `dept_admin` all. `applyTemplate` is idempotent for banks/types/policies. Seed: demo members get small `adjust` balances so the demo is usable.

- [ ] **Step 1:** Tests: every template permission exists; applying twice yields 4 banks, 7 types, 4 draft policies; policy payloads parse with `accrualPolicySchema`; no policy is approved by default.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm test:unit && pnpm test:db`). **Step 5:** Commit `feat(templates): leave banks, types and draft accrual policies`.

### Task 6: My leave and approvals (web)

**Files:** Create `apps/web/src/server/leave/load.ts`, `app/(app)/leave/{page.tsx,actions.ts,forms.tsx}`, `app/(app)/leave/approvals/{page.tsx,actions.ts}`; modify `server/nav.ts` (My leave; Leave approvals for `leave.approve` holders).

**Interfaces — Consumes:** Task 4 functions via `withCtxDb`. **Produces:** server actions `requestLeave`, `cancelLeave`, `decideLeave` that call the SQL functions and map errors (`No scheduled shifts…`, `insufficient balance`, `not in your scope`, lead time) to field-level messages through `friendlyDbError`.

My leave page: balance cards per bank (hours, plus shifts equivalent when the member's regular shift hours are known), request form (type, dates, reason; shows computed hours after submit), my requests with Cancel. Approvals page: pending requests in scope with hours, member, type, dates, reason; Approve / Deny (note) forms. Phone layout (list, no horizontal overflow); axe clean.

- [ ] **Step 1:** Playwright (`leave.spec.ts`, part 1): generate a month as admin; member requests leave for two A-shift dates → status "Pending", hours shown; approver (scoped officer created in the test) sees it, member outside their scope does not; approve → member balance drops by the hours and the roster shows the seat vacant on those dates; member cancels → balance restored and shifts back; request beyond balance shows "insufficient balance"; at 390 px no horizontal overflow (use the letter-spacing stress from `responsive.spec.ts`); axe on both pages.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm -F @soma/web e2e leave`). **Step 5:** Commit `feat(web): my leave, requests and approvals`.

### Task 7: Leave admin (banks, types, policies, adjustments)

**Files:** Create `apps/web/src/server/leave/policies.ts`, `app/(app)/admin/leave/{page.tsx,actions.ts,forms.tsx}`; modify `server/nav.ts` (admin entry for `leave.manage`).

**Interfaces — Produces:** `savePolicyDraft(tx, bankKey, payload)`, `approvePolicyDraft(tx, bankKey, version, effectiveDate)` mirroring `patterns.ts` (closes the current approved version at local midnight of `effectiveDate`; needs `admin.config.manage`). Page: banks and leave types (add/archive), per-bank policy editor (**validated JSON textarea, interim until 1e**, with the engine's friendly error text, and an "Explain a sample member" preview that runs `earnForPeriod` for a hire date and period the admin enters), draft/approve with effective date, manual adjustment form (member, bank, ± hours, note), recent ledger for a member.

- [ ] **Step 1:** Playwright (`leave.spec.ts`, part 2): admin edits a draft policy with invalid JSON → friendly error; valid → saved; preview shows hours and explain lines; approve from a date → shown as the current version; adjustment of +8 h with a note appears in the member's balance and ledger; a non-`leave.manage` user gets "Not allowed"; axe clean.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(web): leave admin — banks, types, accrual policy versions and adjustments`.

### Task 8: Accrual worker job

**Files:** Create `apps/worker/src/jobs/leave-accrual.ts`, `apps/worker/tests/db/leave-accrual.test.ts`; modify `apps/worker/src/index.ts` (handler + daily bootstrap like `credential-expiry-scan`).

**Interfaces — Produces:** `runAccruals(sql: postgres.Sql, now: Date): Promise<{ posted: number; expired: number }>` — for each active tenant (tenant tz decides "today"), each bank with an approved policy, each active member: for each **completed, unposted period** since the later of hire date and the policy's effective date (cap: 24 periods back), compute `earnForPeriod` (hours worked from completed `shift_assignments` in the period) and insert an `earn` ledger row with `run_key = 'earn:<period.start>'`, `ON CONFLICT DO NOTHING`; on a `resetOn` boundary insert one `expire` row (`run_key = 'expire:<year>'`) via `yearEndCarryover`. Re-enqueues itself daily like the expiry scan; one failing member must not stop the rest (log and continue).

- [ ] **Step 1:** DB tests (Review Focus 1, 5): approved monthly 8 h policy, member hired 2026-01-10 → after running for 2026-04-15, three `earn` rows (Jan prorated, Feb, Mar) with explain JSON; running again posts nothing; a policy with `resetOn: '01-01'`, `carryover.max: 40`, balance 55 → one `expire` of −15 on the boundary, once; a failing member (bad data) doesn't block others; draft-only policies post nothing.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(worker): idempotent leave accruals and year-end carryover`.

### Task 9: Docs and full verification

**Files:** Modify `docs/DEVELOPMENT.md` (Leave section: banks, policy JSON reference with a worked example, ledger rules, approval scope, cancel/restore behaviour, interim JSON editor note).

- [ ] **Step 1:** Write docs. **Step 2:** `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → all pass. **Step 3:** Commit `docs: leave development guide`.

---

## Deferred (not in 1b)

- Comp time **earned from overtime**, pay codes, work periods, OT, holdovers → 1c. (1b only provides the bank, cap and manual earning.)
- Leave limits (max off per shift/day), blackout dates, vacation bidding, partial-shift (hourly) leave, documentation upload checks → 1d.
- Payout rules and payroll codes per leave type → 1c.
- No-code policy builder and simulation → 1e.
