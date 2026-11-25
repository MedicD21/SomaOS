# Phase 3a — Assets, Checklists and Consumable Inventory Framework

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The smallest useful framework for "things the department owns and stocks": customizable **asset types** and **assets** (status, location), an append-only **asset event log**, **checklist templates** (rig checks) with completion records, and a basic **consumable inventory** (items, locations, par levels, append-only stock ledger, low-stock view). Controlled substances and drug chain of custody are **not** in this slice (Phase 3b); the design leaves room for them (see Deferred).

**Architecture:** Same pattern as leave, pay and trades. All writes go through `security definer` SQL functions in schema `app` that check the caller's scope in SQL; tables have no direct write policies. Event and ledger tables are insert-only (triggers reject update/delete, plus `revoke update, delete`). Current state is changed only by the function that writes the event: `assets.status` and `assets.org_unit_id` change only inside `record_asset_event`, which inserts the event row in the same transaction. Stock on hand is a **view over the ledger** (no cached balance in 3a, so nothing can drift). Asset types use the existing custom-field registry: `custom_field_defs.entity` gains `'asset'` and `assets.custom jsonb` holds values, validated by the same path as members and org units. Checklist templates are versioned JSON (items with `key`, `label`, `kind` pass_fail | number | text, `required`); a completion stores a **copy of the template version it answered**, so later template edits never change history.

**Tech Stack:** Existing stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §5.6 (custom fields, templates), §5.7 (inventory/checks are append-only transactions, so offline merge is conflict-free later), §5.8 (append-only, no hard deletes), §6 Phase 3 and 3b rows. Research: `docs/research/03-inventory-assets.md` (A1 location tree, A4 daily checks, data-model items 1-3, 7, 9, 10).

## Global Constraints

- All earlier global constraints apply: strict TS, `tenant_id` on every table, **composite FKs** `(tenant_id, x_id)` to tenant-owned parents, RLS + a cross-tenant isolation test per table, scope checks in SQL (never only in the web layer), audit trigger on every table, no hard deletes (archive or void instead), ledgers append-only, permissions added to the catalog and role templates, nav entries, axe on every page test, 390 px layout without horizontal overflow.
- **Asset locations reuse org units** (station or apparatus unit); do not duplicate org structure. Inventory locations are their own table (`stock_locations`, optional `org_unit_id`, any-depth `parent_id`) because a cabinet or bag is not an org unit.
- **Scope = the location's org unit.** Writing about an asset or stock location needs the permission at that unit (`app.has_permission_at`); a location with no unit needs department-wide permission. Moving an asset needs permission at both the old and the new unit.
- **Asset status** is a closed set: `in_service`, `out_of_service`, `reserve`, `retired`. `retired` is terminal (only a `note` event afterwards). `out_of_service` and `retired` need a reason of at least 5 characters.
- **Ledger rules:** quantities are signed `numeric(12,3)` deltas per location and item. `use` and transfers may never take a location below zero (refused, not clamped); `adjust` needs a reason and also may not go below zero. A transfer writes two rows sharing a `transfer_id`. Nothing is edited; mistakes are corrected by a compensating `adjust`.
- **A checklist completion is by the caller's own member and cannot be edited.** Failed items are recorded; automatic work orders, auto out-of-service and staffing impact are deferred.
- **Forward-compat for 3b (do not build, do not preclude):** every ledger row has `performed_by` and nullable `witnessed_by`, `lot_id`, `signature_id`, `reference jsonb`; `items.is_controlled` exists but a check pins it to false; `stock_locations.kind` accepts a reserved `container`; asset event `kind` is a check list that 3b extends by migration. Controlled items later get their **own** ledger and functions rather than relaxing these.
- Out of scope: purchasing, lot and expiry, barcode scanning, photos on checks, work orders, meters and maintenance schedules, depreciation, ePCR decrement, mobile/offline UI.

## Review Focus

1. A user without the permission at the asset's unit (or at the destination on a move) changing status/location or logging events → refused by the database. Tasks 1, 3.
2. Update or delete of `asset_events`, `checklist_completions`, `stock_ledger` by any role, including direct SQL as the function owner → rejected. Tasks 1, 2, 3.
3. A `use` or transfer that would go negative → refused; two concurrent transfers of the last units → exactly one succeeds, totals stay consistent. Task 3.
4. Editing a checklist template after completions exist → old completions still show the questions and answers as answered. Task 2.
5. Custom fields: a missing required field, wrong type or archived field on an asset → refused with the same messages as members; nothing leaks across tenants. Tasks 1, 4.
6. Low-stock view lists exactly the (location, item) pairs below par within the caller's scope. Task 3.
7. A retired asset accepting a status change or a checklist → refused. Tasks 1, 2.

