# Phase 4a — Documents, SOG/Policy Library and Forms with Signatures

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The smallest useful framework for "paper the department keeps and signs": a **document library** (folders, versioned documents on the existing files module, effective dates, supersede), **SOG/policy publishing** with required-reading assignments and an append-only **acknowledgement** record per member and version (reminders through the notifications and jobs outbox), and a generic **form builder** (versioned JSON form definitions using the custom-field types, append-only submissions, drawn or typed signature with timestamp, a SHA-256 audit hash of the submitted content, and officer approval routing like leave and trades). Medical protocols, ePCR, offline use and training course content are **not** in this slice (see Deferred).

**Architecture:** Same pattern as leave, trades and assets. Every write goes through `security definer` SQL functions in schema `app` that check the caller's scope in SQL; tables have no direct write policies. File bytes stay in the `tenant-files` bucket and are indexed in `attachments` (entity `document_version`, sensitivity-aware); a document **version** row points at one attachment and is immutable once published. Acknowledgements, submissions, signatures and approval decisions are **insert-only** (triggers reject update and delete, plus `revoke update, delete`). A form definition version is immutable; a submission stores a **copy of the definition version it answered** plus its content hash, so later edits never change history. Hashes are computed **in SQL** (built-in `sha256()` over a canonical text of the record) inside the same function that inserts the row, so the web layer cannot supply or skip one.

**Tech Stack:** Existing stack. No new dependencies (signature drawing uses a plain canvas component in the web app; the stroke is stored as a PNG attachment).

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §5.6 (custom fields), §5.8 (append-only, no hard deletes), §6 Phase 4 row, signature service paragraph. Research: `docs/research/04-forms-docs-training-sogs.md` A1-A3 (what an e-signature must evidence; PAdES sealing is a later pass), A3 (versioned immutable templates, field types, workflow), B4 and D1 (SOG lifecycle, read-acknowledgement tied to a specific version, re-attestation on a new major version).

## Global Constraints

