# Phase 3b — Medication Inventory and Controlled-Substance Chain of Custody

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The smallest useful framework for tracking regulated medications from receipt to administration or waste: controlled **items with lots and expiry**, **custody locations** (vault, station, unit, drug box, member) whose balances are derived from an **append-only, hash-chained custody ledger** where every movement names a member; **witnessed** waste; **bound shift/unit counts** that raise a **discrepancy record** when counted differs from expected; an officer-approved discrepancy workflow that never deletes; **seal tracking** for drug boxes; and **expiry and recall views**. SomaOS records and surfaces; it does not decide what is legally required (see Compliance Boundary).

**Architecture:** Same pattern as Phases 1c and 3a. All writes go through `security definer` functions in schema `app` that check scope in SQL; tables have no direct write policies. The custody ledger is its own table (3a pinned `items.is_controlled` to false and left `stock_ledger` alone, as planned). Balances are views over the ledger. Each location has its own **hash chain**: a new row's hash covers the previous row's hash plus its own fields, and writes to one location are serialized by locking that location row. Anything that needs a second person starts as a **witness request** that the witness confirms from their own session; the ledger row is written only then, so a witness is always an authenticated, different member.

**Tech Stack:** Existing stack. No new dependencies (`sha256()` is built into Postgres).

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §5.7 (append-only transactions), §5.8 (no hard deletes, audit), §6 Phase 3b row (primary-source verification of 21 CFR 1301/1304/1305/1317 comes first). Research: `docs/research/03-inventory-assets.md` A3 (DEA rule, workflow requirements A3.3), data-model items 4-6, A4; `docs/research/05-platform-rbac-market.md` (separation of duties). Builds on Phase 3a: `stock_locations`, `checklist_completions`, the Drug Inventory starter checklist, `app.has_permission_unit`.

## Global Constraints