---

## File Structure

```
supabase/migrations/20261124000025_assets.sql        custom_field_defs entity += 'asset'; asset_types, assets, asset_events; create/record/archive functions
supabase/migrations/20261124000026_checklists.sql    checklist_templates (versioned), checklist_completions; save_checklist_template, complete_checklist
supabase/migrations/20261124000027_inventory.sql     items, stock_locations, par_levels, stock_ledger; stock_levels + low_stock views; receive/use/adjust/transfer functions
packages/db/tests/{assets,checklists,inventory}.test.ts
packages/auth/src/permissions.ts                     + inventory.asset.{view,manage,event}, inventory.check.{perform,manage}, inventory.stock.{view,manage,use}
packages/templates/src/roles.ts                      role template grants (+ templates test)
packages/validators/src/{asset,checklist,inventory}.ts
apps/web/src/server/custom-fields.ts                 loadFieldDefs entity union += 'asset'
apps/web/src/server/inventory/{assets,checklists,stock}.ts
apps/web/src/app/(app)/assets/{page.tsx,[id]/page.tsx,actions.ts,forms.tsx}
apps/web/src/app/(app)/checks/{page.tsx,[templateId]/page.tsx,actions.ts}
apps/web/src/app/(app)/inventory/{page.tsx,actions.ts,forms.tsx}
apps/web/src/app/(app)/admin/{asset-types,checklists,items}/...   admin pages (archive, never delete)
apps/web/e2e/{assets,checklists,inventory}.spec.ts
```

Default role grants: Department Admin all; Logistics/Inventory Officer and Fleet/Maintenance `manage`, `event`, `stock.manage`; Company Officer `view`, `event`, `check.perform`, `stock.use` at their unit; Member (career, volunteer) `view`, `check.perform`, `stock.use`; Read-only Auditor `view`.

---

### Task 1: Assets, types and event log (schema + functions)

**Interfaces — Produces:**
- `asset_types(id, tenant_id, key, label, category in ('apparatus','equipment','medical_device','ppe','other'), archived_at)`; unique `(tenant_id, key)`; a starter set (Engine, Ambulance, Cot, Monitor, SCBA) comes from the template pack and is fully editable. Write: `inventory.asset.manage`.
- `assets(id, tenant_id, type_id, name, identifier /* tag, serial or unit number */, status, org_unit_id, custom jsonb, in_service_date, created_at, archived_at)`; composite FKs `(tenant_id, type_id)` and `(tenant_id, org_unit_id)`; unique `(tenant_id, identifier)` where not null; select needs `inventory.asset.view` at its unit; no direct writes; audited.
- `asset_events(id, tenant_id, asset_id, kind in ('check','maintenance','status_change','assignment','note'), occurred_at, performed_by, from_status, to_status, from_org_unit_id, to_org_unit_id, note, data jsonb)`; insert-only; select follows the asset.
- `app.create_asset(p_type, p_name, p_identifier, p_org_unit, p_custom) returns uuid` (`inventory.asset.manage` at the unit; `p_custom` must be an object whose keys exist, unarchived, in the `asset` registry).
- `app.record_asset_event(p_asset, p_kind, p_to_status, p_to_org_unit, p_note, p_data) returns uuid` (`inventory.asset.event` at the current unit, and at the new unit on a move; `status_change` and `assignment` update the asset row in the same transaction; reason rules above; refuses when retired).
- `app.archive_asset(p_asset, p_reason)` (manage; asset must be retired; writes a `note` event).

- [ ] **Step 1:** Write `packages/db/tests/assets.test.ts` first (Review Focus 1, 2, 5, 7): an officer at station A cannot see or touch station B's asset; a status change updates the row and writes exactly one event; a move needs both units; missing reasons refused; a retired asset refuses further events; update/delete on `asset_events` raises (also by direct SQL as owner); archived custom field refused; duplicate identifier refused; a type from another tenant refused by the composite FK; isolation test per table.
- [ ] **Steps 2–5:** FAIL → migration → `pnpm db:reset && pnpm test:db` PASS → commit `feat(db): assets, asset types and append-only event log`.

### Task 2: Checklist templates and completions (schema + functions)

