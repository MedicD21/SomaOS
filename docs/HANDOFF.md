# SomaOS handoff (read this first in a new session)

SomaOS is an all-in-one Fire/EMS operations platform (scheduling, leave, pay, inventory, documents, training, forms,
controlled-substance custody, with ePCR and mobile planned). It is built for the owner's own department first, then
to be sold to other departments, so everything is multi-tenant and customizable. Owner preferences: keep responses
brief; be very detailed in code; never invent facts; independent security reviews are deferred until near a release.

## Where things are
- Master design: `docs/superpowers/specs/2026-11-24-somaos-master-design.md`.
- Per-phase plans: `docs/superpowers/plans/` (every merged slice has one; the plan format is the template for new ones).
- Developer guide, with one section per shipped feature: `docs/DEVELOPMENT.md`.
- Research: `docs/research/`. Architecture decisions: `docs/adr/`.
- Run the app: see `docs/DEVELOPMENT.md` (Prerequisites, First run, Tests). Needs Docker for the local Supabase stack.

## What is built and merged on `main`
Phase 0 foundation (multi-tenant, RBAC, audit, files, jobs). Scheduling and roster, credentials gating, leave with
accruals and limits, shift trades, open shifts. Pay engine, time entries and payroll close. Assets, checklists and
inventory. Documents, SOG acknowledgements and forms with signatures. Training suite. Controlled-substance custody
(TEST MODE until counsel and the medical director review). Guided rule builder with simulation.

## Planned, not built (plans are on `main`)
- ePCR with NEMSIS export: `docs/superpowers/plans/2026-11-25-phase-5a-epcr.md` (PHI is a compliance risk area; no real
  patient data until counsel and a security review).
- Mobile and offline: `docs/superpowers/plans/2026-11-25-mobile-offline.md` and `docs/adr/0002-mobile-offline-sync.md`.

## Everything department-specific is still a PLACEHOLDER
No real data from the owner's current systems has been loaded. These are starter values to replace:
- Pay codes, employee group and pay rules (28-day / 212 h work period is a starter value): `packages/templates/src/pay.ts`.
- Leave banks, leave types and accrual policies: `packages/templates/src/leave.ts`.
- Shift pattern (3-platoon starter): `packages/templates/src/career-3-platoon.ts`.
- Credential types: `packages/templates/src/credential-types.ts`. Training categories: `packages/templates/src/training.ts`.
- Assets, checklists, items: `packages/templates/src/inventory.ts`. Starter SOG folders and forms: `packages/templates/src/documents.ts`.

## Current task for a local session with browser access: learn the real setup (READ ONLY)
The owner gave permission to READ ONLY from their logged-in browser tabs:
- **EMS Manager**: scheduling (shift pattern and platoons, positions/seats, pay codes, leave types and accrual rules,
  comp time, trades and overtime rules, how pay is calculated).
- **NinthBrain**: training scheduling, class catalog, hour categories, documents, SOGs and other documents.
- **Frontline**: assets and inventory (asset types, checklists, items, locations, par levels).
Rules: never click anything that changes data, submit forms, send messages, approve, or delete; do not export or copy
personal data about individual members (names, SSNs, pay rates, medical info). Capture the STRUCTURE: category names,
code lists, rule wording, accrual tables, checklist item lists. Some admin views are not visible to the owner: record
what is missing rather than guessing.

Deliverables (commit on a branch, open a PR, do not merge without the owner's say-so):
1. `docs/research/06-current-systems.md`: what each system does, with the exact structures above and screenshots'
   key facts transcribed; list unknowns and questions for the owner.
2. A proposed update to the template files listed above (same schemas; keep values flagged as drafts until the owner
   approves), plus any rule the current engines cannot express (list it, do not hack around it).
3. A short list of NinthBrain/EMS Manager export formats found, so importers can be planned (`docs/superpowers/plans/`).

## Conventions that keep CI green (learned the hard way)
- Every tenant table: `tenant_id`, composite FKs, RLS plus an isolation test; writes through SQL functions with scope
  checks; audit trigger; no hard deletes; ledgers are append-only.
- TDD: write the failing DB/engine test first. E2E: assert on resulting lists (forms unmount after success), set a long
  test timeout for multi-login specs, keep list queries bounded and join by primary key (RLS runs per row).
- Run `pnpm db:reset` before `pnpm test:db` after running e2e. Other specs generate large rosters, so reset state a spec
  depends on and delete rows it creates.
- GitHub GraphQL is blocked in cloud sessions; use `gh api` REST. Merge only PRs the owner names.
