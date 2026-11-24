# SomaOS — Master Design

**Date:** 2026-11-24
**Status:** Draft for owner approval
**Research basis:** `docs/research/01–05` (each claim there is tagged confirmed / secondary / unverified; items marked unverified must be checked against primary sources before the module that depends on them ships).

---

## 1. Intent and why

SomaOS is an all-in-one operations platform for Fire and EMS departments: scheduling, time/leave/pay, personnel and credentials, training, inventory (station and medical, including controlled substances), assets and fleet, forms with signatures, documents, SOGs and medical protocols, ePCR (NEMSIS) and fire incident reporting (NERIS).

- **First customer:** the owner's own department. **Later:** sold as SaaS to many departments (career, volunteer, combination, private EMS, county/consortium).
- **Why:** departments stitch together 4–8 point tools (Telestaff/Aladtec, ESO/ImageTrend, PSTrax/Operative IQ, Vector/TargetSolutions…) that don't share data, have clunky UX, weak mobile/offline, opaque pricing, and long implementations (research 05 §1).
- **Biggest pain to solve first:** **scheduling** — for both members and management — specifically the inability of existing products to model each department's real pay structures, pay codes, many leave types with accruals, comp time, and contract (CBA) rules.
- **Timing advantage:** NFIRS was retired in early 2026 and NERIS is now the only national fire reporting system, so many departments are re-evaluating software right now (research 02, 05).

## 2. Goals, non-goals, anti-goals