**Interfaces — Produces:**
- `checklist_templates(id, tenant_id, key, label, asset_type_id nullable, version int, items jsonb, log_failure boolean, active boolean, created_by, created_at)`; unique `(tenant_id, key, version)`; one active version per key (partial unique index); `items` validated by a SQL check function (1–200 entries of `{key,label,kind,required}`, unique keys). Written only by `app.save_checklist_template(p_key, p_label, p_asset_type, p_items, p_log_failure) returns uuid` (`inventory.check.manage`), which inserts version n+1 and deactivates the previous.
- `checklist_completions(id, tenant_id, template_id, asset_id nullable, org_unit_id, completed_by, completed_at, template_snapshot jsonb, answers jsonb, failed_count int, note)`; insert-only; select for the completer, or `inventory.check.perform` / `inventory.asset.view` at the unit.
- `app.complete_checklist(p_template, p_asset, p_answers, p_note) returns uuid`: `inventory.check.perform` at the asset's unit (or the given unit when no asset); the actor is the caller's own member; every `required` item must be answered; copies the items into `template_snapshot`; counts failed pass/fail items; inserts one `check` asset event (`data {completion_id, failed_count}`) when an asset is given (when `log_failure` is off, only clean completions log); refuses a retired asset or an inactive template version.

- [ ] **Step 1:** Tests (Review Focus 2, 4, 7): scoped perform/refuse; missing required answer refused; snapshot equals the version used; saving a new version leaves old completions unchanged and deactivates the old version; completing the inactive version refused; cannot complete for another member; the event is written once; append-only enforced; isolation.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): checklist templates and immutable completions`.

### Task 3: Consumable inventory (schema + functions)

**Interfaces — Produces:**
- `items(id, tenant_id, sku nullable, name, category in ('medical','station_supply','ppe','other'), unit, is_controlled boolean not null default false check (not is_controlled), archived_at)`; unique `(tenant_id, sku)`.
- `stock_locations(id, tenant_id, name, kind in ('storeroom','station','apparatus','compartment','container'), parent_id nullable, org_unit_id nullable, archived_at)`; composite self-FK `(tenant_id, parent_id)`; cycles refused in the function.
- `par_levels(tenant_id, location_id, item_id, par, min default 0)` keyed `(location_id, item_id)`, set by `app.set_par(location, item, par, min)` (`inventory.stock.manage` at the unit).
- `stock_ledger(id, tenant_id, location_id, item_id, delta numeric(12,3) <> 0, type in ('receive','use','adjust','transfer_out','transfer_in'), transfer_id nullable, performed_by, witnessed_by nullable, lot_id nullable, signature_id nullable, reference jsonb, reason, occurred_at)`; insert-only; composite FKs; select needs `inventory.stock.view` at the location's unit.
- Views (`security_invoker` so RLS applies): `stock_levels(location_id, item_id, on_hand)` and `low_stock(location_id, item_id, on_hand, par, min, short_by, critical)` where `on_hand < par`; `critical` when `on_hand <= min`.
- Functions, all stamping `performed_by` from the caller: `app.receive_stock(loc, item, qty, reference)` (`stock.manage`); `app.use_stock(loc, item, qty, reason)` (`stock.use` at the unit); `app.adjust_stock(loc, item, delta, reason)` (`stock.manage`, reason ≥ 5 characters); `app.transfer_stock(from, to, item, qty, note)` (`stock.use` or `stock.manage` at both ends; takes `pg_advisory_xact_lock` on the two `(location,item)` keys in a fixed order). Typed quantities must be > 0. Items and locations are archived, never deleted; archived ones refuse new rows but keep history.

- [ ] **Step 1:** Tests (Review Focus 2, 3, 6): each function writes correctly signed rows; negative result refused; transfer nets to zero with a shared `transfer_id` and is refused from a location the caller cannot touch; concurrent last-unit transfers (two connections) → one wins; low-stock per scope with `critical`; par change audited; archived item/location refused; `is_controlled = true` rejected; update/delete on the ledger raises; isolation on every table.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): consumable inventory with append-only stock ledger`.

### Task 4: Permissions, templates, validators

**Files:** `packages/auth/src/permissions.ts`, `packages/templates/src/roles.ts` (+ test), `packages/validators/src/{asset,checklist,inventory}.ts`, `apps/web/src/server/custom-fields.ts`.

- [ ] **Tests first:** every new permission is in the catalog and held by the intended role templates only (Member limited to view/perform/use); zod schemas reject unknown status/kind, missing reasons, qty ≤ 0, duplicate checklist item keys, more than 200 items; `loadFieldDefs(tx, 'asset')` works and excludes archived definitions; custom-value validation is reused from members, not copied.
- [ ] Add the starter pack (asset types, a "Daily rig check" and a "Station supplies" checklist, a few common items) to the department-type templates as editable data. Commit `feat: assets and inventory permissions, validators and starter pack`.

### Task 5: Web servers and admin pages

