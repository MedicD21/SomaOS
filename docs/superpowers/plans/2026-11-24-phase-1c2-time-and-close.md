# Phase 1c-2 — Actual Time and Payroll Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let officers record time that differs from the schedule (holdovers, callbacks, extra hours) after the fact, and let payroll **close a pay period**: freeze exactly what was calculated, credit comp time earned to the leave balance, and lock the period against changes until it is deliberately reopened.

**Architecture:** `time_entries` are extra worked time that feeds the 1c-1 pay engine as additional work segments. Every write goes through `security definer` SQL functions that check the caller's scope in SQL (the same approach as leave). `pay_period_closes` stores a **snapshot** of the calculated period plus the comp credits it posted; closing posts comp credit to the leave ledger idempotently, and reopening reverses it. A closed period is read from its snapshot, so later edits to rules, rates or shifts cannot change what was closed.

**Tech Stack:** Existing stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §7.2 (timesheet / actual time, officer approval, payroll lock, comp time), §5.8 (append-only records, amendments), §7.3 (explain, reproducibility).

## Global Constraints

- All earlier global constraints apply (strict TS, RLS + isolation test on every tenant table, scope checks in SQL, no hard deletes, axe on every page test, phone layout without horizontal overflow, ledger append-only).
- **Nobody records or voids time for themselves.** Officers need `scheduling.roster.edit` covering the member's station and shift; payroll needs department-wide `pay.manage`.
- **A closed pay period is locked:** time entries dated inside it cannot be added or voided; a closed period always shows its snapshot, never a recalculation.
- Time entries are **never edited or deleted**: a mistake is voided (with a reason) and re-entered, so the audit trail shows both.
- Closing and reopening are all-or-nothing and **idempotent**: comp credit is posted once per close (`run_key = 'comp:<close id>'`) and reversed once on reopen.
- Closing requires a clean period: no member with an unresolved problem (for example no approved pay rules).
- Out of scope: early-relief (negative) adjustments, per-payroll-system file formats, mid-period rate or rule changes, scoped officer *approval* sign-off of whole timesheets (payroll close is the approval step for now).

## Review Focus

1. **Someone entering time for themselves, or for a member outside their station or shift** → refused by the database. Test in Task 2.
2. **Adding or voiding time in a closed period** → refused with a clear message. Tests in Tasks 1 and 2.
3. **Closing twice, or reopening twice** → no double comp credit and no double reversal. Test in Task 1.
4. **Rules, rates or shifts change after a close** → the closed period still shows the original numbers. Test in Task 3.
5. **A member with no approved rules at close time** → close is refused, not guessed. Test in Task 4.

---

## File Structure

```
supabase/migrations/20261124000020_pay_close.sql     pay_period_closes, is_date_closed, close_pay_period, reopen_pay_period
supabase/migrations/20261124000021_time_entries.sql  time_entries, grant_covers_member, can_edit_time, add_time_entry, void_time_entry
packages/db/tests/pay-close.test.ts
packages/db/tests/time-entries.test.ts
packages/validators/src/time.ts                      timeEntrySchema, closeSchema
apps/web/src/server/pay/load.ts                      + time entries as work segments; closed snapshot
apps/web/src/server/pay/close.ts                     closePayPeriod / reopenPayPeriod (server side)
apps/web/src/app/(app)/time/{page.tsx,actions.ts,forms.tsx}   record and void time
apps/web/src/app/(app)/pay/{page.tsx,actions.ts,close-forms.tsx}   close / reopen controls
apps/web/e2e/time-close.spec.ts
```

---

### Task 1: Pay period close (schema + functions)

**Interfaces — Produces:**
- `pay_period_closes(id, tenant_id, period_start date, period_end date /* exclusive */, status 'closed'|'reopened', snapshot jsonb, comp_posted jsonb, closed_by, closed_at, reopened_by, reopened_at, reopen_reason)`; `check (period_end > period_start)`; exclusion `pay_period_closes_no_overlap` on `(tenant_id, daterange(period_start, period_end))` where `status = 'closed'`; select only for `app.can_view_pay()`; no direct writes; audited.
- `app.is_date_closed(p_date date) returns boolean` (definer): an active close covers the date.
- `app.close_pay_period(p_start date, p_end date, p_snapshot jsonb, p_comp jsonb) returns uuid` — department-wide `pay.manage`; `p_comp` is `[{member_id, bank_key, hours}]`; posts one `earn` ledger row per entry (`run_key 'comp:<close id>'`, `effective_date = p_end - 1`, note `Comp time earned <start> to <end-1>`), records them in `comp_posted`.
- `app.reopen_pay_period(p_close uuid, p_reason text) returns void` — same permission, reason ≥ 5 characters, close must be `closed`; posts one `reversal` per posted credit (`run_key 'comp-reversal:<close id>'`); sets `reopened`.

