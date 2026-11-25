# Phase 5a — ePCR Framework (Patient Care Report, NEMSIS v3.5.x export path, NERIS hooks)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **COMPLIANCE RISK AREA — READ FIRST.** This phase introduces real PHI (HIPAA) and a regulated data standard. **Do not enter real patient data until counsel and a security reviewer have signed off** on the PHI controls below, a BAA-capable host is in place (master design §8: "Before ePCR: PHI field tagging enforced, break-the-glass, PHI access logging, BAA-capable hosting"), and the HIPAA risk analysis exists. Until then the module ships behind a tenant feature flag, training/test data only, and a visible "no real patient data" banner. Nothing in this plan is legal advice; every retention period, confidentiality rule and consent statement is a counsel-review item.

**Goal:** The smallest useful ePCR framework: an **incident/call record**, a **patient care report (PCR)** with a **configurable chart-sections model** (per-department, reusing the custom-field and versioned-definition machinery), **required-field validation** (NEMSIS national elements plus department additions), an **amendment-not-edit** lifecycle ending in a **signed lock-down**, a **QA review queue**, and an **export module** that maps stored data to **NEMSIS XML** and validates it against the official XSD and schematron. NERIS is limited to data-model hooks and a roadmap.

**Architecture:** Same pattern as leave, trades, assets, forms. Every write goes through `security definer` functions in schema `app` that check scope in SQL; PHI tables have **no direct write policies and tighter read policies than other tables**. A PCR is a header row plus **append-only versions**; the current version is a view. Chart content is stored as JSONB keyed by element id and validated against a **versioned chart definition** (same shape as 4a `form_definitions`, extended with NEMSIS element ids). The NEMSIS element registry is **data loaded from the official data dictionary**, not hand-typed (see Verification Tasks). Hashes are computed in SQL like 4a.

**Tech Stack:** Existing stack. New build-time/server-side dependency for validation only: an XSD validator and an XSLT 2.0 processor for schematron (candidate: Saxon-HE; **verify license and BAA/hosting fit before adoption**, Task 6). No change to the client bundle in this slice.

**Spec:** master design §2 goal 5-6, §5.5 (permissions `ePCR.chart.view_phi`, sensitivity labels `PHI`/`MEDICAL`, break-the-glass, MFA for PHI), §5.6 (customization, layered inheritance), §5.7 (ePCR single author, post then amend), §5.8 (audit incl. view-of-PHI, record states, retention + legal hold), §6 Phase 5, §8. Research: `02-epcr-fire-reporting.md` §1 (NEMSIS), §2 (NERIS), §3.7-3.9 (validation, QA, signatures), §4 (legal), §6; `05-platform-rbac-market.md` (PHI field classes, minimum necessary, break-glass, PHI scrubbing). Prior plans: 3b (custody ledger `reference` is a free-text incident number, no ePCR link yet), 4a (versioned definitions, insert-only signatures, SHA-256 audit hash, officer decisions).

## Global Constraints