### Goals
1. **Highly customizable for ANY department** without code: terminology, org structure, ranks, roles/permissions, custom fields, forms, pay codes, leave types, accrual policies, overtime and contract rules, shift patterns, checklists, inspection schedules, retention schedules.
2. **Multi-tenant from day one** (one deployment, many departments, strict isolation), plus **consortium tenancy** (a county or region whose member agencies share selected data).
3. **Offline-first on mobile/tablets** for field work (rig checks, ePCR, forms, drill sign-in, protocols), syncing when connectivity returns.
4. **Explainable rules:** every computed outcome (overtime, pay code, accrual, who got force-hired, why a member can't fill a seat) shows *why*, and changes can be **simulated before going live**.
5. **One data entry:** a call from dispatch produces one NERIS fire report and one NEMSIS ePCR per patient with shared data entered once; supplies documented on a chart decrement unit stock; an out-of-service apparatus flows into staffing; credentials gate scheduling.
6. **HIPAA-ready architecture** now (encryption, audit, least privilege, PHI field tagging), formal HIPAA program/SOC 2 before commercial sale.

### Non-goals (for now)
- CAD (dispatch) itself — SomaOS integrates with CAD, it does not replace it.
- EMS billing/claims processing — SomaOS captures billing-grade data and exports it (837P-ready fields), it is not a billing company.
- Payroll processing — SomaOS produces approved time with pay codes and exports to payroll systems.
- Formal compliance certifications (HIPAA program, SOC 2, GovRAMP) during the own-department phase — designed for, not certified.

### Anti-goals (failure even if it "works")
- An admin cannot configure their contract rules without calling us (Telestaff's #1 complaint is admin complexity — research 01).
- The system silently computes pay/OT/leave and nobody can explain the number.
- Field crews lose data because the tablet was offline, or the app is click-heavy and slow.
- One department can ever see another department's data except through explicit consortium sharing.
- Per-customer code forks. Customization is configuration, never a fork.

## 3. Constraints

- **Stack (owner-approved):** TypeScript end to end; Postgres; web app; Expo (React Native) mobile with an offline local database.
- **Regulatory facts shaping the design** (details and sources in research):
  - FLSA 7(k) work periods 7–28 days; fire OT threshold 212 h / 28 days (pro-rated table 29 CFR 553.230); comp time cap 480 h (public safety); trades credited at normal schedule (553.31).
  - NREMT 2-year cycle; credentials expire on fixed dates (EMT/AEMT/Paramedic Mar 31; EMR Sep 30); NCCP hour buckets (national/local-state/individual).
  - NEMSIS v3.5.1 current; state-specific element sets and validation (schematron); SOAP submission to states.
  - NERIS replaced NFIRS (Jan 2026); REST API with OpenAPI schema; per-department vendor enrollment; compatibility badge.
  - DEA EMS final rule effective 2026-03-09 (per-state registration, designated locations, 21 CFR 1304.27 recordkeeping).
  - NFPA renumbering/consolidation (e.g., 1911→1910, 1851/1852→1850, 1932/1937/1962→1930, 1582→1580, 1001/1002/1003/1005→1010).
  - ESIGN/UETA electronic signatures; per-agency acceptance rules.
  - OSHA 29 CFR 1910.1020 retention (exposure 30 yrs; medical employment + 30 yrs).
  - ADA Title II web rule (WCAG 2.1 AA): 2027-04-26 (≥50k pop.) / 2028-04-26 (smaller, special districts).
  - HIPAA Security Rule update not final (projected July 2027) — build to proposed requirements (MFA, encryption, asset inventory, restore capability).
- **Standards change over time:** every regulatory number (thresholds, intervals, retention periods, code lists) is stored as **versioned, effective-dated data**, never hard-coded.

## 4. Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| **A** | **Modular monolith, multi-tenant from day one.** One TypeScript monorepo (web, API, mobile, shared packages); one Postgres with tenant isolation enforced by the DB (row-level security) behind app-level permission checks; offline sync layer; modules with strict boundaries inside one deployable. | Slightly more setup up front; selling to a 2nd department becomes onboarding, not a rewrite. | **Chosen by owner.** |
| B | Single-tenant now, add tenancy later. | Faster first weeks; retrofitting tenant isolation touches every table, query, and permission later. Conflicts with plan to sell. | Rejected. |
| C | Microservice per module. | Independent scaling; heavy ops burden for a small team and harder offline sync. | Rejected. |

## 5. Architecture

### 5.1 Technology choices

Calls marked **(owner)** were decided by the owner; everything else is **(builder call)** with the stated reason, open to change during planning.

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) **(owner)** | One language across web, API, mobile, shared rule engines. |
| Monorepo | pnpm workspaces + Turborepo | Standard, fast, caches builds. |
| Web app | Next.js (App Router) + React + Tailwind + an accessible component kit (shadcn/ui on Radix) | Accessibility (WCAG 2.1 AA) built on Radix primitives. |
| API | Node service (Fastify) exposing tRPC for first-party clients + versioned REST/OpenAPI for public API & webhooks | Type-safe internal calls; open API is a differentiator (research 05). |
| Database | PostgreSQL 16+ **(owner: Postgres)** | RLS, JSONB, range types (`tstzrange`) and exclusion constraints suit scheduling. |
| ORM / migrations | Drizzle ORM + SQL migrations | Close to SQL; RLS policies and constraints live in migrations. |
| Auth | Better Auth (or equivalent) with organizations, passkeys, TOTP MFA, SAML/OIDC SSO (Entra ID), later SCIM | Municipal SSO is common; passkeys help volunteers. Verify library maturity at planning time. |
| Mobile | Expo (React Native, new architecture) **(owner)** | iOS + Android + tablets from one codebase. |
| Offline sync | PowerSync (Postgres → device SQLite, upload queue to our API) | Research 05: Sync Streams GA, HIPAA-capable cloud, self-host option. Alternatives noted: ElectricSQL. WatermelonDB and Zero rejected (maintenance / no offline). |
| Background jobs | pg-boss (Postgres-backed queue) | No extra infrastructure; used for accrual runs, alerts, exports, state/NERIS submission queues. |
| Files | S3-compatible object storage (MinIO in dev) with server-side encryption; signed URLs | Documents, attachments, signed PDFs. |
| Search | Postgres full-text search initially | Defer a search engine until needed. |
| PDF | Server-side PDF generation + PAdES sealing with RFC 3161 timestamp at finalization | Research 04: tamper-evident signed records. |
| Validation | Zod schemas shared by web, API, mobile | One source of truth for config and payload shape. |
| Testing | Vitest (unit, engines), Playwright (web E2E), DB tests for RLS policies | Rule engines must be exhaustively tested. |
| Local dev | Docker Compose: Postgres, MinIO, PowerSync service, mail catcher | One-command local stack. |
| Hosting (later) | A HIPAA-eligible cloud with a BAA (e.g., AWS) | Decided before first external customer. |

### 5.2 Repository layout

```
SomaOS/
  apps/
    web/              Next.js admin + member web app
    api/              Fastify: tRPC, REST/OpenAPI, PowerSync upload endpoint, webhooks
    mobile/           Expo app (offline-first)
    worker/           pg-boss job runners (accruals, alerts, exports, submissions)
  packages/
    db/               Drizzle schema, migrations, RLS policies, seed data
    auth/             session, SSO, MFA, permission evaluation
    config-core/      versioned/effective-dated config + inheritance (layering) engine
    custom-fields/    per-tenant field registry, validation, rendering metadata
    schedule-engine/  PURE functions: patterns, rosters, rules, OT, accruals, explain traces
    rules-core/       shared rule representation, evaluation, explain/simulate infra
    audit/            append-only audit log helpers
    ui/               shared React components (web) / design tokens
    mobile-ui/        shared RN components
    sdk/              typed client for public REST API
    validators/       zod schemas shared across apps
  docs/
    research/         01–05 research reports
    superpowers/specs/ design docs
    adr/              architecture decision records
```

Module code inside `apps/api` and `apps/web` is grouped by module (`scheduling/`, `personnel/`, `inventory/`…). Modules talk to each other only through each module's public service interface and domain events, never by reaching into another module's tables.

### 5.3 Tenancy model

- **Tenant = Department** (an agency). Every tenant-owned row carries `tenant_id`.
- **Isolation:** (1) app-level permission checks on every request, and (2) Postgres RLS policies keyed on a per-transaction `app.tenant_id` setting as a backstop. Integration tests assert cross-tenant reads/writes fail.
- **Consortium:** a `consortium` groups tenants. Sharing is explicit, per data category (e.g., shared training classes, mutual-aid rosters, shared protocols), via sharing grants — never implicit.
- **Platform tenant:** SomaOS staff tooling (support access is time-boxed, reason-required, audited — "break-the-glass").
- **Per-tenant settings:** timezone, locale, terminology, enabled modules (feature flags per subscription), branding (logo/colors), state (drives NEMSIS/retention/protocol defaults).

### 5.4 Organization structure (configurable)

A generic, any-depth tree of **org units** with tenant-defined **types** (e.g., Division → Battalion → Station → Unit/Apparatus → Seat/Position). Defaults ship as templates:

- *Career 3-platoon fire/EMS*, *Combination*, *Volunteer*, *Private/hospital EMS*, *County EMS*.

Separate dimensions (research 05):
- **Rank/title** (Chief, Captain, FF/PM…) — tenant-defined list with order (for seniority/acting rules).
- **Shift/platoon** (A/B/C, or custom).
- **Permission roles** (what you can do) — not the same as rank.
- **Assignments** (where you are: station/unit/shift, effective-dated).

### 5.5 Identity, access control (RBAC + ABAC)

- **Permissions** are strings `module.resource.action` (e.g., `scheduling.roster.edit`, `scheduling.leave.approve`, `ePCR.chart.view_phi`).
- **Roles** bundle permissions; tenants clone/edit default roles. Default role templates: Department Admin, Chief Officer, Battalion/Shift Commander, Company Officer, Member (career), Volunteer, Probationary, Scheduler, Payroll/HR, Training Officer, Logistics/Inventory Officer, EMS Officer/QA Reviewer, Medical Director, Fleet/Maintenance, Read-only Auditor, External/Mutual-Aid.
- **Scopes** on each role grant: `self`, `unit`, `station`, `shift`, `battalion`, `department`, `consortium`. Example: a Captain approves leave for *their station, their shift*.
- **Time-bound grants** for acting assignments (acting Captain gets Captain permissions for that shift only).
- **Field sensitivity labels** (`PHI`, `HR`, `MEDICAL`, `CJI`): fields carry a label; viewing requires the matching permission; masked otherwise.
- **Break-the-glass:** time-boxed, reason required, auto-queued for review.
- **MFA** required for admin roles and any PHI access; optional for others (tenant setting). Passkeys supported.
- **Explain:** "Why can/can't this user do X?" tool for admins.

### 5.6 Customization framework (cross-cutting)

1. **Terminology:** per-tenant label overrides ("Platoon" vs "Shift", "Apparatus" vs "Unit").
2. **Custom fields:** per-tenant field registry (type, validation, options, required-when, sensitivity label, which entity, which roles see/edit). Values stored in a `custom` JSONB column on the entity; registry drives validation and UI rendering. Indexed via expression/GIN indexes when used for filtering. (Research 05: JSONB + registry, not EAV.)
3. **Versioned, effective-dated configuration:** any rule set (pay codes, OT rules, accrual policies, credential requirements, retention schedules, inspection intervals) is a `config_version` with `effective_from`, `effective_to`, author, approval, and change note. Computations always record **which config version** they used.
4. **Layered inheritance ("upstream with local overrides"):** one mechanism used for state→region→agency protocols, NEMSIS national→state→agency validation, policy libraries, form libraries, and SomaOS-supplied templates. When the upstream changes, local overrides are flagged for review/re-approval.
5. **Templates:** department-type starter packs (org structure, roles, pay codes, leave types, shift patterns, checklists) so a new tenant is productive on day one (research: PSTrax praised for vendor-built setup).
6. **Workflows/approvals:** configurable approval chains (e.g., leave: Captain → BC; trade: both members → officer).
7. **Notifications:** per-event, per-role, per-user channel preferences (in-app, push, email, SMS).
8. **Extensibility:** webhooks + public REST API (later phase).

### 5.7 Offline-first mobile

- PowerSync syncs **only what a device's user needs** (their tenant, their station/unit, their schedule, their open charts, their unit's inventory and checklists, current protocols).
- Writes go to a local upload queue and are applied by our API with full permission and validation checks (server is authoritative).
- **Conflict policy by data type:**
  - ePCR: one author/owner per chart; row-level merge for repeating rows (vitals/meds/procedures) using stable client-generated IDs; after posting, changes are amendments.
  - Inventory/checks: append-only transactions (no overwrite conflicts).
  - Schedule edits: online-only for managers (roster changes need live rule evaluation); members can submit requests offline, which are evaluated on sync.
