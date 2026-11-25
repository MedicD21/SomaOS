# Phase 1e — Guided Rule Builder with Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON textareas for **pay rules**, **leave accrual policies** and **shift patterns** with guided forms that read and write the **same versioned JSON**, explain in plain English what each draft means, let an administrator **simulate** a draft against real data (draft vs the approved rules, side by side, nothing written), compare versions, and block approving anything invalid or unsimulated.

**Architecture:** Zero new storage. Drafts and approvals stay in `config_versions` (`pay.rules`, `leave.accrual`, shift pattern kind) through `saveDraft` / `approveDraft`. A small **schema-driven form layer** renders a per-kind *field spec* (label, plain-English help, unit, input type, path into the JSON); the zod schemas in `@soma/validators` remain the single source of validation, with issues mapped back to field paths. Pure helpers (`describe*`, `diffConfig`, simulation runners) live in framework-free code and reuse `computePay`, `earnForPeriod`, `expandPattern` unchanged. Simulation server actions run **read-only** under the caller's RLS context and write nothing. "Simulation required" is enforced **statelessly** with a short-lived signed token over `(tenant, kind, key, version, sha256(payload), user)`, so no table is needed.

**Tech Stack:** Existing stack. No new dependencies (diff and describe are small pure functions).

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §5.6 (customization framework, versioned config), §7.3 (explain traces; simulation shows "a diff vs current"), and the note that the no-code rule builder lands in Phase 1 before a second department. Existing editors: `apps/web/src/app/(app)/admin/{pay,leave,scheduling/patterns}`. Dev guide: Pay, Leave and accruals, Scheduling sections of `docs/DEVELOPMENT.md`.

## Global Constraints

- All earlier global constraints apply (strict TS, test first, permission checks on the server, audit, axe on every page test, 390 px layout without horizontal overflow, no hard deletes, approved versions immutable).
- **Same JSON, same storage.** The form edits the exact `PayRules` / `AccrualPolicy` / `ShiftPattern` documents; "Advanced JSON" shows and edits that document, and switching views never loses data (form to JSON is lossless; JSON to form is refused with field-level errors if the text is invalid).
- **The schemas stay authoritative.** No second rule set in the UI. Field help may add *advice* (e.g. "usually 212 h for a 28-day period; verify against your agreement") but never decides validity. Regulatory numbers stay data and are labelled "starter value, verify".
- **No new rule kinds.** The builder exposes only fields that already exist in the three schemas.
- **Simulation never writes:** it runs in `withCtxDb` with no inserts, ledger rows or audit-triggering updates, and needs the same permission as seeing the real result (pay: department-wide `pay.view`; accrual: `leave.manage`; patterns: `scheduling.config.manage`). Draft text is validated before it reaches an engine.
- **Approval guardrails (server-enforced, not just hidden buttons):** the draft must pass its schema **and** reference checks (pay codes exist and are not archived, comp-time bank exists, every platoon key is a real shift), and approving needs a valid simulation token for exactly this draft. Existing approve permissions and the "date after the current version's start" rule are unchanged.
- Out of scope: new rule kinds, drag-and-drop visual programming, importing from other systems, simulating rate changes or leave limits, multi-person approval chains.

## Review Focus

1. **Approve bypass:** a crafted POST that skips simulation, replays a token for an older payload, or approves an invalid or stale draft is refused. Task 4.
2. **Form/JSON drift:** form to JSON and back yields an identical document; unknown fields in hand-edited JSON are never silently dropped. Task 2.
3. **Simulation honesty:** the "approved" column equals what the real Pay page / accrual worker produce for the same inputs; the draft column uses only the draft; nothing persists. Task 3.
4. **Permission leak:** simulation reveals dollars and rates, so it must not be callable by anyone who cannot already see them. Task 3.
5. **Plain-English text is correct:** `describe*` output matches engine behaviour for edge settings (stack vs highest, comp `member_choice`, `fixed_days`, Kelly). Golden tests in Task 1.

---

## File Structure

