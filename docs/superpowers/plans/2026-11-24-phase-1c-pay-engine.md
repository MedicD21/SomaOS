# Phase 1c-1 — Pay Engine (pay codes, work periods, overtime, comp time, dollars) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a pay period, compute for each member the hours and dollars by pay code — regular, contract overtime, FLSA 7(k) overtime, holdover/callback/acting premiums, paid leave, and comp time earned in lieu of cash — from scheduled shifts and approved leave, with an explanation for every line; let administrators customise all of it as versioned data; preview it on screen and export it as CSV.

**Architecture:** One pure function `computePay` in `@soma/schedule-engine` (no DB). Rules are a `pay.rules` config document per **employee group** (kind `pay.rules`, key = group key), versioned and effective-dated exactly like shift patterns and accrual policies. Pay codes, employee groups and member pay rates are tenant tables. A server loader gathers a period's shifts, approved leave and rates (as the signed-in user, RLS applies), calls the engine and returns lines. Nothing is hard-coded about any department: thresholds, multipliers, code names and combination policy are data.

**Tech Stack:** Existing stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §7.2 (work/pay codes, employee group, work period, comp time, timesheet, payroll export), §7.3 (pure engine, explain trace, no regulatory number in code), §5.9 (time).

## Global Constraints

- All earlier global constraints apply (strict TS, RLS + isolation test on every tenant table, DB-level scope-aware checks, no hard deletes of people/config, axe on every page test, phone layout without horizontal overflow).
- **No regulatory or contract number in engine code.** The FLSA work-period length and threshold (e.g. the 29 CFR 553.230 table), multipliers, comp-time cap and callback minimums live in rules data. Template values are **starter values** that an administrator must verify; they are created as drafts.
- Pay rates are **HR-sensitive**: only department-wide `pay.view` / `pay.manage` holders can read them; members cannot read each other's rates.
- Dollars are computed per line, rounded to cents per line (half away from zero), and totals are the sum of the rounded lines. Hours are rounded to 2 decimals.
- FLSA overtime is decided by hours **worked** in the **work period** (which can be longer than a pay period); work periods never overlap and thresholds reset at each one.
- Federal and contract overtime are computed separately and combined by a policy: `highest` (default) or `stack`.
- Out of scope for 1c-1 (see 1c-2): actual-time timesheets, holdovers entered after the fact, officer approval, payroll lock, ledger posting of comp time, payroll-system-specific export mappings, salary (non-hourly) members, FLSA "regular rate" adjustments for non-discretionary pay.

## Review Focus

1. **A work period longer than the pay period** (28-day FLSA period, 14-day pay period) → overtime appears only in the pay period where the threshold is crossed, and the split inside one shift is exact (e.g. 20 h regular + 4 h overtime). Test in Task 1.
2. **An overtime shift above the FLSA threshold** → paid once, at the higher of contract and FLSA under `highest`, and stacked only under `stack`. Test in Task 1.
3. **Paid leave that counts as time worked** → counts toward the threshold but is itself paid at the leave code, never as overtime. Test in Task 1.
4. **Comp time in lieu** → overtime hours produce comp credit and **no cash**; `member_choice` honours the member's preference. Test in Task 1.
5. **Missing rate, odd rounding, unknown assignment type** → null amounts (not zero), cents rounded per line, and a clear error naming the type. Test in Task 1.
6. **A member who cannot see pay** → cannot read rates, groups' rules drafts or other members' results. Test in Task 3.

---

## File Structure

```
packages/schedule-engine/src/pay.ts          PayRules, WorkSegment, LeaveSegment, computePay, workPeriodOf
packages/schedule-engine/tests/pay.test.ts
packages/validators/src/pay.ts               payRulesSchema (mirrors PayRules), payCodeSchema, payRateSchema, parsePayRulesJson
packages/auth/src/permissions.ts             + pay.view, pay.manage
supabase/migrations/20261124000019_pay.sql   pay_codes, employee_groups, members.employee_group_id, member_pay_rates
packages/db/tests/pay.test.ts
packages/templates/src/pay.ts                starter pay codes, group, DRAFT pay.rules
apps/web/src/server/pay/{load.ts,rules.ts}   period loader, rules versions (draft/approve)
apps/web/src/app/(app)/pay/{page.tsx,export/route.ts}        pay period preview + CSV
apps/web/src/app/(app)/admin/pay/{page.tsx,actions.ts,forms.tsx}   codes, groups, rates, rules
apps/web/e2e/pay.spec.ts
```

---

### Task 1: Pay engine (pure)

**Files:** Create `packages/schedule-engine/src/pay.ts`, `tests/pay.test.ts`; modify `src/index.ts`.