- All earlier global constraints apply: strict TS, `tenant_id` on every table, **composite FKs** `(tenant_id, x_id)` to tenant-owned parents, RLS + a cross-tenant isolation test per table, scope checks in SQL (never only in the web layer), audit trigger on every table, no hard deletes (archive or void), append-only records, permissions added to the catalog and role templates, nav entries, axe on every page test, 390 px layout without horizontal overflow.
- **Files reuse, not replace.** Document and signature bytes go through `uploadAttachment` (`files.upload`) and the existing `attachments` row and storage policies. Migration 28 adds a branch to the `attachments` select policy so an `entity = 'document_version'` attachment is visible exactly when the caller can see the version row under RLS, and a `form_signature` attachment only to the signer, the submitter and form approvers at the unit. Do not widen access for `files.view` holders in general.
- **Document visibility** is per folder: `view_permission` is null (any member holding `documents.view`) or a permission code the caller must hold department-wide (for example HR). Folders nest to any depth, cycles refused in the function. Documents inherit their folder's rule.
- **Versions:** `draft`, then `published`, then `superseded`. A published version's content, attachment, effective date and change note never change. Publishing sets `effective_from` (default today; never earlier than today unless the publisher holds `documents.backdate` and gives a reason) and supersedes the previously published version in the same transaction (it stays readable, marked superseded). At most one published version per document (partial unique index). Only `documents.publish` publishes. **Whether a new version is "major" (re-requires acknowledgement) is chosen by the publisher at publish time.**
- **Acknowledgement is by the caller's own member and cannot be edited, deleted or made on behalf of someone else.** One row per (reading, member). It records member, version, server time, the exact statement text shown, and the method (`click` or `typed_name`; the assigner may require `typed_name`). Assigning does not acknowledge; officers can see who has not.
- **Reminders use the existing outbox.** A scheduled job calls `app.send_reading_reminders()`, which calls `app.notify(...)` (in-app plus the `send-email` job, honouring member prefs) for each unacknowledged assignee on a schedule (default: at assignment, 7 days before due, on the due date, then every 7 days overdue), and logs each in `reading_reminders` so a rerun never double-sends.
- **Forms:** definitions use the custom-field types (`text, long_text, number, integer, boolean, date, select, multi_select, email, phone`) plus a simple `show_if {field, equals}`; repeating sections, calculations, photo, GPS and PDF mapping are deferred. Answers are validated in SQL by the **same validation function** custom values use (extract it to `app.validate_custom_values(defs jsonb, values jsonb)` if it is not already shared; do not copy it).
- **Submissions are never edited or deleted.** A correction is a new submission that references the old one (`corrects_id`); a submission is **voided** by an insert-only decision row with a reason.
- **Signature capture (this slice):** `drawn` (PNG attachment) or `typed` (the signer retypes their full name, matched case-insensitively to their member name). A signature records signer member, **server timestamp**, method, the consent statement shown, user agent and IP (passed in by the web layer), and a hash. Intent comes from the statement plus an explicit sign action; attribution from the authenticated session (step-up auth deferred). Hash rules: `submission_hash = sha256(tenant | definition_id | definition_version | member_id | submitted_at | canonical answers jsonb text)`; `signature_hash = sha256(submission_hash | signer | signed_at | method | statement)`. `app.verify_submission(id)` recomputes both from stored data.
- **Approval routing reuses the officer pattern from leave and trades:** a definition says `approval: none | officer`. A decider needs `forms.approve` covering the **submitter's station (org unit)** (department-wide grants also qualify) and may not be the submitter. Decisions (`approved`, `rejected`, `returned` with a note of at least 5 characters) are insert-only rows; current status is a view over the latest decision. A returned submission is re-submitted as a correction. Multi-step chains are deferred (`step int` exists so a chain can be added).
- A form that requires a signature cannot be submitted without one; the signature row is inserted in the same transaction as the submission.

## Review Focus

1. A member without the folder's permission listing, opening or fetching the file (including by guessed storage path) of a document → refused by RLS. Tasks 1, 5.
2. Update or delete of a published version, `acknowledgements`, `form_submissions`, `form_signatures`, `form_decisions`, including direct SQL as the function owner → rejected. Tasks 1, 2, 3.
3. Publishing a new version supersedes the old in one transaction; two concurrent publishes leave exactly one published version. Task 1.
4. Acknowledging for someone else, a superseded version, an unassigned reading, or twice → refused. A new major version opens a new reading; old acknowledgements stay as history. Task 2.
5. Reminders: a same-day rerun sends nothing new; acknowledged members get none; member notification prefs respected. Task 2.
6. Editing a form definition after submissions exist → old submissions still show the questions and answers as answered and `verify_submission` still passes. Tampered stored answers → verification fails. Task 3.
7. A submitter approving their own submission, or an officer outside the submitter's station deciding → refused. Task 3.
8. Missing required answer, wrong type, archived field, or a `show_if`-hidden field carrying a value → refused with the same messages as custom fields. Task 3.

---

## File Structure

```
supabase/migrations/20261124000028_documents.sql   document_folders, documents, document_versions; attachments policy branch; create/add_version/publish/archive functions
supabase/migrations/20261124000029_readings.sql    required_readings, reading_assignees, acknowledgements, reading_reminders; assign/acknowledge/remind functions; reading_status view
supabase/migrations/20261124000030_forms.sql       form_definitions, form_submissions, form_signatures, form_decisions; save/publish/submit/decide/void/verify functions; form_status view
packages/db/tests/{documents,readings,forms}.test.ts
packages/auth/src/permissions.ts                   + documents.{view,manage,publish,backdate}, sog.{assign,acknowledge,report}, forms.{manage,submit,approve,view_all}
packages/templates/src/roles.ts                    role template grants (+ templates test)
packages/validators/src/{document,reading,form}.ts
apps/web/src/server/{documents,readings,forms}/*.ts
apps/web/src/app/(app)/documents/{page.tsx,[id]/page.tsx,actions.ts,forms.tsx}
apps/web/src/app/(app)/sogs/{page.tsx,[id]/page.tsx,actions.ts}          my required reading + published SOG library
apps/web/src/app/(app)/forms/{page.tsx,[key]/page.tsx,submissions/[id]/page.tsx,actions.ts,signature-pad.tsx}
apps/web/src/app/(app)/admin/{readings,form-definitions,document-folders}/...
apps/web/e2e/{documents,sogs,forms}.spec.ts
```