```
packages/validators/src/rule-fields.ts          issuesToFieldErrors(issues) -> {dotted.path: message}
packages/schedule-engine/src/describe.ts        describePayRules, describeAccrualPolicy, describePattern -> string[] (pure)
packages/schedule-engine/src/diff.ts            diffConfig(a, b) -> {path, before, after}[] (pure)
packages/schedule-engine/src/simulate.ts        projectAccrual, comparePatterns, samplePay (pure wrappers on existing engines)
packages/schedule-engine/test/{describe,diff,simulate}.test.ts
apps/web/src/server/rules/specs.ts              field specs per kind (label, help, unit, input, path)
apps/web/src/server/rules/refs.ts               reference checks against pay_codes / banks / shifts (read-only)
apps/web/src/server/rules/sim-token.ts          sign/verify simulation token (HMAC, 30 min, bound to payload hash + user)
apps/web/src/server/pay/load.ts                 calculatePayPeriod gains optional rulesOverride (default behaviour unchanged)
apps/web/src/components/rule-builder/           RuleBuilder, FieldGrid, JsonToggle, ExplainPanel, DiffView, SimulationResult
apps/web/src/app/(app)/admin/{pay,leave,scheduling/patterns}/   swap textarea panels for RuleBuilder; add simulate actions
apps/web/e2e/rule-builder.spec.ts
```

---

### Task 1: Pure helpers (describe, diff, field errors), test first

**Interfaces — Produces:**
- `describePayRules(r: PayRules): string[]`, one sentence per rule, e.g. "Overtime starts after 212 h in each 28-day work period (anchored 2026-01-01) and is paid at 1.5x under `ot`." / "An hour that is both contract and federal overtime pays the larger multiplier once." / "Callbacks are guaranteed 2 h; the top-up is paid but is not time worked." / "Overtime is never taken as comp time."
- `describeAccrualPolicy(p)` (tiers by years of service, cap, waiting period, proration, part-time fractions, carryover reset); `describePattern(p, shiftKeys)` ("24 h on, 48 h off", average hours per week, platoon offsets, Kelly day every Nth shift).
- `diffConfig<T>(a: T | null, b: T): { path: string; before: unknown; after: unknown }[]`: leaf-level, paths like `tiers.1.earn.hours`, array items matched by index, stable order.
- `issuesToFieldErrors(issues): Record<string, string>`: keyed by dotted path, first message per path, zod defaults rewritten to plain English ("Enter a number between 0 and 5").

- [ ] **Step 1:** Golden tests (Review Focus 5) for each `describe*` against the template starter values and edge settings (`stack`, `member_choice` with and without `bankKey`, `fixed_days` pay period, `annual_front_load`, `manual` earn, `cap: null`, Kelly every 3rd shift, 48/96). `diffConfig`: no-op, nested change, added and removed tier, `null` before (first draft). `issuesToFieldErrors`: tier ordering maps to `tiers.1.fromYears`; the `compTime.bankKey` cross-field issue lands on that field.
- [ ] **Steps 2–5:** FAIL → implement → `pnpm test:unit` PASS → commit `feat(schedule-engine): describe and diff rule documents`.

### Task 2: Schema-driven form layer and Advanced JSON toggle

**Files:** `apps/web/src/server/rules/specs.ts`; `apps/web/src/components/rule-builder/*`; the three admin `forms.tsx`.

`FieldSpec = { path, label, help, input: 'number'|'text'|'date'|'select'|'toggle'|'time', unit?, options?, min?, max?, step?, advice? }`. `RuleBuilder` takes `{ kind, spec, value, schema, describe, onSave }` and renders sections: **Pay** (*Pay period*, *Overtime threshold*, *Pay code per kind of work* as a table, *Comp time*); **Accrual** (*Period*, *Tiers* with add/remove row, *Cap and waiting period*, *Carryover*, *Part-time fractions* as key/amount rows); **Pattern** (*Cycle* as On/Off day toggles with presets 24/48, 48/96, 24/72, Pitman, *Start and length*, *Platoon offsets* per department shift, *Kelly*). Every input has a visible label, `aria-describedby` help and an inline `aria-live` error from `issuesToFieldErrors`; it validates on blur and on save. A **"What this means"** panel (the explain-style preview from `describe*`) updates as the draft changes. **Advanced JSON** is the current textarea kept in a disclosure, bound to the same value.