**Interfaces — Produces:**
```ts
export type WorkType = 'regular' | 'overtime' | 'trade' | 'holdover' | 'callback' | 'acting' | 'training' | 'detail';
export type AssignmentPay = { code: string; multiplier: number; countsTowardFlsa?: boolean /* default true */; minimumHours?: number };
export type PayRules = {
  payPeriod: AccrualPolicy['period'];                       // same shapes as accrual periods
  workPeriod: { days: number; anchor: IsoDate; threshold: number; multiplier: number; code: string };
  overtimeCombination: 'highest' | 'stack';
  assignments: Record<WorkType, AssignmentPay>;             // every type must be present
  compTime: { mode: 'never' | 'always' | 'member_choice'; multiplier: number; bankKey: string | null };
};
export type WorkSegment = { id: string; date: IsoDate; hours: number; type: WorkType };
export type LeaveSegment = { id: string; date: IsoDate; hours: number; code: string; countsAsWorked: boolean };
export type PayLine = {
  code: string; multiplier: number; hours: number; rate: number | null; amount: number | null;
  source: 'work' | 'leave' | 'callback_minimum'; compensated: boolean; explain: Explain[];
};
export type PayResult = {
  lines: PayLine[];
  totalHours: number;
  totalAmount: number | null;
  comp: { bankKey: string | null; hours: number };
  explain: Explain[];
};
export function workPeriodOf(wp: PayRules['workPeriod'], date: IsoDate): { start: IsoDate; endExclusive: IsoDate };
export function computePay(input: {
  rules: PayRules;
  hourlyRate: number | null;
  prefersComp: boolean;
  /** Everything from the start of the earliest work period touching the pay period. */
  segments: WorkSegment[];
  leave: LeaveSegment[];
  period: { start: IsoDate; endExclusive: IsoDate };
}): PayResult;
```
Behaviour: per work period, process worked segments (types counted toward FLSA) and counted leave in date order (ties by `id`), keeping a running total; the part of a worked segment above `threshold` is FLSA overtime at `workPeriod.multiplier`. Each worked hour's contract multiplier is its assignment's `multiplier`. `highest`: applied = max(contract, flsa), code = the winner's (contract code on ties); `stack`: applied = 1 + (contract−1) + (flsa−1), code = FLSA code when the hour is above threshold else the contract code. Only segments/leave dated inside `period` produce lines (earlier ones still count toward the running total). Lines are grouped by (code, multiplier, source, compensated) and sorted by code. Callback segments with `minimumHours` greater than their hours add a `callback_minimum` line for the shortfall (does not count toward FLSA). Leave lines: multiplier 1, `source: 'leave'`. Comp: lines with multiplier > 1 from work (not leave, not minimum) are `compensated` when mode is `always`, or `member_choice` with `prefersComp`; they carry amount 0 and add `hours × compTime.multiplier` to `comp.hours`. Amount = round-half-away(rate × multiplier × hours, 2), null when `hourlyRate` is null. Throws `RangeError('Pay rules have no code for assignment type "<type>"')` when a used type is missing.