Default role grants: Department Admin all; Chief Officer and Training Officer `documents.manage`, `documents.publish`, `sog.assign`, `sog.report`, `forms.manage`, `forms.approve`; Battalion/Shift Commander and Company Officer `documents.view`, `sog.report` and `forms.approve` at their unit, `forms.submit`, `sog.acknowledge`; Member (career, volunteer, probationary) `documents.view`, `sog.acknowledge`, `forms.submit`; Read-only Auditor `documents.view`, `sog.report`, `forms.view_all`. `documents.backdate` is Admin only.

---

### Task 1: Document library (schema + functions)

**Interfaces — Produces:**
- `document_folders(id, tenant_id, parent_id nullable, name, view_permission nullable, archived_at)`; composite self-FK; unique `(tenant_id, parent_id, name)`. Written by `app.save_folder(...)` (`documents.manage`).
- `documents(id, tenant_id, folder_id, kind in ('document','sog','policy'), title, number nullable /* SOG 3.4 */, owner_member_id, requires_ack boolean, review_every_months nullable, archived_at)`; unique `(tenant_id, number)` where not null. SOGs are documents with a label, not a second system.
- `document_versions(id, tenant_id, document_id, version_no int, label /* "2.0" */, status in ('draft','published','superseded'), attachment_id, change_note, effective_from date, published_at, published_by, superseded_at, superseded_by, created_by, created_at)`; unique `(document_id, version_no)`; partial unique index one `published` per document; composite FKs; a trigger allows only forward status moves and only `status`, `effective_from`, `published_*`, `superseded_*` to change; drafts visible only to `documents.manage`, other rows follow the folder rule.
- `app.create_document(p_folder, p_kind, p_title, p_number, p_requires_ack) returns uuid` (`documents.manage`).
- `app.add_document_version(p_document, p_attachment, p_label, p_change_note) returns uuid` (`documents.manage`; the attachment must be an unused `document_version`-entity attachment of the same tenant).
- `app.publish_document_version(p_version, p_effective_from, p_major boolean, p_backdate_reason) returns uuid` (`documents.publish`; locks the document row; supersedes the previous version; when `p_major` and the document `requires_ack`, opens a reading via the Task 2 function, so define it in migration 29 if ordering demands).
- `app.archive_document(p_document, p_reason)` (manage; keeps all versions).
- View `current_documents` (security_invoker): the published version per document with `effective_from <= current_date`, and `upcoming` ones with a future date.

- [ ] **Step 1:** Write `packages/db/tests/documents.test.ts` first (Review Focus 1, 2, 3): restricted folder hides rows and the storage object from a plain member; publish supersedes in one step and the old version stays readable; published version rejects update/delete (also direct SQL as owner); concurrent publishes (two connections) leave one; backdating needs `documents.backdate` plus a reason; archived document refuses new versions; another tenant's attachment refused by the composite FK; folder cycle refused; isolation per table.
- [ ] **Steps 2–5:** FAIL → migration → `pnpm db:reset && pnpm test:db` PASS → commit `feat(db): document library with versioning and supersede`.

### Task 2: Required readings and acknowledgements (schema + functions)