- [ ] **Tests (component):** a drift test fails if a schema field has no spec or a spec path is not in the schema; an invalid value shows its plain-English message beside the right field and focus moves to the first error; form -> JSON -> form is identical (Review Focus 2); hand-edited unknown keys are kept in a preserved bag and shown as a warning; tier add/remove keeps ordering errors visible; at 390 px the grid is one column, touch targets are at least 44 px.
- [ ] Commit `feat(web): guided rule builder form layer`.

### Task 3: Simulation (engine wrappers, server actions, side-by-side panel)

**Files:** `packages/schedule-engine/src/simulate.ts`; `apps/web/src/server/pay/load.ts` (+ `rulesOverride?: Map<groupKey, PayRules>`); `apps/web/src/server/rules/simulate.ts`; `simulatePay` / `simulateAccrual` / `simulatePattern` actions beside each page's actions; `SimulationResult` component.

- **Pay.** Inputs: group, pay period start (default: current period), optional one member. Validates the draft, then calls `calculatePayPeriod` twice for that group's members: as today (approved) and with `rulesOverride` = the draft. Output per member: hours and dollars by pay code in both columns, the delta, overtime and comp hours, and the first explain line for each changed code; totals row. A member without approved rules shows "no approved rules" in that column (never guessed). **Sample mode** (works before any shifts exist): pick a work type, shift length, count (e.g. ten 24 h regular shifts then a 4 h callback) and a sample hourly rate, then `computePay` runs on both rule sets. Note: "A pay period uses the rules in force on its first day."
- **Accrual.** Pick a member (real hire date, employment type, balance) or enter sample facts; `accrualPeriods` + `earnForPeriod` project the next 12 periods for draft and approved with running balance, cap reached, carryover expiry and each period's explain text. Hours-worked facts for `per_hours_worked` come from sample input and are labelled as such.
- **Pattern.** Pick a platoon and range (default 8 weeks): `expandPattern` for both, shown as two day strips, with hours per 28 days, average hours per week and the dates that change, plus how many generated shifts approving would supersede (the count `approvePatternDraft` already computes, read-only).
- Each run returns a **simulation token**; the panel shows "Simulated draft v3 at 14:02" and the approve form carries the token.

- [ ] **Tests (web DB):** the approved column equals `calculatePayPeriod` for the same period and the draft column differs only where the rules differ (Review Focus 3); running a simulation twice leaves row counts of `config_versions`, `leave_ledger` and the audit log unchanged; an org-unit-scoped or `pay.view`-less user is refused (Review Focus 4); invalid draft text is refused with field errors before any engine runs; a closed period simulates against live data and is labelled "simulation, not the closed snapshot"; a group with no approved rules still produces the draft column.
- [ ] **Unit tests:** accrual projection respects cap, carryover and waiting period; pattern comparison marks exactly the changed dates; sample pay reproduces the Pay doc example (20 h regular + 4 h overtime split).
- [ ] Commit `feat(web): simulate pay, accrual and pattern drafts against approved rules`.

### Task 4: Diff view, guardrails and approve flow

**Files:** `apps/web/src/server/rules/{refs.ts,sim-token.ts}`; `DiffView`; changes to `approveRules`, `approvePolicy`, `approvePattern`.