**Files:** `apps/web/src/server/inventory/*.ts`; admin pages for asset types, checklists and items.

Server modules stay thin: validate with zod, open the request transaction with the caller's RLS context, call the `app.*` function, map known database errors to clear messages (as in leave and trades). Admin pages list, create, edit and archive with a reason; saving a checklist says it creates a new version; asset type forms render custom fields from the registry via the existing renderer.

- [ ] **Tests (web DB):** an officer's asset list excludes other stations; checklist save bumps the version; error mapping for negative stock, missing reason and retired asset. Commit `feat(web): asset, checklist and inventory servers and admin pages`.

### Task 6: Pages and e2e

**Files:** `/assets` (filter by type, status, unit; detail with event timeline, *Log event*, *Change status or move*), `/checks` (active templates for my unit, fill-in form, past completions), `/inventory` (stock by location, *Receive / Use / Adjust / Transfer*, par editor, *Low stock* tab); nav entries `Assets`, `Checks`, `Inventory` gated by view/perform permissions; labels go through tenant terminology overrides.

- [ ] **Playwright:** logistics officer creates an asset type with a required custom field and an asset (field enforced); a company officer at that station marks it out of service with a reason and sees the timeline, an officer at another station does not see it; a member completes the rig check with one failed item, the completion and timeline event appear, and a later template edit does not change that completion; stock: receive, use, transfer, the low-stock list shows the shortage and clears after a receive, a negative use shows the clear error; axe on all three pages and 390 px without horizontal overflow (tables become stacked cards).
- [ ] Commit `feat(web): assets, checks and inventory pages`.

### Task 7: Docs and full verification

- [ ] Add an Assets and Inventory section to `docs/DEVELOPMENT.md` (data model, who can do what, ledger and event-log rules, adding an asset type or checklist, the 3b hooks). `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → pass. Commit `docs: assets and inventory`; open a draft PR.

---

## Deferred

- **Phase 3b controlled substances (room left, nothing built):** DEA registrations, registered and designated locations with notice dates; controlled items (schedule, NDC) with their own immutable ledger; mandatory `witnessed_by` plus signature for waste, transfer and administration; sealed drug boxes as `container` locations plus serialized assets with seal history; shift-change counts, discrepancy workflow and deadline timers; standing/verbal order references; step-up auth. Hooks in 3a: `performed_by`/`witnessed_by`/`signature_id`/`lot_id` columns, `container` kind, `is_controlled` pinned false, append-only pattern, extensible event kinds. CFR requirements need primary-source verification before 3b design.
- Lot and expiry, FEFO, recalls, GS1/UDI scanning; purchasing, vendors, requisition to PO to receiving; usage forecasting.
- Standards-driven inspection schedules (time, mileage, hours, event), meters, preventive maintenance, work orders, failed check → work order, out-of-service → staffing and unit status, test records with readings and tester certification (SCBA, ladders, hose, cylinders).
- Photos and signatures on checks; PowerSync offline rig checks and mobile UI; barcode/QR/RFID tags.
- Issued gear and PPE per member, kits as serialized assets, depreciation and warranty, ePCR supply decrement, importers from Frontline and Operative IQ.

## Decisions (owner, 2026-11-25)
1. **A failed rig-check item never changes status by itself.** Truck in/out of service is an ordinary asset *status* set by a person (via `record_asset_event`); checklist results stay informational. Seed the status set `in_service`, `out_of_service`, `reserve`, `maintenance`.
2. **Locations are readable department-wide; inventory is entered against a chosen station.** Reads of asset and stock locations are not station-restricted. When recording a stock movement or a checklist, the member selects their station (stock location) from a list of all stations; writes still need the scope check at the chosen location's org unit.
3. **Starter pack:**
   - Asset types: Apparatus (engine, ambulance, ...), Cardiac monitor, Cot / stretcher, Ballistic vest, Turnout gear, plus a generic Equipment type. Types carry custom fields (serial number, size, issue/expiry date, assigned member for personal gear such as vests and turnout gear).
   - Checklists: **Daily Truck Check** (basic, generic items: exterior/tires/lights, fluids, cab, radios, SCBA/airpacks, monitor and O2 present, cot, medical bags) and a **Drug Inventory** check (a per-unit count/seal verification checklist: item, expected qty, counted qty, seal/lot/expiry checked, initials). Both are editable templates; every item list is a starter value to customize.
   - **Scope note for Drug Inventory:** in 3a this is only a checklist with recorded counts. Chain of custody, waste witnessing, and discrepancy handling for controlled substances remain Phase 3b; the checklist completion must reference the unit/stock location so 3b can attach to it.