- All earlier global constraints apply: strict TS, `tenant_id` on every table, **composite FKs** `(tenant_id, x_id)`, RLS + a cross-tenant isolation test per table, scope checks in SQL (never only in the web layer), audit trigger on every table, no hard deletes, ledgers append-only (`forbid_mutation` triggers on update, delete and truncate, plus `revoke`), permissions in the catalog and role templates, nav entry, axe on every page test, 390 px layout without horizontal overflow.
- **Every movement is attributed.** `performed_by` is the caller's own member, stamped in SQL, never a parameter. Nobody records for someone else.
- **Four separate permissions, none implying another:** `custody.record` (move, administer, count, at the location's unit), `custody.witness` (confirm witness requests), `custody.audit` (read-only: ledger, chains, counts, discrepancies, all units), `custody.manage` (catalog, lots, locations, seals, adjust, resolve discrepancies, recalls). Department Admin gets none by default; the Medical Director and a new **Controlled-Substance Officer** template get `audit` and `manage`; Company Officer and Member (career) get `record` and `witness`; Read-only Auditor gets `audit`. `record` and `manage` do not include `audit` of other units.
- **The witness must be a different member** from the performer, hold `custody.witness` at the location's unit, and confirm from their own session. Enforced in SQL by a check and by the confirm function; the same rule applies to the second person on a count.
- **Quantities** are `numeric(12,3)` in the item's unit (mg, mL, each). A movement may never take a location below zero (refused, not clamped). Mistakes are corrected only by a witnessed `adjust` with a reason, never by editing.
- **Discrepancies are never deleted or edited**; they move through statuses by appending events. Resolution needs `custody.manage` and must be a member who was neither the counter nor the witness of that count.
- `reference` on ledger rows is a free-text field (e.g. a run or incident number). It must not hold patient names; the form says so. No ePCR linkage beyond this field.
- Out of scope: ePCR integration and automatic decrement, purchasing and ordering (DEA Form 222 / CSOS), vendor integration, barcode or smart-safe hardware, DEA registration and designated-location records, destruction (Form 41), biennial inventory, notification deadline timers, state rule configuration, PowerSync offline, step-up PIN or biometric auth.

## Compliance Boundary

SomaOS does not assert what the law requires. The table separates what the research reports as regulatory from what this plan builds as department policy; every row with an entry under *Confirm* goes to counsel and the medical director before release (Task 8 turns this into a checklist in `docs/DEVELOPMENT.md`). Research flags several section numbers and the wastage rules as unverified or conflicting.

| Topic | Source of the rule (per research A3) | In this phase | Confirm |
|---|---|---|---|
| Records of receipts and deliveries between locations, retention (reported as 2 years; 21 CFR 1304.04 / 1304.27) | Reported DEA | Ledger keeps every row indefinitely; no purge function exists | Retention period; required data elements; whether ledger fields satisfy 1304.27 |
| Secure storage in a locked cabinet or vehicle (21 CFR 1301.80) | Reported DEA | Seal and lock tracking is a record only, not a control | Whether seal/lock events are expected as records at all |
| Theft or significant loss reporting (one business day; Form 106) | Reported DEA | Discrepancy has an `escalated` status and a free-text report reference; no timers, nothing filed | What counts as "significant"; who decides; timers later |
| Waste of a partial dose: witness (research marks sources as conflicting; two-person witnessing is recommended) | Conflicting | Witness required for every waste (stricter, policy) | Whether required, and by whom, in our state |
| Shift-change counts and frequency | Department or state policy | Count binds to the Drug Inventory checklist; frequency is the department's | Required frequency and who may count |
| Discrepancy tolerance, officer approval, location hold | Department policy | Any difference opens a discrepancy; an officer resolves it | Zero tolerance for every schedule? |
| Hash chain and separation of permissions | Engineering choice | Built | Whether it conflicts with record-keeping expectations |
| Administer needs a witness or a standing/verbal order reference | Unclear, policy | Not required; free-text reference only | Whether orders must be linked |
| State-specific rules (licensing, seal logs, count frequency) | State law | Not configurable yet | Per-state list |

## Review Focus

1. **A witness who is the performer, lacks `custody.witness`, or sits outside the unit** → refused by the database; the confirm step cannot be done by the requester. Tasks 2, 3.
2. **Update, delete or truncate of any ledger, count, seal or discrepancy-event table** (also by direct SQL as owner) → rejected. Tasks 1-4.
3. **Altering a ledger row out of band** (simulated by disabling the trigger in a test) → `app.verify_cs_chain` reports the first broken row; untouched chains verify clean. Task 2.
4. **A movement below zero, or two concurrent transfers of the last units** → exactly one succeeds; the chain stays gap-free. Task 2.
5. **Count with counted != expected** → exactly one open discrepancy that stores both numbers; a matching count opens none; resolution by the counter or witness refused. Task 4.
6. **Permission separation:** `record` cannot witness, audit, adjust or resolve; `audit` cannot write; `manage` cannot record against a unit it does not cover. Tasks 2-4.
7. **Seal reuse, or a seal break without a reason and witness** → refused. Task 1.
8. **Expiry and recall views** list exactly the lots with balance in the caller's scope. Task 5.

---

## File Structure

```
supabase/migrations/20261124000031_cs_catalog.sql   cs_items, cs_lots, cs_locations, cs_seal_events; create/seal functions
supabase/migrations/20261124000032_cs_ledger.sql    cs_ledger + chain trigger, cs_witness_requests; receive/transfer/administer/waste/return/adjust, confirm/decline, verify_cs_chain
supabase/migrations/20261124000033_cs_counts.sql    cs_counts, cs_count_lines, cs_discrepancies, cs_discrepancy_events; submit/investigate/resolve; balances, expiring and recall views
packages/db/tests/{cs-catalog,cs-ledger,cs-counts}.test.ts
packages/auth/src/permissions.ts                    + custody.{record,witness,audit,manage}
packages/templates/src/roles.ts                     grants + Controlled-Substance Officer template (+ templates test)
packages/templates/src/inventory.ts                 Drug Inventory starter: new version noting the count is bound at stations with a custody location
packages/validators/src/custody.ts
apps/web/src/server/custody/{catalog,ledger,counts}.ts
apps/web/src/app/(app)/custody/{page.tsx,[locationId]/page.tsx,witness/page.tsx,counts/page.tsx,discrepancies/page.tsx,expiry/page.tsx,actions.ts,forms.tsx}
apps/web/src/app/(app)/admin/custody/...            items, lots, locations, seals (archive, never delete)
apps/web/e2e/custody.spec.ts
```

---

### Task 1: Catalog, locations, lots and seals (schema + functions)

**Interfaces — Produces:**
- `cs_items(id, tenant_id, name, schedule text /* free label, e.g. 'II' */, ndc nullable, unit, strength_note, archived_at)`; unique `(tenant_id, name, coalesce(ndc,''))`. Write: `custody.manage`. Separate from 3a `items`.
- `cs_lots(id, tenant_id, item_id, lot_no, expires_on date, recalled_at, recall_note, archived_at)`; unique `(tenant_id, item_id, lot_no)`; `app.flag_cs_lot_recall(p_lot, p_note)` (manage, note ≥ 5 chars, one-way, audited).
- `cs_locations(id, tenant_id, name, kind in ('vault','station','unit','drug_box','member'), org_unit_id not null, member_id nullable /* kind member */, stock_location_id nullable /* link to a 3a location */, current_seal_no nullable, chain_head text, chain_seq bigint default 0, archived_at)`; composite FKs to `org_units`, `members`, `stock_locations`; `kind = 'member'` requires `member_id`. `current_seal_no`, `chain_head`, `chain_seq` change only inside `app.*` functions. Select: `custody.record` / `custody.witness` at the unit, or `custody.audit` / `manage`.
- `cs_seal_events(id, tenant_id, location_id, kind in ('apply','break','verify'), seal_no, prior_seal_no, reason, performed_by, witnessed_by, occurred_at)`; insert-only; unique `(tenant_id, seal_no)` over `apply` rows, so a seal number is never reused.
- `app.apply_cs_seal(p_location, p_seal_no)` (manage or record; location must be a `drug_box` with no current seal), `app.break_cs_seal(p_location, p_reason, p_new_seal_no, p_witness_request)` (reason ≥ 5 chars, witnessed through Task 3's request, applies the new seal in the same transaction), `app.verify_cs_seal(p_location, p_seal_no)` (record; a mismatch is stored and returned, and the Task 4 count opens a discrepancy for it).

- [ ] **Step 1:** Tests (Review Focus 2, 6, 7): scoped read and write; archived item or lot refused; a member location for a member of another tenant refused by the composite FK; seal reuse refused; break needs reason and witness; seal events append-only; `current_seal_no` cannot be updated directly; isolation on every table.
- [ ] **Steps 2-5:** FAIL → migration → `pnpm db:reset && pnpm test:db` PASS → commit `feat(db): controlled-substance catalog, locations, lots and seals`.

### Task 2: Custody ledger and hash chain (schema + functions)

**Interfaces — Produces:**
- `cs_ledger(id, tenant_id, location_id, lot_id, delta numeric(12,3) <> 0, type in ('receive','transfer_out','transfer_in','return_out','return_in','administer','waste','adjust'), transfer_id, performed_by not null, witnessed_by, reference text, reason, discrepancy_id nullable, seq bigint, prev_hash text, row_hash text, occurred_at)`; unique `(location_id, seq)`; checks: `waste` and `adjust` carry `witnessed_by <> performed_by`, `receive`/`*_in` have `delta > 0`, `administer`/`waste`/`*_out` have `delta < 0`; composite FKs; insert-only; select by unit scope or `custody.audit`.
- Chain trigger (before insert): locks the `cs_locations` row (`for update`), sets `seq = chain_seq + 1` and `prev_hash = chain_head` (genesis `''`), computes `row_hash = encode(sha256(convert_to(prev_hash || '|' || canonical fields, 'UTF8')), 'hex')` over id, location, lot, delta, type, performer, witness, reference, reason, occurred_at, and updates the location head. `app.verify_cs_chain(p_location) returns table(ok boolean, broken_seq bigint)` (audit or manage). A hash chain shows tampering; it does not stop someone with database-owner rights, so external anchoring of chain heads is listed under Deferred.
- View (`security_invoker`): `cs_balances(location_id, lot_id, on_hand)`.
- `app.cs_receive(p_location, p_lot, p_qty, p_reference)` (record at the unit; the source is free text in `reference`, no vendor model).
- `app.cs_transfer(p_from, p_to, p_lot, p_qty, p_note, p_witness_request)` and `app.cs_return(...)` (same shape; two rows sharing `transfer_id`; `record` at the source unit and `record` or `manage` at the destination unit; advisory locks on both locations in id order; a witness is required when either end is a member or drug box).
- `app.cs_administer(p_location, p_lot, p_qty, p_reference)` (record; `reference` required, ≥ 3 chars; no witness by default).
- `app.cs_waste(p_location, p_lot, p_qty, p_reason, p_witness_request)` and `app.cs_adjust(p_location, p_lot, p_delta, p_reason, p_witness_request)` (waste: record; adjust: manage; both need a confirmed witness and a reason ≥ 5 chars).

- [ ] **Step 1:** Tests (Review Focus 1-4, 6): each function writes correctly signed rows attributed to the caller; below-zero refused; concurrent last-unit transfers → one wins and `seq` has no gaps; update/delete/truncate raise (direct SQL as owner too); with the trigger disabled in the test, editing a row makes `verify_cs_chain` return its `seq`; two locations chain independently; an `administer` from an expired or recalled lot is refused; `cs_balances` equals the sum of ledger rows; isolation.
- [ ] **Steps 2-5:** FAIL → migration → PASS → commit `feat(db): hash-chained controlled-substance custody ledger`.

### Task 3: Witness requests (schema + functions)

**Interfaces — Produces:**
- `cs_witness_requests(id, tenant_id, action in ('waste','adjust','transfer','return','seal_break','count'), payload jsonb, location_id, requested_by, witness_member_id, status in ('pending','confirmed','declined','expired'), decided_at, expires_at default now() + interval '30 minutes', result_ledger_id)`; composite FKs; status changes only inside functions; rows are never deleted. Select: requester, named witness, or audit.
- `app.request_cs_witness(p_action, p_payload, p_location, p_witness_member) returns uuid`: the caller holds `record` (or `manage` for adjust) at the unit; the witness is a different, active member holding `custody.witness` at the unit.
- `app.confirm_cs_witness(p_request) returns uuid`: **the caller must be the named witness**, request pending and unexpired; re-validates everything, then runs the movement with `performed_by` = requester and `witnessed_by` = caller and stores the resulting ledger id. `app.decline_cs_witness(p_request, p_reason)`.
- The Task 2 movement functions take `p_witness_request` and accept only a **confirmed** request for the same action, location and payload hash, consumed once.

- [ ] **Step 1:** Tests (Review Focus 1, 6): requester cannot confirm; a non-witness permission holder cannot confirm; a witness outside the unit cannot; expired and replayed requests refused; payload changed after confirmation refused; decline leaves no ledger row; a confirmed waste produces one row naming both members.
- [ ] **Steps 2-5:** FAIL → migration (same file as Task 2) → PASS → commit `feat(db): witness requests confirmed by a different member`.

### Task 4: Counts and discrepancy workflow (schema + functions)

**Interfaces — Produces:**
- `cs_counts(id, tenant_id, location_id, counted_by, witnessed_by, counted_at, checklist_completion_id nullable, seal_no_seen, seal_ok boolean, note)`; `cs_count_lines(count_id, lot_id, expected, counted)`; both insert-only.
- `app.submit_cs_count(p_location, p_lines jsonb /* [{lot_id, counted}] */, p_seal_no, p_completion uuid, p_witness_request)`: `record` at the unit; confirmed witness required; reads **expected** from `cs_balances` inside the transaction, so the counter never supplies it; every lot with a balance must be counted; may link the 3a `checklist_completions` row (made by `complete_checklist` for the Drug Inventory template at the same unit) so the checklist becomes the binding count; inserts one `cs_discrepancies` row per differing lot, and one when the seal number differs.
- `cs_discrepancies(id, tenant_id, location_id, lot_id, kind in ('quantity','seal','chain'), expected, counted, count_id, status in ('open','investigating','resolved','escalated'), opened_at)` and `cs_discrepancy_events(id, discrepancy_id, kind in ('note','investigate','escalate','resolve'), by_member, note, adjust_ledger_id, report_ref text, occurred_at)` (insert-only). The status column changes only inside the functions below.
- `app.investigate_cs_discrepancy(p_id, p_note)` (manage), `app.escalate_cs_discrepancy(p_id, p_note, p_report_ref)` (manage; the report reference is free text, nothing is filed externally), `app.resolve_cs_discrepancy(p_id, p_note, p_adjust_delta, p_witness_request)` (manage; resolver is neither counter nor witness; note ≥ 10 chars; an optional delta posts a witnessed `adjust` linked by `discrepancy_id`; cannot resolve twice). View `cs_open_discrepancies`, scoped.

- [ ] **Step 1:** Tests (Review Focus 2, 5, 6): a matching count opens none; a short count opens exactly one with both numbers; a seal mismatch opens a `seal` discrepancy; counter and witness cannot resolve; a resolve with a delta writes one linked `adjust` and the balance changes only then; events accumulate and nothing is deleted; a count that misses a lot is refused; the loader used by the form returns lots and names only, never expected; isolation.
- [ ] **Steps 2-5:** FAIL → migration → PASS → commit `feat(db): bound counts and discrepancy workflow`.

### Task 5: Expiry and recall views, permissions, templates, validators

**Files:** views in the Task 4 migration; `packages/auth/src/permissions.ts`, `packages/templates/src/{roles,inventory}.ts` (+ tests), `packages/validators/src/custody.ts`.

`cs_expiring` (security_invoker): lots with `on_hand > 0` and `expires_on <= current_date + 90` (page offers 30/60/90) with `days_left`; `cs_recalled`: lots with `recalled_at` set and their balances by location. Movements of a recalled or expired lot other than `waste`, `return` and `adjust` are refused (Task 2).

- [ ] **Tests first:** every new permission is in the catalog and held only by the intended templates (Department Admin none by default; Member only `record` and `witness`); zod rejects qty ≤ 0, missing reasons, a witness equal to the performer, `reference` over 200 characters; views show only lots with balance in the caller's scope (Review Focus 8).
- [ ] Add a new Drug Inventory template version (editable data) whose description says the count is a binding custody count at stations with a custody location. Commit `feat: custody permissions, templates, validators and views`.

### Task 6: Web servers

**Files:** `apps/web/src/server/custody/{catalog,ledger,counts}.ts`.

Thin modules as in 3a: validate with zod, open the request transaction with the caller's RLS context, call `app.*`, map known errors (below zero, witness rules, expired request, closed discrepancy) to clear messages, and never expose expected quantity to the count form. A witness request is created, then the page tells the performer who must confirm; no cross-user write happens in one request.

- [ ] **Tests (web DB):** error mapping for each refusal; the count loader omits expected; a performer's server action cannot confirm their own request. Commit `feat(web): custody servers`.

### Task 7: Pages and e2e

**Files:** `/custody` (locations in my scope with balances; *Receive*, *Transfer*, *Administer*, *Waste*, *Return*), `/custody/[locationId]` (ledger timeline, seal history, chain status from `verify_cs_chain`), `/custody/witness` (my pending requests, Confirm / Decline), `/custody/counts` (the blind Drug Inventory form), `/custody/discrepancies` (investigate, escalate, resolve), `/custody/expiry`; admin pages for items, lots, locations and seals. Nav: `Custody` for holders of any custody permission; labels go through terminology overrides.

- [ ] **Playwright (`custody.spec.ts`; axe on every page; 390 px no horizontal scroll):** officer receives a lot; a member administers with a reference; a member requests a waste witness, the same member cannot confirm, a second member confirms from their own session and the ledger shows both names; a blind count with one vial short opens a discrepancy the counter cannot resolve and the controlled-substance officer can, with a witnessed adjust; breaking a seal needs a reason and a witness; the expiry page lists a lot 20 days out and a recalled lot blocks administer; an auditor sees everything with no action buttons; an officer elsewhere sees none of it.
- [ ] Commit `feat(web): custody pages`.

### Task 8: Docs and full verification

- [ ] Add a Controlled Substances section to `docs/DEVELOPMENT.md`: data model, who can do what, witness flow, chain verification, the Compliance Boundary table as a pre-release checklist for counsel and the medical director, and the hooks left for ePCR and notice timers. `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → pass. Commit `docs: controlled substances`; open a draft PR.

---

## Deferred

DEA registrations, registered and designated locations with notice dates and the 72-hour and one-business-day timers; hospital restock and standing/verbal order records; destruction (Form 41) and biennial inventory reports; DEA Form 222 / CSOS ordering and purchasing; per-state rule configuration; ePCR linkage and automatic administer entries; offline use; step-up PIN, biometric or same-device witness; external anchoring of chain heads; smart-safe access ingest; barcode scanning and GS1 lot/expiry capture; location hold on open discrepancy; schedule-specific tolerances.

## Open Questions for the Owner (recommended default in bold)

1. **Witness confirmation:** the witness confirms from their own session (as built), or on the same device with re-entered credentials? **Own session; same-device step-up waits for the auth design.**
2. **Does an administer need a witness or an order reference?** **No witness; free-text reference only; the medical director decides if orders must be linked.**
3. **Is every waste witnessed, and by whom?** **Yes, by a different member with `custody.witness` (stricter than the research's conflicting sources).**
4. **Counts: blind, who counts, how often?** **Blind two-person count at shift change; frequency is the department's and is not enforced.**
5. **Discrepancy tolerance and hold?** **Any difference opens a record; no automatic location hold; escalation recorded as free text only.**
6. **Who resolves discrepancies?** **A Controlled-Substance Officer or Medical Director with `custody.manage`, never the counter or witness.**
7. **May `reference` hold incident numbers, and could it contain PHI?** **Incident number only, with a form warning; no patient identifiers.**
8. **Retention of ledger rows?** **Never purged; counsel confirms the minimum.**
9. **Scope of locations and reads?** **Per-unit scope for `record`, department-wide for `audit`.**
10. **Counsel and medical director review before a real department uses it?** **Yes: gate release on the Compliance Boundary checklist and run in test mode until then.**
