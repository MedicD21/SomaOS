# Leave type audience (built) and CE renewal tracking (plan only)

Two owner requests from research 06 (§5 items 8 and 18). Part 1 ships in this branch. Part 2 is a plan; build it after the owner answers the questions in §2.7.

Both stay tenant-configurable: nothing below is Delaware-specific in code. Delaware's lists live in its template draft.

---

## 1. Leave type audience (implemented)

**Problem.** Delaware's scheduling system shows all 38 leave types to everyone, including admin and discipline codes. Crew should see only the leave they can request themselves.

**Design.**
- `leave_types.audience text not null default 'member'`, check `in ('member','officer')` (migration `20261127000001_leave_type_audience.sql`).
  - `member`: anyone with `leave.request` can request it.
  - `officer`: only callers holding `leave.approve` (any scope) or `leave.manage`. Covers admin, discipline and officer-only codes.
- `app.can_use_officer_leave()` (definer, `authenticated`) answers "may the caller use officer types?".
- `app.request_leave` treats an officer type as **unknown leave type** for anyone else. The rule is enforced in SQL, not only in the UI. The function body is otherwise identical to `20261124000018`.
- **Reads stay open to the tenant** (no RLS change on `leave_types`). Members keep seeing the type name on requests they already have. Approvals, limits and pay keep resolving labels. Hiding the type from the request form is enough for the owner's goal, and the SQL check stops a hand-crafted request.
- Existing types default to `member`: no behaviour change until an admin restricts a type.
- `loadMyLeave` offers only the types the caller may use.
- Admin → Leave: "Who can request it" on Add leave type, and a per-type toggle under **Manage**. The list shows "officers and admin only".
- Validators: `leaveAudienceSchema`, `LEAVE_AUDIENCES`; `leaveTypeSchema.audience` (blank → `member`).
- Templates: `LeaveTemplate.types[].audience?` (default `member`), applied by `applyTemplate`.