- All earlier constraints apply: strict TS, `tenant_id` on every table, composite FKs `(tenant_id, x_id)`, RLS + cross-tenant isolation test per table, writes only via `app.*` functions with SQL scope checks, audit trigger on every table, no hard deletes, append-only where stated, permissions in the catalog and role templates, nav entries, axe on every page test, 390 px layout without horizontal overflow.
- **PHI classification is mandatory.** Every new table and column carries a classification recorded in a `phi_catalog` table (columns: `table_name, column_name, class in ('PHI','MEDICAL','OPERATIONAL','NONE'), note`) and a test fails if a column in an `epcr` table is missing from it. `OPERATIONAL` (unit, times, incident number without patient link) is the only class readable beyond clinical roles.
- **Minimum necessary:** non-clinical roles (scheduler, payroll, fire-only officers) read only the `pcr_operational` view (incident number, unit, crew, times, status; no name, DOB, address, complaint, narrative). QA reviewers and the medical director read full charts. Billing is out of scope.
- **Access logging:** every read of a PHI table or PHI view goes through `app.read_pcr(p_pcr, p_purpose)` (security definer; checks scope; inserts into append-only `phi_access_log(actor, pcr_id, purpose, at, ip, user_agent, break_glass)`), and direct `select` on PHI tables is denied to the app role. Lists show only operational columns. **Break-the-glass** (research 05 §2.2): reason, 60-minute window, banner, immutable log row, notification to the privacy role, post-hoc review queue (reuses the QA queue).
- **No PHI outside PHI tables:** notifications, emails, job payloads, audit-log `before/after`, application logs, error reports, URLs and file names carry **ids and incident numbers only**. The generic audit trigger is replaced on PHI tables with a variant that logs changed column **names**, not values (values live in the version rows). A test greps notification/job/audit rows after a full chart lifecycle for the seeded fake patient name and fails on any hit. Search indexes exclude PHI columns.
- **Amendment, not edit:** a PCR is `draft` → `posted` (author submits, validation passes) → `locked` (author signs; content hash sealed). After `posted`, content changes are **new versions** by `app.amend_pcr(...)` with a reason; earlier versions are immutable (trigger + `revoke update, delete`). No hard delete: `app.void_pcr` writes a void record with reason and keeps all versions.
- **Single author:** one `author_member_id` per PCR; crew members add rows to repeating groups (vitals, medications, procedures) with client-generable UUIDs; supervisors and QA never overwrite, they add **addenda** (insert-only).
- **Retention and legal hold hooks (not the engine):** every PCR has `retention_category` and `retain_until` (nullable, computed later by the records-core phase from a versioned, effective-dated schedule) and `legal_hold boolean` set only via `app.set_legal_hold(p_pcr, p_on, p_reason)` (permission `ePCR.chart.hold`). Nothing disposes records in this slice; the hooks exist so disposal can be refused later. Retention periods are **not hard-coded** (research 02 §4: state-specific; counsel item).
- **MFA:** `ePCR.chart.view_phi` and export permissions require an MFA-verified session (check in the SQL function via the session's `aal` claim; **verify the claim name against the auth provider in use**).
- **Standards are data:** NEMSIS version and build (e.g. `3.5.1` + critical patch) are stored on every export and on the chart definition; nothing standard-specific is hard-coded in functions (master design §3).
- Out of scope: billing and 837P; CAD intake (an incident can be created manually; `cad_incident_ref` is a nullable text hook); cardiac monitor import; **offline entry** (see the mobile/offline plan; the data model here keeps client UUIDs and the single-author rule so it can sync later); AI dictation; HIE/FHIR; state SOAP submission; full NERIS.

## Verification Tasks (do before the dependent task; nothing below is assumed true)

Research 02 recorded that nemsis.org fetches were blocked. A follow-up search confirmed only: NEMSIS validates in two layers (XSD then schematron); the TAC publishes national schematron rules for DEMDataSet and EMSDataSet; the web-services guide lists EMSDataSet `schemaVersion` values 3.4.0, 3.5.0 and 3.5.1; the data dictionary page lists a v3.5.1 build with critical patches. **Not confirmed and therefore tasks:**

- **V1 (before Task 3):** Download the exact current v3.5.1 EMS data dictionary, XSDs and national schematron from nemsis.org (technical-resources/version-3). Record build ids and file hashes in `docs/research/nemsis-build.md`. Confirm the **EMSDataSet XSD path for 3.5.1** (only a 3.5.0 path was seen).
- **V2:** Generate the element registry from the dictionary: element id, section, data type, **Usage (Mandatory/Required/Recommended/Optional)**, national flag, NOT-value and pertinent-negative allowances, value sets, repeating-group rules. Do **not** hand-write element lists; the list of "required national elements" comes from the official requisite-elements document and the schematron, not from this plan.
- **V3:** Confirm which sections/elements the owner's state requires (state StateDataSet, state schematron, custom elements, facility lists) and the state's accepted NEMSIS version/deadline.
- **V4:** Confirm the XML root/namespace/`DemographicGroup` and `PatientCareReport` structure and the `UUID`/`CorrelationID` rules from the XSD and EMSDataSet guide.
- **V5:** Confirm the schematron processing method (the v3 guide describes ISO schematron with XSLT 2.0 per research 02; re-check for 3.5.1) and the severity levels used in results.
- **V6:** Confirm NEMSIS compliance-testing prerequisites ("Collect Data" track, 90-day window per research 02) before any marketing claim of compliance; this plan does **not** claim certification.
- **V7 (NERIS, roadmap only):** Confirm the NERIS core schema and API (OpenAPI, auth, enrollment) from FSRI/USFA primary sources; research 02 marks token flow, scopes and module field lists unverified.

## Review Focus

1. A scheduler/payroll/fire-only user reading any patient field, by table, view, RPC, search, notification, export or storage path → refused. Task 2.
2. Update or delete of a PCR version, addendum, signature, access-log or void row, including as function owner → rejected. Tasks 1, 2, 4.
3. Any seeded fake patient identifier appearing in audit, notifications, job payloads or logs → test fails. Task 2.
4. A posted/locked chart edited in place → refused; amendment creates a new version and the earlier version and hash still verify. Task 2.
5. Validation: missing national/department-required element, bad value-set code, NOT-value used where disallowed → blocked at post. Task 3.
6. Export XML fails XSD or schematron → export refused with the report stored; passing XML round-trips the stored values. Task 6.
7. Break-the-glass without reason, expired window, or without MFA → refused; every use lands in the review queue. Task 2.

---

## File Structure

```
supabase/migrations/20261124000037_epcr_incident.sql     phi_catalog, incidents, incident_units; app.create_incident, set_incident_status; pcr_operational view
supabase/migrations/20261124000038_epcr_core.sql         pcrs, pcr_versions, pcr_signatures, pcr_addenda, pcr_voids, phi_access_log, break_glass_grants; create/save/post/amend/sign/void/read/set_legal_hold functions
supabase/migrations/20261124000039_epcr_chart_defs.sql   nemsis_elements (registry), chart_definitions (versioned sections), department_rules; validate_pcr function; publish functions
supabase/migrations/20261124000040_epcr_qa.sql           qa_triggers, qa_reviews, qa_findings; assign/claim/decide functions; qa_queue view
supabase/migrations/20261124000041_epcr_export.sql       export_batches, export_items (append-only), nemsis_export_status; enqueue/record functions
packages/db/tests/{epcr-phi,epcr-lifecycle,epcr-validation,epcr-qa,epcr-export}.test.ts
packages/nemsis/                                         registry loader, mapper (stored chart -> XML), XML builder, validator wrapper (new package)
packages/auth/src/permissions.ts                         + ePCR.* (below); packages/templates/src/roles.ts grants
apps/web/src/server/epcr/*.ts, apps/web/src/app/(app)/epcr/...   chart list (operational only), chart editor, QA queue, admin: chart definitions, rules, exports
apps/web/e2e/epcr.spec.ts
```

Permissions (additions to catalog): `ePCR.chart.create`, `ePCR.chart.edit_own`, `ePCR.chart.view_phi` (clinical read, logged), `ePCR.chart.view_operational`, `ePCR.chart.amend`, `ePCR.chart.hold`, `ePCR.chart.void`, `ePCR.qa.review`, `ePCR.qa.manage`, `ePCR.config.manage` (chart definitions and rules), `ePCR.export.run`, `ePCR.breakglass.review`, `ePCR.access_log.view`. Default grants: Member (line) `create`, `edit_own`, `view_operational`; EMS Officer/QA Reviewer and Medical Director `view_phi`, `qa.review` (Medical Director also `breakglass.review`); EMS Officer `qa.manage`, `config.manage`, `export.run`; Department Admin config and access-log view but **not** `view_phi` by default; Auditor `access_log.view`, no PHI. Fire-only roles `view_operational` only.

---

### Task 1: Incident/call record and PHI catalog

**Interfaces — Produces:**
- `phi_catalog(table_name, column_name, class, note)` seeded for every `epcr` table in this plan; test helper `assertAllColumnsClassified()`.
- `incidents(id, tenant_id, incident_no text, occurred_at timestamptz, location_text /* OPERATIONAL, no patient names */, incident_kind in ('ems','fire','combined','other'), cad_incident_ref nullable, neris_ref jsonb nullable /* hook: external NERIS id, status; unused here */, status in ('open','closed'), created_by, created_at)`; unique `(tenant_id, incident_no)`; `incident_units(incident_id, unit_id /* 3a asset */, role, dispatched_at, on_scene_at, transport_at, at_destination_at, cleared_at)` (times are the eTimes source; edits audited).
- `app.create_incident(...)`, `app.set_incident_status(...)` (permission `ePCR.chart.create`). One incident has N PCRs (one per patient per unit).
- Location is **operational** but can identify a patient's home; the catalog marks `location_text` `PHI` unless the owner decides otherwise (open question 4) and the operational view then shows only a zone/station.
- **Hook for 3b:** `reference` stays free text; add `app.controlled_substance_ref_valid(p_ref)` only if the owner wants incident-number validation (no patient link, no PHI crossing into the ledger).

- [ ] **Step 1:** Tests: classification completeness; unit-scoped crew sees incidents for their unit only; operational view excludes PHI-class columns; isolation. **Steps 2–5:** FAIL → migration → `pnpm db:reset && pnpm test:db` → commit `feat(db): incident record and PHI catalog`.

### Task 2: PCR core — versions, PHI access, amend, sign, void, hold

**Interfaces — Produces:**
- `pcrs(id, tenant_id, incident_id, author_member_id, unit_id, status in ('draft','posted','locked','void'), retention_category text, retain_until date null, legal_hold boolean default false, current_version_no int, created_at)`: header is **OPERATIONAL** only; unique `(incident_id, author_member_id, patient_seq)`.
- `pcr_versions(id, tenant_id, pcr_id, version_no, chart_definition_id, content jsonb /* PHI/MEDICAL, keyed by element id; repeating groups as arrays of {row_id uuid, ...} */, nemsis_version text, created_by, created_at, reason /* required for version_no > 1 */, content_hash)`; insert-only; `content_hash = sha256(tenant | pcr | version_no | canonical content text | created_at)` computed in SQL.
- `pcr_signatures(id, tenant_id, pcr_id, version_no, signer_member_id, role in ('author','crew','patient','authorized_rep','receiving_facility','witness'), method, statement_text, signed_at, ip, user_agent, signature_hash, image_attachment_id null)`; insert-only; reuses 4a signature conventions. **Patient/Medicare 424.36 and refusal-signature flows are deferred** (Deferred list; counsel and medical director define them).
- `pcr_addenda(id, tenant_id, pcr_id, author_member_id, kind in ('qa_note','clinical_addendum'), body /* PHI */, created_at)`; insert-only; **QA notes are stored separately** (`qa_*` tables, Task 4) from the legal record.
- `pcr_voids`, `phi_access_log`, `break_glass_grants(id, tenant_id, member_id, reason, granted_at, expires_at, reviewed_by null, reviewed_at null)` insert-only apart from review fields.
- Functions: `app.create_pcr`, `app.save_pcr_draft(p_pcr, p_content)` (author only, draft only; overwrites the draft version row only while `draft`), `app.post_pcr(p_pcr)` (runs `app.validate_pcr`, Task 3; sets `posted`), `app.sign_pcr(p_pcr, p_statement, ...)` (author signature; sets `locked`, seals hash), `app.amend_pcr(p_pcr, p_content, p_reason)` (`ePCR.chart.amend` or author within a configurable window, **re-runs validation, creates a new version, status stays locked/posted, flags `needs_resign` and re-export**), `app.add_addendum`, `app.void_pcr(p_pcr, p_reason)`, `app.set_legal_hold`, `app.read_pcr(p_pcr, p_purpose)` (logged), `app.start_break_glass(p_pcr, p_reason)`, `app.verify_pcr(p_pcr)` (recomputes version hashes and signature hashes).
- Views: `pcr_operational` (security_invoker; header + incident + unit + times, no PHI). **No other view exposes content.**

- [ ] **Step 1:** Tests (Review Focus 1-4, 7): non-author cannot save a draft; crew member can append own vitals row to a draft they were added to but not alter others' rows; locked chart refuses in-place save; amend creates version 2, version 1 hash still verifies, `verify_pcr` false after tampering via fixture; every `read_pcr` writes one log row (including denied attempts as `denied` rows); direct `select` on `pcr_versions` as the app role fails; break-glass needs reason, expires, creates a review item and a privacy-role notification **containing only ids**; no-MFA session refused; PHI-leak grep (Review Focus 3); legal hold blocks `void_pcr` disposal path hook and is settable only with `hold`; update/delete refused on versions, signatures, addenda, log (also as owner); isolation per table.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): PCR versions, PHI access log, amend, sign and break-glass`.

### Task 3: Chart sections model, element registry and validation

**Interfaces — Produces:**
- `nemsis_elements(id, nemsis_version, build, element_id text /* e.g. from the dictionary */, section, label, data_type, usage, is_national, nv_allowed jsonb, pn_allowed jsonb, value_set jsonb null, repeating boolean, sensitivity class)`: **loaded by a script from the official dictionary (V1, V2)**; platform-owned (no tenant), read-only to tenants; the loader stores the source file hash.
- `chart_definitions(id, tenant_id, key, version, label, sections jsonb, status in ('draft','published','retired'), nemsis_version, created_by, created_at)`: versioned exactly like 4a `form_definitions` (one published per key, immutable once published, a PCR version stores `chart_definition_id` **and** a copy of the definition it answered). `sections` = ordered list of `{key,label,visible_if?, fields:[{element_id | custom_key, label_override?, required_override?, order}]}`. Departments **reorder, relabel, hide optional elements, add department custom fields (typed like `custom_field_defs`, entity `pcr`, with sensitivity PHI by default)** but **cannot remove or hide a national-required element** (enforced by `app.publish_chart_definition`, which checks the registry).
- `department_rules(id, tenant_id, version, rule jsonb /* {when:{element,op,value}, then:{require|show|warn}} */, severity in ('block','warn','qa_flag'), status, effective_from, effective_to)`: declarative, versioned, effective-dated (master §5.6); same shape the later offline engine will run.
- `app.validate_pcr(p_pcr, p_version) returns table(severity, element_id, rule_source /* national|state|department */, message)`: required-ness = registry `usage`/national flag + (state layer, once V3 data is loaded) + department rules; checks value-set membership, data type, NOT-value/pertinent-negative allowances. `post_pcr` blocks on `block`; warnings and QA flags are stored. **The official schematron is authoritative at export (Task 6); SQL validation is a convenience layer that must never be the only gate for submission.**
- Layering seam: `rule_source` already distinguishes national/state/department; state and region layers are loaded as data later (research 02 §1.3), not built here beyond the column.

- [ ] **Step 1:** Tests (Review Focus 5): cannot publish a definition that omits a national-required element (using a small fixture registry, **not** claims about the real list); department custom field validated like custom fields; a department rule makes an element required only when its condition holds; hidden optional element accepted absent; version immutability and snapshot copy; existing PCRs unaffected by a new definition version; tenants cannot write `nemsis_elements`; isolation.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): chart definitions, NEMSIS element registry and validation`.

### Task 4: QA review queue

**Interfaces — Produces:** `qa_triggers(id, tenant_id, version, condition jsonb /* element/value, always-review sample %, or validation qa_flag */, active)`; `qa_reviews(id, tenant_id, pcr_id, version_no, reason, status in ('queued','claimed','returned','closed'), assigned_to, opened_at, closed_at)`; `qa_findings(id, review_id, kind, body /* PHI-minimal */, created_by, created_at)` insert-only; `qa_queue` view (operational columns plus reason, no content); functions `app.enqueue_qa` (called by `post_pcr`/`sign_pcr`/break-glass), `app.claim_qa(p_review)`, `app.decide_qa(p_review, p_outcome, p_note)` (outcomes: `ok`, `return_to_author` which opens an amendment request, `escalate`). **Separation of duties:** a reviewer cannot review their own chart. Opening a chart from the queue goes through `read_pcr(purpose 'qa')` (logged). QA data is kept apart from the legal record (peer-review privilege varies by state; counsel item).

- [ ] **Step 1:** Tests (Review Focus 1, 2): author cannot review own chart; queue shows no PHI columns; claim is exclusive; return opens an amendment request and notifies the author with an id-only message; findings insert-only; break-glass uses appear in the queue; isolation. **Steps 2–5** as above. Commit `feat(db): QA review queue`.

### Task 5: Permissions, templates, validators, web server layer

**Files:** `packages/auth/src/permissions.ts`, `packages/templates/src/roles.ts` (+ tests), `packages/validators/src/epcr.ts`, `apps/web/src/server/epcr/*.ts`.

- [ ] **Tests first:** permissions in catalog and held only by intended templates (Department Admin lacks `view_phi`); zod rejects unknown element ids, over-long narrative, malformed row UUIDs; error mapping (locked chart, validation blocks, MFA required, expired break-glass) returns messages **without echoing content**; server modules never log request bodies for `epcr` routes (test with a log spy); no PHI in URLs (routes use pcr id only). Add a log/error-reporting scrubber test for `epcr` payloads.
- [ ] Commit `feat: ePCR permissions, validators and server layer`.

### Task 6: NEMSIS export module

**Interfaces — Produces:**
- `export_batches(id, tenant_id, nemsis_version, build, schema_hash, schematron_hash, requested_by, requested_at, status in ('queued','built','valid','invalid','failed'))`; `export_items(id, batch_id, pcr_id, version_no, xml_attachment_id, xsd_ok, schematron_report jsonb, content_hash, created_at)` insert-only (`schematron_report` holds element ids and messages only; **verify it never embeds values**, else treat as PHI and store accordingly). Export artifacts are PHI: stored in the sensitivity-aware attachments bucket, signed-URL only, URL expiry short, access logged via `read_pcr(purpose 'export')`.
- `packages/nemsis`: **mapper** (stored chart content + incident/unit times + agency DEM data, keyed by registry element ids, to the XML structure in V4), **XML builder** (deterministic ordering, UUIDs and correlation ids per V4), **validator wrapper** (XSD, then schematron through the chosen XSLT 2.0 processor, results normalized to severity levels per V5), both running **server-side in a pg-boss job** (`nemsis-export`) with a payload of ids only.
- Only `locked` PCRs export; an amended PCR re-exports as a new item and flags that the earlier submission is superseded. Exports run only from the latest `locked` version.
- **State submission (SOAP SubmitData/RetrieveStatus), per-state endpoint registry and credentials: out of scope here.** Output is a validated XML file/bundle downloadable by `ePCR.export.run` for manual upload or billing/state handoff.
- `DEMDataSet` (agency, personnel, vehicles, facilities) is a **prerequisite for valid submission**: this slice maps what exists from members and assets minimally and lists the gaps as Verification Task V4 findings; do not invent values.

- [ ] **Step 1:** Tests: golden-file test using the **official NEMSIS-published example/test files obtained in V1** (not hand-written) round-trip through mapper → XML → validator; a chart missing a schematron-required element yields `invalid` with element-level messages and no downloadable "valid" artifact; export refused for draft/posted/void; amended chart creates new item; job payload and report contain no values; unit tests pin the builder to registry data so a dictionary update is a data change. **Steps 2–5:** commit `feat: NEMSIS XML export with XSD and schematron validation`.

### Task 7: Pages, e2e, docs

**Files:** `/epcr` (my charts, operational list only), `/epcr/[id]` (editor rendered from the chart definition, post, sign, amend with reason, version history, addenda), `/epcr/qa`, `/admin/epcr` (chart definitions, rules, QA triggers, exports, access log viewer with filters), nav `ePCR` (feature-flagged). Editor shows a persistent "no real patient data until compliance sign-off" banner while the tenant flag `epcr_phi_enabled` is false. Real patient data cannot be reliably detected in software, so the banner and the process control (flag off until sign-off) are the mitigation.

- [ ] **Playwright (`epcr.spec.ts`, seeded fake patients only):** line crew creates incident and chart from the section model, validation blocks post until the department-required field is filled, posts, signs; a scheduler sees the operational row but is refused the chart (URL guessing included); QA reviewer opens it (log row appears in the admin viewer), returns it, author amends, version history shows both; break-glass flow with banner; export produces a downloadable valid file; admin customizes the chart (relabel, hide optional, add custom field) and cannot hide a national-required element; axe on every page; 390 px layout. No PHI in page titles, tab names, or URLs (assert).
- [ ] Add an ePCR section to `docs/DEVELOPMENT.md` (PHI classes, who can read what, logging, amendment model, how to load a NEMSIS build, how to add a department field/rule, **pre-PHI checklist for counsel/security**). `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → pass. Commit `docs: ePCR framework`; open a draft PR.

---

## NERIS: data-model hooks and roadmap (not implemented here)

Hooks in 5a: `incidents.incident_kind`, `cad_incident_ref`, `neris_ref jsonb`, `incident_units` times and unit ids (NERIS needs station/unit sync), one incident to N PCRs, and **no EMS PHI in the incident row** (research 02 §4: fire records are largely public; keep PHI segregated). Roadmap, each step gated by Verification Task V7 and the NERIS compatibility-badge requirements: (1) 5b fire incident fields as a second registry (`neris_elements`) loaded from the official schema, using the same chart-definition machinery; (2) station/unit entity sync; (3) per-department NERIS enrollment of one vendor client id (credentials in the secrets store, never in tables); (4) create/update submission job and status dashboard, backfill tool; (5) state "plus-one" code layer. Statements about NERIS auth, scopes and module lists in research 02 remain unverified.

## Deferred

Billing/837P; CAD intake; monitor import; offline sync and local encrypted store; state SOAP submission and per-state registry; state/region layers beyond the `rule_source` seam; patient and Medicare 424.36 signature and refusal/AMA workflows; narrative templates and AI dictation; HIE/FHIR/PDF run report and records-release with redaction; retention schedule engine, destruction log and WORM storage (hooks only here); 42 CFR Part 2 sensitivity tag on imported records; per-field encryption or tokenization of PHI columns (evaluate in the security review); field-level audit of PHI values with separate key custody; HIPAA risk analysis, BAA chain and SOC 2 (Phase 6); NEMSIS compliance testing and any compliance claim.

## Open questions for the owner (recommended default in brackets)

1. Which state, and which NEMSIS version/deadline does it require (drives V3 and the state layer)? [Confirm with the state EMS office before Task 3 data load; build on v3.5.1.]
2. Is the department the transporting EMS agency (a covered entity) or non-transport fire first response? [Assume covered-entity treatment either way; counsel confirms.]
3. Who is the privacy/security officer receiving break-glass alerts? [Department Admin plus Medical Director until a privacy role exists.]
4. Is incident location treated as PHI in the operational view? [Yes: show station/zone only to non-clinical roles.]
5. How long may an author amend a locked chart without `ePCR.chart.amend`? [Not at all; amendments need the permission or QA return, always with a reason.]
6. Should QA reviewers be able to see every chart or only a sampled/flagged set? [Flagged plus a configurable random sample; medical director sees all.]
7. May Department Admins view charts? [No; admin config and access-log view only.]
8. Retention and legal hold: who sets categories until the records-core phase exists? [Default category `epcr` with no `retain_until`; nothing is ever disposed in this phase; counsel supplies periods.]
9. Is a BAA-capable host and a security review scheduled before any real patient data? [Required; keep the feature flag and banner until done.]
10. Do we budget NEMSIS Collect-Data compliance testing now or only after the owner's department is live? [After, using the export module as the basis; never claim compliance before it passes.]
