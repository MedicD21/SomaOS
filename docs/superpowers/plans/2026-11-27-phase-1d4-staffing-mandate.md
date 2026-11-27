# Phase 1d-4 — Minimum Staffing, Temporary Transfers and the Mandate List

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Source:** research 06 §5 items 9–11 and §8.5 (Delaware County EMS). Item 12 (out-of-class lists) is not in this slice.

**Goal:** The roster knows the department's minimum staffing and says, for any day, whether it is met. When a unit is
short and the department is at or above its minimum, it suggests a temporary transfer (TT) from a unit with a surplus.
When the department is below its minimum, it suggests the next member up on an easy-to-edit mandate list, records the
mandate (which fills the seat) and rotates the list. Every change is audited.

**Nothing is hard-coded to one department.** The ALS definition, the department minimum and the per-unit rule are
tenant configuration. Delaware County's numbers (25 ALS; 2 ALS per ambulance; Paramedic and AEMT count as ALS) are the
starter draft, which an administrator approves or edits.

## Architecture

### 1. Staffing rules are configuration (`config_versions`, kind `staffing.rules`, key `default`)
Versioned, effective-dated and approved like shift patterns, so a change in the rule is dated and audited. Payload
(`StaffingRules` in `@soma/schedule-engine`, validated by `staffingRulesSchema` in `@soma/validators`):

```ts
{
  groups: [{ key: 'als', label: 'ALS', credentialKeys: ['paramedic', 'aemt'] }],
  departmentMinimums: [{ group: 'als', min: 25 }],
  unitRules: [{ group: 'als', unitTypeKey: 'unit', min: 2 }],
}
```

- A **group** is a set of credential types (by key, so the payload is portable between departments). A member counts
  for a group on a shift when they hold any of its credentials, valid through the end of that shift (same rule as
  seat gating).
- **Department minimum:** distinct members in the group on duty that day across all seats.
- **Unit rule:** every org unit of type `unitTypeKey` that has active seats must have at least `min` group members.
- The template seeds the payload above as a **draft** (nothing is enforced until approved), like leave and pay rules.
- Admin page: **Admin → Scheduling → Staffing rules** (needs `scheduling.config.manage` to save a draft and
  `admin.config.manage` to approve, the same split as patterns).

### 2. Evaluation is a pure engine function (`packages/schedule-engine/src/staffing.ts`)
- `evaluateStaffing(rules, day)` takes the day's seated assignments (member, unit, unit type, seat, group keys) and
  returns the department counts against each minimum, per-unit counts, and violations with `Explain` traces.
- **Checked minute by minute** (owner, 2026-11-27: the minimum applies even to a 20-minute dip). The window is the
  operational day: 24 hours from the shift pattern's start time on date D. Every scheduled, seated shift overlapping
  it counts while it is on, so split seats (06–12 / 12–06) and the previous day's crew are counted correctly. A
  check's count is the lowest head count at any moment; each violation lists the times below the minimum. Kelly,
  training and detail rows hold no seat and do not count.
- `suggestTransfers`: only when the department minimum holds for the whole window. For each short unit, a shift is
  moved from another unit of the same type only if the donor still meets `min` at every moment afterwards (Delaware:
  a unit with 3 ALS) and the short unit's gap shrinks. Donors with the biggest surplus go first; within a donor, a
  member in a seat with no minimum rank is preferred (so the officer is not moved), then the highest-sorted seat. Suggestions only: the officer makes the move with the
  existing Cancel and Fill (applying a TT in one step is a follow-up).
- `mandateCandidates(entries, context)`: walks the list in order and returns each member with a status: `eligible`,
  `exempt` (reason, until), `working` (already scheduled at that time), `on_leave` (pending or approved leave that
  day), `not_qualified` (not in the group) or `separated`. The first `eligible` members are the suggestions, one per
  hole. Holes = the shortfall against the department minimum after any TTs.

### 3. Mandate list tables (migration `20261127000010_mandate_lists.sql`)
- `mandate_lists` — named lists (a department may keep one per platoon, or one overall).
- `mandate_list_entries` — `(list, member, position, exempt_reason, exempt_until, status active|removed)`. One active
  entry per member per list. Positions are dense 1..n.
- `mandate_events` — append-only history: `added`, `removed`, `reordered`, `exempted`, `unexempted`, `skipped`,
  `mandated`, with reason, actor, time, and for `mandated` the assignment created.