**Delaware follow-up (not in this branch).** The Delaware template draft (`packages/templates/src/drafts/delco-ems.ts`, research PR MedicD21/SomaOS#25, unmerged) proposes `DELCO_CREW_LEAVE_KEYS`. Once both land, set `audience: 'officer'` on every Delaware type whose key is not in that list. Owner question 7 in research 06 still needs confirming first.

**Known limits.**
- A Lieutenant is crew in Delaware's bargaining unit but may hold `leave.approve`. If so, they see officer types. Fix with roles, not code: give Lieutenants a role without `leave.approve`, or accept it.
- Admin-entered codes (discipline, admin leave) can't yet be **entered for another member**. Today only self-requests exist, and `adjust_leave` changes balances only. Follow-up: `app.record_leave(member, type, start, end, note)` for `leave.manage` (or an approver in scope). It would create an approved request directly, reusing `decide_leave`'s shift and ledger logic. That's a separate change.

**Tests.** `packages/db/tests/leave-audience.test.ts` (default, check, crew refused, approver and manager allowed, helper, deciding after a type is restricted); `packages/db/tests/templates.test.ts` (audience carried); `apps/web/tests/db/leave-load.test.ts` (form options per caller); `packages/validators/tests/leave.test.ts`.

---

## 2. CE renewal tracking (plan)

**Owner request.** Track CE against Ohio and NREMT for each certification. Apply completed classes automatically. Give an easy audit view per member for renewals.

### 2.1 What exists (Phase 4b)
- `training_courses(category_id, default_hours, credential_type_id, completion_rule)`; `training_sessions`; insert-only `training_attendance`; `training_hours` view (member, category, credited_on, hours, never cached).
- `training_requirements(category_id, rank_id, role_id, required_hours, span)`: **hours in one category per window**, by rank or role.
- `credential_types(key, label, validity)`, `member_credentials(issued_on, expires_on)`; `credentialExpiry` in schedule-engine.
- Pure `trainingCompliance` in `packages/schedule-engine/src/training.ts`, shared by the web view and the reminder worker.

**Gap.** Requirements are flat category hours per rank. A renewal is different:
- it belongs to a **credential** (the member's NREMT Paramedic, their Ohio Paramedic);
- its window is **that credential's cycle** (issue to expiry), not a calendar or rolling window;
- it has **components** (National / Local-State / Individual) and, inside National, **topic areas** (Airway/Respiration/Ventilation, Cardiovascular, Trauma, Medical, Operations);
- one class can count toward **several** profiles at once (NREMT and Ohio);
- there may be **caps** (for example a distributive-education limit set by a state).

### 2.2 Data model (new)
All tenant data, archive-never-delete, writes through definer functions. Same pattern as Phase 4b.

1. **`ce_topics`** `(tenant_id, key, label, parent_id null)`: a tenant-editable topic tree. Seeded from a template with the NCCP national topics. Departments can add local topics (protocol update, SOG review).
2. **`ce_profiles`** `(tenant_id, key, label, credential_type_id, version, effective daterange, rules jsonb, status draft|approved)`: a renewal requirement set **attached to a credential type**, for example "NREMT Paramedic (2025 NCCP)" → credential type `nremt_paramedic`, and "Ohio Paramedic" → `oh_paramedic`. It's versioned like accrual policies (`config_versions`-style draft → approve) because the rules change (NCCP 2025 took effect 2025-04-01). `rules`:
   ```jsonc
   {
     "totalHours": 60,
     "components": [
       { "key": "national",   "label": "National",    "hours": 30,
         "topics": [{ "topic": "airway", "hours": null }, ...] },   // null = unverified, see §2.7
       { "key": "local",      "label": "Local/State", "hours": 15 },
       { "key": "individual", "label": "Individual",  "hours": 15 }
     ],
     "caps": [{ "format": "F3", "maxHours": null }],               // per-state distributive limits
     "overflow": "individual"                                        // surplus national/local hours spill here
   }
   ```
   Hour values ship as **draft placeholders flagged unverified** until the owner confirms them (§2.7). Nothing evaluates as authoritative until a profile is approved.
3. **`ce_course_credit`** `(tenant_id, course_id, profile_key null, component, topic_id null, hours null)`: how a catalog course counts. `profile_key null` means "every profile". `hours null` means the attended hours. A course can map to several components or topics, for example a 4 h ACLS refresher as 4 h National/Cardiovascular. Adds `capce_course_number` and `delivery_format (F1|F2|F3|F5)` to `training_courses`.
4. **`ce_credit_entries`** (view, not a table): one row per attended hour block, derived from `training_hours` × `ce_course_credit`. Plus **`ce_external_credits`** (insert-only table) for outside CE a member uploads: certificate file (Phase 4a documents), hours, component, topic, format, CAPCE number, and status `pending → accepted | rejected` by a training officer. NREMT doesn't accept course cards, so evidence is required (research 04 C2).

**Automatic application.** There's no copy step. Credit is a **view over attendance** (and accepted external credit). When an instructor completes a session, the hours land in every profile the course maps to. Corrections to attendance (superseding rows) flow through. This matches Phase 4b's "hours are a view, never a cached total".

### 2.3 Evaluation (pure, schedule-engine)
`ceRenewalStatus({ profile, credential: {issuedOn, expiresOn}, credits, today })` returns, per member credential:
- the window = `[issuedOn, expiresOn]` of the **current** credential row (NREMT cycles end 03-31, so the profile may override the window end);
- per component and topic: required, earned, remaining, plus an `explain` list of the credits used and why;
- allocation is deterministic: topic-specific national first, then national, local, individual, then overflow to individual; caps applied by format; each hour used once per profile but counted in every profile;
- status `met | on_track | due_soon | at_risk | lapsed`, reusing Phase 4b's thresholds (`dueSoonDays`, plus `at_risk` = remaining hours > hours of scheduled classes before expiry).

Unit tests: allocation order, overflow, caps, a class counting in two profiles, a correction superseding hours, the window boundary on expiry day, and a renewal (new credential row) starting a fresh window.

### 2.4 Views
- **Member → My CE**: one card per credential with a profile. A stacked bar per component (earned vs required), topic chips under National, days to expiry, and "N h short, next matching classes: …". Uploading an external certificate lives here.
- **Renewal audit (`/training/renewals`)**, for `compliance.view` in scope: a member × credential table with traffic-light status, filterable by unit, platoon, credential and "expiring in N days". Click through to a **per-member audit sheet**: every credit line (date, course, CAPCE #, format, hours, component/topic, evidence link, who verified) grouped by component. It's printable and exports to CSV/PDF for an NREMT or state audit. This is the "easy visual for renewal audits".
- The worker reuses `training-reminders`: one notification per (member, credential, window, level).

### 2.5 Tasks (TDD, one PR each)
1. Schema: `ce_topics`, `ce_profiles` (draft/approve), `ce_course_credit`, course `capce_course_number`/`delivery_format`; RLS + isolation tests.
2. `ce_external_credits` with document evidence and accept/reject functions; tests for scope and insert-only behaviour.
3. Pure `ceRenewalStatus` + tests (§2.3).
4. Server loaders + My CE page + external upload.
5. Renewal audit table + per-member sheet + CSV/PDF export; axe tests and a 390 px layout.
6. Reminders via the existing worker.
7. Templates: NCCP topic tree; **draft** profiles for NREMT EMT/AEMT/Paramedic and Ohio EMT/AEMT/Paramedic with hour fields left null (unverified) and a banner until approved.
8. Optional later: CAPCE AMS export, NREMT ID per member, NinthBrain CE history import.

### 2.6 Risks
- **Hour figures change** (NCCP 2025). Versioned, draft-then-approve profiles keep that out of code.
- **Double counting.** Allocation is per profile. The explain list makes every hour traceable.
- **State caps** (distributive education). Modelled as data per profile, not code.

### 2.7 Owner questions (unverified figures)
1. **NREMT 2025 NCCP hours per level.** Research 04 C2 verified Paramedic **60 h = 30 National / 15 Local-State / 15 Individual** only under the *pre-2025* model, from state documents. The **2025 EMT, AEMT and Paramedic totals, component splits and national topic hours are unverified** (nremt.org was unreachable). Please confirm from nremt.org or your NREMT dashboard.
2. **Ohio renewal hours** for EMT, AEMT and Paramedic, including any topic mandates and whether Ohio accepts the NREMT cycle as-is. **Unverified**: no primary source yet (research 06 §7 question 4).
3. **Department CE beyond Ohio and NREMT** (protocol updates, SCE, annual competencies): should these be a third "Delaware County EMS" profile?
4. **Distributive (F3) limits.** NREMT has none since 2022. Does Ohio cap online CE?
5. **Cycle dates.** Is the NREMT window the national cycle (ends March 31) and Ohio the certificate's own expiry? Do members' Ohio and NREMT dates differ?
6. **Evidence.** May members self-upload outside certificates for officer approval (recommended), or must the training officer enter them?
7. **Who sees the audit view**: training captain and shift captains for their platoon (recommended), or the training captain only?