- [ ] **Step 1:** Tests (names + assertions with the spec's numbers): `workPeriodOf` aligns to the anchor (28 days, anchor 2026-01-01 → 2026-01-29 belongs to [2026-01-29, 2026-02-26)); straight time below the threshold → one REG line, amount = rate × hours; **FLSA crossing inside a shift**: ten 24 h shifts in one 28-day work period, threshold 212 → REG 212 h and OT 28 h, with the 9th shift split 20 REG + 4 OT (checked through a pay period that contains only shifts 9–10); **work period longer than pay period**: 5 shifts in each 14-day half → first period 120 h REG, second period 92 h REG + 28 h OT; thresholds reset in the next work period; `highest` vs `stack` for an `overtime`-type shift above the threshold (1.5 vs 2.0) and below it (1.5 both); holdover and acting map to their own codes; callback of 1 h with minimum 2 h → work line 1 h plus `callback_minimum` 1 h and FLSA total unchanged; leave with `countsAsWorked: true` raises the running total (OT begins sooner) but is paid as its leave code at ×1, and `countsAsWorked: false` does not; comp time `always` → no cash on OT lines, `comp.hours = OT hours × 1.5`; `member_choice` follows `prefersComp`; rate `null` → null amounts and `totalAmount` null; rounding: rate 23.4567 × 7.5 h × 1.5 = 263.89; unknown type throws the named error; every OT line carries an explain mentioning the threshold and work-period start.
- [ ] **Step 2:** `pnpm -F @soma/schedule-engine test` → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(schedule-engine): pay engine with work periods, overtime and comp time`.

### Task 2: Validators and permissions

**Files:** Create `packages/validators/src/pay.ts`, `tests/pay.test.ts`; modify `packages/auth/src/permissions.ts`, `packages/validators/src/index.ts`.

**Interfaces — Produces:** `payRulesSchema` (mirrors `PayRules`; rejects: any missing assignment type, non-positive `days`/`threshold`, multipliers below 1 or above 5, comp mode ≠ never without a multiplier ≥ 1, unknown combination, empty codes), `parsePayRulesJson(text)` (same friendly-error shape as `parseAccrualPolicyJson`), `payCodeSchema` `{ label, key?, kind: 'regular'|'overtime'|'premium'|'leave'|'other', multiplier ≥ 0, countsTowardFlsa, exportCode? }`, `employeeGroupSchema` `{ label, key? }`, `payRateSchema` `{ memberId, hourlyRate (> 0, ≤ 1000, 4 decimals), effectiveFrom, note? }`. Permissions `pay.view`, `pay.manage` (module `pay`, sensitive HR).

- [ ] **Step 1–5:** Tests for each accept/reject above and `isPermission('pay.manage')`; implement; commit `feat: pay validators and permissions`.

### Task 3: Pay schema and RLS

**Files:** Create `supabase/migrations/20261124000019_pay.sql`, `packages/db/tests/pay.test.ts`.

**Interfaces — Produces tables (tenant-scoped, RLS, audit):** `pay_codes(id, tenant_id, key, label, kind, multiplier numeric(5,3), counts_toward_flsa bool, export_code text, sort, archived_at, unique(tenant_id,key))`; `employee_groups(id, tenant_id, key, label, archived_at, unique)`; `members.employee_group_id uuid null` (composite FK); `member_pay_rates(id, tenant_id, member_id, hourly_rate numeric(10,4) > 0, effective daterange, note, created_by, created_at; exclusion: member_no_overlap on effective)`. RLS: codes and groups readable by the tenant, written by department-wide `pay.manage`; **rates readable and writable only by department-wide `pay.view` (read) / `pay.manage` (write)**; no hard deletes. `app.pay_rate_on(p_member uuid, p_date date) returns numeric` (definer; department-wide `pay.view` only).

- [ ] **Step 1:** Tests: isolation for the three tables; members and plain officers cannot read `member_pay_rates` (0 rows) while `pay.view` holders can; org-unit-scoped `pay.manage` cannot write; overlapping rate ranges rejected, back-to-back allowed; non-positive rate rejected; `pay_rate_on` returns the rate for a date inside a range, null outside, and errors for non-holders; RLS-coverage test stays green.
- [ ] **Step 2–5:** FAIL → migration → PASS (`pnpm db:reset && pnpm test:db`) → commit `feat(db): pay codes, employee groups and member pay rates`.

### Task 4: Templates

**Files:** Create `packages/templates/src/pay.ts`, tests; modify `types.ts`, both templates, `roles.ts`, `apply.ts`, `scripts/seed-dev.ts`.

Starter pay codes (REG, OT, HOLDOVER, CALLBACK, ACTING, plus each leave type's code), employee group `default`, and a **draft** `pay.rules` (key `default`) whose threshold, multipliers and combination are clearly marked starter values. Roles: `payroll_hr` gets `pay.view`, `pay.manage`; `dept_admin` all. Seed gives the demo members example hourly rates.

- [ ] Tests: payload parses with `payRulesSchema`; applying twice is idempotent; the rules are draft; volunteer template has no pay codes beyond REG. Commit `feat(templates): starter pay codes, group and draft pay rules`.

### Task 5: Pay period loader and rules versions (server)

**Files:** Create `apps/web/src/server/pay/{load.ts,rules.ts}`, DB-backed tests.

`loadPayPeriod(tx, period, groupKey)` → per member: group, rate on the period, shifts (scheduled, non-Kelly, `type` mapped to `WorkType`, hours = scheduled wall-clock hours, from the start of the earliest work period touching the period), approved leave `use` entries as leave segments (code from the leave type's key; `countsAsWorked` from the type), then `computePay`. `listRuleVersions` / `saveRulesDraft` / `approveRulesDraft` mirror `server/leave/policies.ts` (effective-dated; approval needs `pay.manage` and `admin.config.manage`).

- [ ] Tests: a seeded member with ten generated shifts and approved leave produces the engine's expected lines; a member without a rate gets null amounts; members of other groups are not mixed in; a draft-only group produces a clear "no approved pay rules" result rather than guessing.

### Task 6: Pay period preview, CSV export and pay admin (web)

Pages: **Pay → period preview** (period picker defaulting to the current pay period; per-member totals; open a member to see every line with its explanation; phone-friendly lists, no wide tables), **CSV export** route (permission-checked; one row per member and pay code: member, employee number, code, export code, hours, rate, amount; comp credits as their own rows), and **Admin → Pay** (codes, groups and group assignment, rates with effective dates, rules JSON editor with preview and draft/approve — same pattern as leave policies).

- [ ] Playwright (`pay.spec.ts`): admin approves rules and sets a rate; the preview shows REG and OT lines with explanations for a generated month; CSV downloads with the expected rows; a member without `pay.view` gets "Not allowed"; axe and 390 px layout clean.

### Task 7: Docs and full verification

- [ ] `docs/DEVELOPMENT.md` Pay section (concepts, rules reference with a worked example, combination policy, comp time, what 1c-1 does not do). `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → pass. Commit `docs: pay development guide`.

---

## Deferred to 1c-2 and later

Timesheets of **actual** time (holdovers entered after the fact, early relief), officer approval, payroll lock, posting comp time to the leave ledger, per-payroll-system code mappings and file formats, salary members, regular-rate adjustments for non-discretionary pay, retroactive recalculation and audit of changes, state-specific rules, and the no-code rule builder with simulation (1e).