- Writes only through `security definer` functions with scope checks in SQL; no direct insert/update/delete; audit
  trigger on all three tables; `mandate_events` has no update path at all.
  - `app.create_mandate_list(name)`, `app.mandate_add(list, member)` (appended at the bottom),
    `app.mandate_remove(list, member, reason)`, `app.mandate_reorder(list, member_ids[], reason)` (must be exactly the
    active members), `app.mandate_set_exempt(list, member, reason, until)` (`reason` null clears it),
    `app.mandate_skip(list, member, reason, on_date)` (passes this member for one hole; position kept).
    All need department-wide `scheduling.mandate.manage`.
  - `app.mandate_record(list, member, seat, start, end, reason, override)` creates the `overtime` assignment (the
    roster's overlap constraints refuse a double-booking), moves the member to the bottom, logs `mandated` and
    notifies the member. Needs `scheduling.mandate.manage` **and** `scheduling.roster.edit` at the seat's unit. An
    override reason needs `scheduling.qualification.override` there (the web layer checks the credentials with the
    same engine as manual fills; the database re-checks the permission).
- Read: anyone with `scheduling.roster.view` sees lists, positions and history (a mandate list is meant to be
  transparent to the crews it rotates).

### 4. UI
- **Roster page:** a staffing banner per day (department count vs each minimum), each unit table flags a unit-rule
  violation, TT suggestions when the department is at or above minimum, and mandate suggestions with a link to the
  list when below.
- **`/mandate`** page: pick a list; ordered list with drag-to-reorder **and** Move up/Move down buttons (keyboard and
  screen-reader users), add member, exempt/clear, skip, remove, each with a reason; a "Mandate" form for a vacant seat
  with the next member up pre-selected; recent history.

## Global Constraints
- Earlier constraints apply (RLS + isolation test per tenant table, scope checks in SQL, no hard deletes, audit, axe, 390 px).
- New permission `scheduling.mandate.manage` (department-wide). Starter roles: department admin and officer roles.
- Every list change needs a reason of at least 5 characters, except adding a member and creating a list.

## Review Focus
1. Reorder with a missing, extra or duplicate member → refused (Task 1).
2. A user without department-wide `scheduling.mandate.manage`, or another tenant's user → refused/isolated (Task 1).
3. Recording a mandate double-booking the member or the seat → refused, list unchanged (Task 1).
4. TT never takes a donor below its unit minimum; no TT while the department is below minimum (Task 2).
5. Exempt, working, on-leave and unqualified members are never suggested (Task 2).

## Tasks
- [x] 1. DB: migration + `packages/db/tests/mandate-lists.test.ts` (written first): isolation for the three tables, permission
  checks, reorder validation, skip/exempt/remove, record → assignment + rotation + event, double-booking refused.
- [x] 2. Engine: `staffing.ts` + `tests/staffing.test.ts` (written first): counting, unit violations, credential validity at
  shift end, TT rules, mandate candidate statuses.
- [x] 3. Permission, starter roles, validators, template draft rules, web server (`server/scheduling/staffing.ts`,
  `server/scheduling/mandate.ts`), roster banner and flags, `/admin/scheduling/staffing`, `/mandate`, nav,
  `e2e/mandate.spec.ts`.
- [x] 4. Docs section in `DEVELOPMENT.md`, full verification, PR (not merged).

## Defaults applied until the owner answers (change any of them in review)
- A mandate moves the member to the **bottom** of the list. A skip keeps their position.
- Exempt members keep their position and are passed over until the exemption ends or is cleared.
- The list order is set by hand (drag or buttons). No automatic seniority or hours ordering.
- A mandated shift is recorded as type `overtime`.
- Members already scheduled at that time, on pending or approved leave that day, separated, or not in the group are
  passed over automatically and shown with the reason.

## Questions for the owner (not guessed; the defaults above apply until answered)
1. **SOG 130 Mandatory Overtime:** what does it say? Please share the text or the rules it sets.
2. **Order:** how is the list ordered to start with: seniority (department or classification), fewest overtime hours,
   last mandated date, or a fixed rotation?
3. **Reset:** does being mandated move you to the bottom? Does working voluntary overtime or a TT also count as your
   turn? Does refusing count?
4. **Exemptions:** who is exempt and for how long (probation, light duty, FMLA, hours worked in the last N hours,
   already mandated this pay period)? Is there a maximum number of mandates per member per period?
5. **One list or several:** one department list, one per platoon, or one per rank (Paramedic vs AEMT)?
6. **Which holes:** is mandating only for the department minimum (25 ALS), or also for a unit below 2 ALS when no TT is
   possible? This slice suggests mandates only for the department shortfall.
7. **Who mandates:** only Captains, or also Lieutenants? (This decides who gets `scheduling.mandate.manage`.)
8. **Hold-over vs call-in:** is the mandated member held over from the off-going shift or called in from off duty?
   This slice does not distinguish them.
9. **TT details:** may a Lieutenant be moved in a TT? Is mileage recorded for a TT (CBA 17.3)?

## Known limits
- TT suggestions are not applied in one step; the officer cancels and fills.
- Out-of-class (acting Lieutenant/Captain) eligibility lists are research item 12, not in this slice.