- Local database encrypted at rest; device remote-wipe/session revoke; idle lock.

### 5.8 Records core (cross-cutting)

- **Audit log:** append-only, every create/update/delete/view-of-PHI with actor, time, before/after, reason, device, IP.
- **Record states:** draft → submitted → approved/locked → amended (amendments are new versions; originals immutable).
- **Signature service:** drawn signature capture + strong audit trail (intent, attribution via authenticated session/step-up auth, integrity); on finalization, server seals the PDF (PAdES + RFC 3161 timestamp). Per-tenant config for which signature method each form requires; wet-ink printable path for forms that require it (research 04).
- **Retention:** every record has a retention category; schedules per state/tenant with event triggers (e.g., separation + 30 years); legal hold blocks disposal.

### 5.9 Time handling

- All instants stored UTC (`timestamptz`); every tenant and station has an IANA timezone.
- Shifts are defined in **local wall-clock time**, and actual hours are computed from real instants. **A 24-hour shift that crosses a DST change is 23 or 25 actual hours**; the engine must pay correctly and the tenant chooses the policy (pay actual hours vs. scheduled hours) as a config option.
- Work periods, pay periods, and accrual periods are tenant-configured calendars anchored to a start date.

## 6. Module catalog and phasing

| Phase | Module(s) | Why this order |
|---|---|---|
| **0 — Foundation** | Tenancy, auth/SSO/MFA, org structure, people (basic), ranks, roles/permissions, audit, custom fields, config versioning, notifications, file storage, web shell, mobile shell + offline sync skeleton, CI | Everything depends on it. |
| **1 — Scheduling, Time, Leave & Pay** | Detailed in §7. Includes minimal credentials (needed to gate seats). | Owner's #1 pain point. Usable by own department as soon as it ships. |
| **2 — Personnel & Credentials; Training** | Full member records, credential types/cycles/CE buckets, expiration alerts; training classes, sign-in, CE/ISO/NREMT hour roll-ups, skills/task books, quizzes; later SCORM/xAPI | Feeds scheduling qualifications; ISO/NREMT reporting. |
| **3 — Inventory, Assets & Fleet; Checks** | Location tree, par levels, lot/expiry, restock, purchasing; apparatus/equipment with standards-driven inspections, work orders, OOS → staffing; daily rig checks (offline) | High daily-use value; prerequisite for ePCR supply decrement. |
| **3b — Controlled Substances** | DEA registrations, designated locations, append-only ledger with witness signatures, seals/drug boxes, deadline timers, counts at shift change | Highest regulatory risk; built after inventory core and signatures. Requires primary-source verification of 21 CFR 1301/1304/1305/1317 sections first. |
| **4 — Forms, Documents, SOGs & Protocols** | Form builder (MIT/Apache engine or in-house builder — SurveyJS Creator licensing conflicts with resale, research 04), signatures, document library, retention, read-and-sign acknowledgments, policy versioning, medical protocols with layered inheritance, offline protocol viewer, dosing references | Signature service from Phase 0/records core reused. Dosing calculators need FDA software-as-a-medical-device review before release. |
| **5 — Incident Reporting: ePCR (NEMSIS) + Fire (NERIS)** | One incident → NERIS + NEMSIS per patient; NEMSIS v3.5.1 dataset, state element sets, schematron validation (server + critical rules offline), state SOAP submission; NERIS REST submission; CAD intake; QA/QI review; signatures incl. Medicare 424.36 requirements; billing export; monitor integrations later (partner agreements) | Largest, certification-gated (NEMSIS compliance testing, NERIS badge). |
| **6 — Commercialization** | HIPAA program + BAA, SOC 2 Type II, subscription/billing, tenant onboarding wizard, data importers from competitors, public API docs, status page; later GovRAMP | Required before selling to other departments. |
| Ongoing / adjacent | Station logbook/daily journal, exposure & health tracking (member-owned exposure records; PFAS/carcinogen logs), messaging/announcements, apparatus status board, analytics dashboards, pre-incident plans, inspections/CRR, hydrants | Slotted after core phases based on owner priority. |