- **Diff view:** each document lists its versions (`listVersions`); *Compare* picks any two (default: draft vs current approved) and renders `diffConfig` as "Setting / before / after" using spec labels (dotted path as fallback), plus the `describe*` sentences that changed. Read-only; visible to anyone who can see the editor.
- **Reference checks (`refs.ts`, read-only):** pay: every `assignments.*.code` and `workPeriod.code` is an existing, non-archived pay code, and `compTime.bankKey` is an existing bank; accrual: the policy key is an existing bank; pattern: every platoon key is a department shift and every shift has an offset. Warnings in the form, **hard errors at approve**.
- **Approve guard:** approve actions reload the draft by `(key, version)`, re-run schema and refs, and verify the token (signature, not expired, same user, same payload hash and version). Specific refusals: "Simulate this exact draft first" / "The draft changed since you simulated it". Saving the draft changes its hash, so the token dies by construction. The approval `reason` string includes the simulated period and token id, so the existing `config_versions` audit trigger records it. The Approve button is disabled with an explanation until a simulation exists; the server is the enforcement.
- `SIMULATION_REQUIRED = true` is a single constant, readable from tenant settings later (open question 1).

- [ ] **Tests (web DB):** token missing, expired, another user's, for an older payload hash or another key -> refused; invalid or reference-broken draft refused even with a valid token (Review Focus 1); edit after simulate -> must re-simulate; happy path approves and the audit row carries the reason; `pay.manage` without `admin.config.manage` still cannot approve; past effective dates still catch up as today; existing approve tests stay green.
- [ ] Commit `feat(web): rule diff, reference checks and simulation-gated approval`.

### Task 5: Pages, e2e and docs

**Files:** the three admin pages; `apps/web/e2e/rule-builder.spec.ts`; `docs/DEVELOPMENT.md`.

Per document, in keyboard order: status line (existing), builder form, "What this means", **Simulate** (disabled until the draft is valid), result panel, **Compare versions**, **Advanced JSON**, existing approve-from-date form. Result tables are real `<table>`s with captions and scroll inside their own container at 390 px.

- [ ] **Playwright (`rule-builder.spec.ts`):** payroll admin changes the overtime threshold in the form and the plain-English sentence updates; an invalid multiplier shows the field error and blocks Save; Advanced JSON shows the same document and an edit there appears in the form; Simulate shows draft vs approved dollars for a real period with the expected delta; **Approve is disabled until simulated and a tampered POST is refused**, then approval from a date succeeds and the Pay page uses the new rules; accrual: change a tier, simulate a member, approve; pattern: change the cycle, see the day strips and the "shifts that would be replaced" count, approve; a user without permission sees none of it; axe clean on all three pages including result panels; 390 px has no horizontal overflow.
- [ ] Update `docs/DEVELOPMENT.md`: replace the "guided editor is planned / comes in Phase 1e" notes in the Pay, Leave and Scheduling sections; document simulation, the approval guard and how to add a field spec. Run `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` -> pass. Commit `docs: guided rule builder`.

---

## Migrations

**None expected.** Drafts and versions use `config_versions`; simulation results and tokens are not stored. Only if the owner wants a durable simulation record (open question 3) would a small table or column be needed; deferred by default.

## Deferred

New rule kinds, drag-and-drop programming, import from other systems, simulating rate changes and leave limits, multi-step approval chains, scheduled "approve on date" for a draft, simulation history, per-field change comments, department-wide payroll cost reports.

## Open Questions for the Owner

1. **Is simulation mandatory for every approval?** Recommended default: yes for pay rules, accrual policies and patterns (they move money, balances and rosters); no tenant switch in v1, one constant to relax later.
2. **What satisfies "simulated" for pay?** Recommended default: any real period or the sample mode, as long as the draft hash matches; we do not require a particular period or a "clean" result.
3. **Keep a durable simulation record (who, when, summary)?** Recommended default: no for v1; the approval audit reason names the simulated period and token. Revisit with a small table if auditors ask.
4. **Who may simulate?** Recommended default: exactly those who can already see the real result (department `pay.view`, `leave.manage`, `scheduling.config.manage`); no new permission.
5. **Unknown keys in hand-edited JSON?** Recommended default: preserve and warn, never drop silently; approval is still blocked if the schema rejects them.
6. **Which sample inputs ship first?** Recommended default: real member/period plus one sample mode per kind as planned; no import of historical payroll for comparison.
7. **Must a second person approve (drafter cannot approve own draft)?** Recommended default: not in 1e, since small departments may have one administrator; flag as a follow-up.