- [ ] **Step 1:** Tests: only department-wide `pay.manage` can close/reopen (org-unit-scoped and `pay.view` refused); closing posts comp credit once and the balance reflects it; a second close of the same period is refused (`overlaps a closed period`); reopening reverses the credit exactly once and a second reopen errors; after reopen the period can be closed again with a fresh credit; `is_date_closed` true inside `[start,end)` and false on the end date and after reopen; unknown comp bank key refused with a clear message; reason shorter than 5 refused; members cannot read closes; isolation; RLS coverage stays green.
- [ ] **Steps 2–5:** FAIL → migration → `pnpm db:reset && pnpm test:db` PASS → commit `feat(db): pay period close and reopen`.

### Task 2: Time entries (schema + functions)

**Interfaces — Produces:**
- `time_entries(id, tenant_id, member_id, work_date, hours numeric(5,2) in (0,48], type in the eight work types, reason (≥ 5 characters), status 'active'|'void', created_by, created_at, voided_by, voided_at, void_reason)`; select for the member's own rows, `app.can_view_pay()`, or `app.can_edit_time(member_id)`; no direct writes; audited.
- `app.grant_covers_member(p_perm text, p_member uuid) returns boolean` — the caller holds `p_perm` with a grant covering the member's current station (primary assignment, else standing seat) and shift; department scope covers anyone; never for oneself.
- `app.can_edit_time(p_member uuid) returns boolean` — `grant_covers_member('scheduling.roster.edit', …)` or department-wide `pay.manage` (never oneself).
- `app.add_time_entry(p_member uuid, p_date date, p_hours numeric, p_type text, p_reason text) returns uuid`; `app.void_time_entry(p_id uuid, p_reason text) returns void`. Both check `can_edit_time`, refuse closed dates (`That pay period is closed`), require reasons.

- [ ] **Step 1:** Tests (Review Focus 1, 2): scoped officer can add for a member in their station and shift but not another station or shift; nobody for themselves; payroll (department `pay.manage`) can for anyone; closed date refused for add and void; reason and hours validated; a void keeps the row (`status void`, who and why) and cannot be repeated; members see only their own entries; officers see only entries they could edit; isolation.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): time entries with scoped add and void`.

### Task 3: Validators and loader

**Files:** `packages/validators/src/time.ts`; modify `apps/web/src/server/pay/load.ts`.

`timeEntrySchema { memberId, workDate, hours (0 < h ≤ 48, 2 dp), type, reason ≥ 5 }`. `loadPayPeriod` now (a) adds active time entries dated in `[loadFrom, endExclusive)` as work segments (`id 'time:<id>'`, their type), and (b) when a close exists for exactly the period, returns the stored snapshot with `closed: { id, closedAt, closedBy }` instead of recalculating; otherwise `closed: null`.

- [ ] **Tests (web DB):** a holdover entry appears as a `hold` line and adds to totals; a voided entry does not; entries before the period still count toward the work-period threshold; **after closing, changing a rate, the rules or the roster leaves the loaded numbers unchanged** (Review Focus 4), and reopening makes the page live again.
- [ ] Commit `feat(web): time entries and closed snapshots in the pay loader`.

### Task 4: Close and reopen (server) and the pages

**Files:** `apps/web/src/server/pay/close.ts`; `apps/web/src/app/(app)/time/*`; `apps/web/src/app/(app)/pay/{actions.ts,close-forms.tsx,page.tsx}`; nav entry `Time` for `scheduling.roster.edit` / `pay.manage` holders.

`closePayPeriod(tx, period)` recomputes live, refuses when any row has a `problem` (Review Focus 5), builds the comp list (`bankKey` + hours per member) and calls `app.close_pay_period`. **Time page:** members of the department with entry form (member, date, hours, type, reason) and recent entries with *Void*. **Pay page:** banner when closed (who, when) with *Reopen* (reason), otherwise *Close pay period* with the comp credits that will be posted.

- [ ] **Playwright (`time-close.spec.ts`):** scoped officer records a holdover for a member in their station, an officer elsewhere is refused; payroll sees the holdover line on the pay period; payroll closes → banner, comp credit appears in the member's comp balance and the ledger; adding time in the closed period is refused; changing a rate does not move the closed numbers; reopening reverses the credit and unlocks; members see none of it; axe and 390 px layout clean.
- [ ] Commit `feat(web): record time and close or reopen pay periods`.

### Task 5: Docs and full verification

- [ ] Extend the Pay section of `docs/DEVELOPMENT.md` (actual time, close and reopen, what is frozen, comp posting). `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → pass. Commit `docs: time entries and payroll close`.

---

## Deferred

Early-relief (negative) adjustments, whole-timesheet officer sign-off before close, per-payroll-system formats, salaried members, mid-period rate/rule changes, scheduled-pay vs actual variance reports, and the no-code rule builder (1e).