**Interfaces — Produces:**
- `required_readings(id, tenant_id, document_id, version_id, audience jsonb /* {all:true} or {org_unit_ids:[], role_ids:[]} */, due_on date nullable, statement text, require_typed_name boolean, created_by, created_at, closed_at)`; insert-only apart from `closed_at` (set by `app.close_reading`); one open reading per version.
- `reading_assignees(tenant_id, reading_id, member_id, assigned_at)`: materialized at assignment from the audience over **active members**; insert-only. Members hired later are added by `app.sync_reading_assignees(reading)` (idempotent, run by the reminder job); nothing is ever removed.
- `acknowledgements(id, tenant_id, reading_id, member_id, version_id, acknowledged_at default now(), statement_text, method in ('click','typed_name'), typed_name nullable, ack_hash)`; unique `(reading_id, member_id)`; insert-only; select for the member, or `sog.report` at the member's unit or department-wide. `ack_hash = sha256(tenant | reading | version | member | acknowledged_at | statement)`.
- `app.assign_reading(p_version, p_audience, p_due_on, p_statement, p_require_typed) returns uuid` (`sog.assign`; version must be published; audience must resolve to at least one member).
- `app.acknowledge_reading(p_reading, p_typed_name) returns uuid` (`sog.acknowledge`; actor is the caller's own member and an assignee; version must still be published, else "a newer version was published, read that instead"; typed name must match when required).
- `app.send_reading_reminders() returns int` (service role or `sog.assign`): finds unacknowledged assignees due a reminder per the schedule, calls `app.notify(member, 'reading-reminder', title, body, link)`, writes `reading_reminders(reading_id, member_id, sent_on, kind)` (unique per day and kind), returns the count. A daily `reading-reminders` job is registered where the credential-expiry job is (follow that code).
- View `reading_status` (security_invoker): per reading and assignee, acknowledged_at or null, overdue flag; per-unit rollup for officers.

- [ ] **Step 1:** Tests (Review Focus 2, 4, 5): assignee acknowledges once, second refused; non-assignee and someone-else's refused; superseded version refused; update/delete raise; unpublished version cannot be assigned; unit audience includes only active members of that unit; officer sees only their unit's status, a member only their own rows; reminders follow the schedule, never twice per day, skip acknowledged members, create `notifications` and `send-email` jobs only where prefs allow; a major publish on a `requires_ack` document opens a new reading with the previous audience; isolation per table.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): required readings, append-only acknowledgements and reminders`.

### Task 3: Forms, signatures and approvals (schema + functions)

**Interfaces — Produces:**
- `form_definitions(id, tenant_id, key, version int, label, fields jsonb, requires_signature boolean, signature_statement text, approval in ('none','officer'), status in ('draft','published','retired'), created_by, created_at)`; unique `(tenant_id, key, version)`; one published version per key; `fields` validated by a SQL check function (1–200 entries of `{key,label,type,required,options?,show_if?}`, unique keys, types from the list above). Written only by `app.save_form_definition(...)` (`forms.manage`; creates draft n+1), `app.publish_form_definition(id)` (retires the previous) and `app.retire_form(key)`.
- `form_submissions(id, tenant_id, definition_id, org_unit_id /* submitter's station */, member_id, submitted_at, definition_snapshot jsonb, answers jsonb, submission_hash, corrects_id nullable)`; insert-only; select for the submitter, `forms.approve` at the unit, or `forms.view_all`.
- `form_signatures(id, tenant_id, submission_id, signer_member_id, method in ('drawn','typed'), typed_name, image_attachment_id nullable, statement_text, signed_at default now(), ip inet, user_agent text, signature_hash)`; insert-only. A witness or countersign is another row by another member (the model allows it; the UI does not offer it yet).
- `form_decisions(id, tenant_id, submission_id, step int default 1, decision in ('approved','rejected','returned','void'), decided_by, decided_at, note)`; insert-only; `form_status` view (security_invoker) gives `submitted | approved | rejected | returned | void` from the latest decision.
- `app.submit_form(p_definition, p_answers, p_signature jsonb, p_corrects, p_ip, p_user_agent) returns uuid` (`forms.submit`; actor is the caller's own member; definition must be published; answers validated, `show_if`-hidden fields must be absent; copies the definition into `definition_snapshot`; computes `submission_hash`; when `requires_signature`, validates and inserts the signature with `signature_hash`; stores the submitter's station; with `approval = 'officer'` notifies unit officers holding `forms.approve` through `app.notify`, otherwise the submission is final).
- `app.decide_form(p_submission, p_decision, p_note) returns void` (`forms.approve` at `org_unit_id`, not the submitter, definition must be `officer`, no earlier terminal decision; notifies the submitter).
- `app.void_form(p_submission, p_reason)` (the submitter before any decision, or `forms.manage`; writes a `void` decision).
- `app.verify_submission(p_submission) returns table(ok boolean, submission_ok boolean, signatures_ok boolean)`.

- [ ] **Step 1:** Tests (Review Focus 2, 6, 7, 8): required-field, type, archived and `show_if` rules; missing required signature refused; typed-name mismatch refused; hash stable and `verify_submission` true; answers changed through a test fixture that bypasses the trigger make verification false; a new definition version leaves old submissions and their verification untouched; officer at another station refused, submitter refused, in-scope officer approves, second terminal decision refused; returned then corrected submission links by `corrects_id`; void rules; notifications created; isolation per table.
- [ ] **Steps 2–5:** FAIL → migration → PASS → commit `feat(db): versioned forms, append-only submissions, signatures and approvals`.

### Task 4: Permissions, templates, validators

**Files:** `packages/auth/src/permissions.ts`, `packages/templates/src/roles.ts` (+ test), `packages/validators/src/{document,reading,form}.ts`.

- [ ] **Tests first:** every new permission is in the catalog and held only by the intended role templates (Member limited to view, acknowledge, submit); zod schemas reject unknown kinds, a version label over 40 characters, an empty audience, duplicate field keys, more than 200 fields, unknown field types, and a `show_if` that references a later or missing field; the zod form-definition validator and the SQL check accept the same shared fixtures.
- [ ] Add a starter pack to the department-type templates as editable data: folders (Policies and SOGs, Forms Library, HR, Training) and three form definitions (Incident/Injury Report, Vehicle Damage Report, Equipment Issue Receipt) with no copyrighted content. Commit `feat: documents, readings and forms permissions, validators and starter pack`.

### Task 5: Web servers and admin pages

**Files:** `apps/web/src/server/{documents,readings,forms}/*.ts`; admin pages for folders, readings and form definitions.

Server modules stay thin: validate with zod, open the request transaction with the caller's RLS context, call the `app.*` function, map database errors to clear messages (as in leave and trades). Uploading a version uses `uploadAttachment` with entity `document_version`, then `add_document_version`; downloads use `getSignedUrl`. The submit action passes the request IP and user agent into `submit_form`. The form admin page is a field-list editor (add, reorder, type, required, options, show-if) with a live preview using the same renderer members see, and says "saving creates a new draft version; publishing retires the old one".

- [ ] **Tests (web DB):** a member's folder list excludes restricted folders; publish flow end to end through the server module; error mapping for already-acknowledged, superseded version, hidden field with value, signature mismatch. Commit `feat(web): document, reading and form servers and admin pages`.

### Task 6: Pages and e2e

**Files:** `/documents` (folder tree, search by title or number, detail with version history, *Upload new version*, *Publish*), `/sogs` (**My required reading** with due dates and *Read and acknowledge*, plus the published SOG library; officers see a unit status table), `/forms` (available forms, fill-in page rendered from the definition, signature pad with draw and type modes, My submissions, officer *Pending approval* tab); nav entries `Documents`, `SOGs`, `Forms`; labels go through tenant terminology overrides. The signature pad is keyboard-operable with the typed alternative always offered.

- [ ] **Playwright:** a chief uploads an SOG, publishes it and assigns it to all members with a due date; a member sees it under required reading, opens the PDF, acknowledges, and the chief's status table shows them; the chief publishes a major revision, the member sees a new required reading and the old acknowledgement stays in history; a restricted HR folder is invisible to a member. A member fills and signs the injury report by drawing, and another by typing; the company officer at their station approves one and returns the other with a note; the submitter corrects and resubmits; an officer at another station sees neither; *Verify* shows intact. axe on all three pages, the fill-in form and the signature pad; 390 px without horizontal overflow (tables become stacked cards; the pad scales to fit).
- [ ] Commit `feat(web): documents, SOGs and forms pages`.

### Task 7: Docs and full verification

- [ ] Add a Documents, SOGs and Forms section to `docs/DEVELOPMENT.md` (data model, who can do what, version and acknowledgement rules, the hashing definition, how to add a form, how reminders are scheduled). `pnpm lint && pnpm typecheck && pnpm db:reset && pnpm test:unit && pnpm test:db && pnpm -F @soma/web e2e` → pass. Commit `docs: documents, SOGs and forms`; open a draft PR.

---

## Deferred

- **E-signature compliance pass (research 04 A1-A2), needed before relying on these as legal evidence:** PDF/A rendering of each submission and signed document; platform seal (PAdES-B-LT with an organization key in a KMS or HSM plus an RFC 3161 timestamp); step-up authentication (PIN or MFA re-entry) at signing; ESIGN consumer-consent screens and a public signing link for non-members (ride-along and patient-facing waivers); per-form signature policy (method, witness, countersign order); device time next to server time for offline; per-agency acceptance rules under UETA section 18; counsel review of the consent statements. Today's hash shows the stored record was not altered after submission; it does not make an exported file tamper-evident.
- Records core: retention schedules and record series, destruction log, legal hold, WORM storage, sensitivity labels on every artifact.
- Form engine growth: repeating sections, calculations, photo, GPS and barcode fields, prefill from roster, multi-step and parallel approval chains with SLAs, PDF mapping to official forms (OSHA 300/301, exposure and sharps logs), exports.
- Documents and SOGs: owner review-cycle reminders (`review_every_months` is stored, not acted on), redline or diff between versions, approval workflow before publish (author, training, chief, medical director), upstream-with-local-override libraries and policy subscriptions, full-text and OCR search, per-document ACLs, auto-assignment of readings to new hires.
- Medical protocols and dosing references (own phase, with offline viewer and the SaMD review); quizzes and Daily Training Bulletins linked to readings; training classes and course content (Phase 2); offline form sync; ePCR.

## Open questions for the owner (recommended default in brackets)

1. Should acknowledging an SOG require typing your name, or is a click plus checkbox enough? [Click by default; the assigner can require a typed name per reading.]
2. When a new version is published, must members re-acknowledge? [The publisher picks "major" or "minor" each time; major re-assigns to the same audience, minor does not.]
3. Who can see HR and other restricted folders? [Chief and Admin only, set per folder by a permission code.]
4. How long should members have to read a new SOG, and how often should reminders go out? [Due date per assignment, default 14 days; reminders at assignment, 7 days before, on the due date, then weekly while overdue.]
5. Which forms need an officer's sign-off in the first release? [Incident/Injury and Vehicle Damage reports (the member's own company officer approves); the Equipment Issue Receipt needs none.]
6. Is a drawn or typed on-screen signature acceptable for internal forms now, with legal-grade sealing later? [Yes; confirm with city or county IT and counsel which forms need more, such as anything given to the public.]
7. Should a corrected submission replace the original in lists? [No; the original stays visible and marked "corrected by", since nothing is edited.]
8. Import existing SOGs and forms from NinthBrain now? [Not in 4a; upload current PDFs as version 1 of each SOG and rebuild forms in the builder; an importer is a separate task.]