## 7. Module 1 in depth — Scheduling, Time, Leave & Pay

### 7.1 Who uses it and for what
- **Members:** see my schedule (calendar + list), request leave, see balances and projected balances, request/accept trades, sign up for open shifts/overtime, see why I was or wasn't hired, get notifications; works on phone.
- **Officers/Shift commanders:** daily roster (who's on which seat), fill vacancies, approve leave/trades, holdovers, acting assignments, see staffing vs minimums.
- **Schedulers/Admins:** build patterns, staffing models, rules; run vacancy fill; publish schedules; simulate rule changes.
- **Payroll/HR:** approve timesheets, review exceptions, export to payroll with pay-code mapping, audit accrual ledgers.

### 7.2 Core concepts (data model outline)

- **Shift pattern** — sequence of on/off segments (e.g., 24/48: `[on 24h, off 48h]`; Kelly overlay: every Nth shift off; 48/96; 24/72; Pitman 12h; custom), start time, anchor date, platoon offsets. Versioned and effective-dated.
- **Platoon/Shift group** — A/B/C… assigned to a pattern with an offset.
- **Staffing model** — per station/unit and time window: required **seats** (positions). A **seat** has: label (Officer, Driver/Engineer, FF/PM…), required qualifications (any-of sets, equivalencies), minimum rank, whether acting-up is allowed, and minimum staffing per unit/station/department by time of day.
- **Assignment** — person ↔ seat ↔ time range (`tstzrange`) with an **assignment type** (regular, overtime, trade, holdover, callback, acting, training, detail). Exclusion constraint prevents double-booking a person.
- **Work/pay codes** — tenant-defined list (e.g., REG, OT 1.5, OT 2.0, HOLDOVER, CALLBACK, ACTING, KELLY, TRAINING, HOLIDAY, each leave type). Each code has: payable?, multiplier or rate rule, counts toward FLSA hours?, counts toward contract OT?, export code mapping per payroll system.
- **Employee group / bargaining unit** — groups members who share a rule set (FLSA work period, OT rules, accrual policies, leave limits, fill lists).
- **Work period** — FLSA 7(k) configuration per employee group (length 7–28 days, anchor date, threshold from the 553.230 table stored as data). Federal (FLSA) overtime and contract overtime are computed **separately**, and the higher/combined result is applied per tenant policy.
- **Leave types** — tenant-defined (vacation, sick, personal, holiday, FMLA, bereavement, military, injury/workers' comp, comp time, Kelly, union business, etc.). Each has: units (hours/shifts), minimum increment, request lead time, approval chain, does it count as hours worked for OT?, documentation required?, linked accrual bank.
- **Accrual banks & policies** — per leave type: earn rate (per pay period, per hours worked, per month, front-loaded annually), **seniority tiers**, caps (max balance), carryover rules and dates, payout rules, proration for part-time/hire date, waiting periods, negative balance allowed?. Bank balances are an **append-only ledger** (earn, use, adjust, carryover, payout, expire) — balance = sum of ledger; never edited in place.
- **Comp time** — earned instead of OT pay at configured rate (e.g., 1.5×), member choice or forced, cap (default 480 h public safety, configurable lower), use/payout rules.
- **Leave limits** — max off per shift/day by station, rank, qualification, season; blackout dates; priority rules (first-come vs seniority bid windows for vacation picks).
- **Trades** — two members swap time; payback tracking; officer approval; FLSA crediting per 553.31 (each member credited as if they worked their normal schedule); tenant limits (max trades per period, payback deadline).
- **Vacancy fill / overtime lists** — strategies as configurable rule types: rotating list, hours-equalized (lowest OT hours first), seniority, reverse seniority, pay-rate based, voluntary sign-up then forced/mandatory hire (holdover/force-hire order), qualification-only filtering. Each fill attempt logged (who was offered, declined, skipped and why).
- **Timesheet / actual time** — scheduled vs actual (holdovers, early relief, callbacks with minimum hours 2–4 configurable), officer approval, payroll lock per pay period.
- **Payroll export** — per pay period, per member, per pay code; mapping table per payroll system; CSV first, specific connectors later.

### 7.3 The rules engine (`packages/schedule-engine`)

- **Pure functions, no DB access:** input = config versions + roster/assignments + leave + ledger state; output = results + **explain trace**. This makes it unit-testable, reproducible, and usable for **simulation**.
- **Rule representation:** a library of typed, parameterized rule types (zod-validated JSON), e.g. `overtime.weekly_threshold`, `overtime.daily_after_scheduled`, `callback.minimum_hours`, `acting.pay_after_hours`, `accrual.per_pay_period_tiered`, `leave.max_off_per_shift`, `fill.hours_equalized`. Admins compose rule sets from these with forms in the UI. A small, sandboxed expression language for edge-case conditions may be added later; not in Phase 1.
- **Explain trace:** every result line cites rule id, config version, inputs used ("8 h coded OT 1.5 because work-period hours reached 212.0 at 2026-12-03 07:00 per FLSA 7(k) 28-day rule v3").
- **Simulation:** run a pay period, a leave request, a vacancy fill, or a proposed rule change against real data **without** committing; show a diff vs current.
- **Golden test suites:** department rule sets captured as fixtures with expected outputs, including DST crossings, Kelly days, trades across work periods, holdover spanning midnight and period boundaries.

### 7.4 Credentials needed in Phase 1 (minimal)
- Credential types with validity rules (N months, fixed cycle end like NREMT Mar 31, non-expiring); member credentials with expiry and document upload.
- **Gating:** a member is qualified for a seat only if each required credential is valid **through the end of the shift**; hard block with audited override; re-check future assignments when a credential lapses; warn at 90/60/30/7 days (configurable).
- Full credential management (CE buckets, verification workflows) comes in Phase 2.

### 7.5 Integrations (Phase 1)
- Payroll CSV export (mapping per payroll system); iCal feed per member; roster export for CAD (CSV/API) — specific CAD/payroll connectors later.

## 8. Security and compliance roadmap

| When | What |
|---|---|
| Phase 0 | TLS everywhere; encryption at rest (DB, object storage, device); MFA for admins; audit log; RLS backstop; least-privilege roles; secrets management; dependency scanning in CI; backups with tested restore. |
| Before ePCR (Phase 5) | PHI field tagging enforced, break-the-glass, PHI access logging, BAA-capable hosting. |
| Before first external customer (Phase 6) | HIPAA risk analysis and policies, BAA template, SOC 2 Type II, pen test, incident response plan, WCAG 2.1 AA audit (ADA Title II deadlines 2027/2028). |
| Later | GovRAMP; CJIS only if CAD feeds carry criminal-justice data. |

## 9. What's left to the builder (planning-time decisions)

- Exact library versions; confirm Better Auth (or alternative) covers SAML/SCIM needs; PowerSync self-hosted storage requirements.
- Fastify+tRPC vs Next.js route handlers detail, as long as the public REST API remains separable.
- UI design system details and navigation, within WCAG 2.1 AA.
- Exact table design within the concepts above.
- CI provider (GitHub Actions assumed).

## 10. Open items to verify against primary sources (before the dependent module ships)

From the research reports' verification lists — highlights:
- DEA 2026 EMS rule exact CFR subsections (designated-location notice, vehicle storage, waste/Form 41) — Phase 3b.
- NFPA 1850 edition/retirement and inspection intervals; NFPA 1910/1930 test intervals — Phase 3.
- NREMT 2025 NCCP hour splits per level; CAPCE provider requirements — Phase 2.
- ISO FSRS training-hour figures (sources conflict on some) — Phase 2.
- NEMSIS v3.5.1 state requirements for the owner's state; NERIS API/badge requirements — Phase 5.
- State retention schedules for the owner's state — Phase 4.
- FDA software-as-medical-device applicability for dosing calculators — Phase 4.

## 11. Immediate next step

Write the implementation plan for **Phase 0 (Foundation)**, then a separate plan for **Phase 1 (Scheduling)**. Each later module gets its own design → plan → build cycle.
