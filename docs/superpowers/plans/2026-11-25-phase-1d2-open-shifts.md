# Phase 1d-2 — Open Shifts and Vacancy Fill

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** An officer posts an unfilled seat and time as an **open shift**; members with the claim permission claim it; an officer covering that station approves one claim, which creates the assignment. First come, first approved: claims are listed in the order made.

**Architecture:** Same pattern as shift trades. `open_shifts` and `open_shift_claims` are written only through `security definer` functions (`post_open_shift`, `cancel_open_shift`, `claim_open_shift`, `withdraw_claim`, `decide_claim`). Approval inserts the `shift_assignments` row inside the function, so the roster's overlap constraints are the conflict check. The web layer pre-checks qualification with the same `checkQualification` engine as trades; waiving a block needs `scheduling.qualification.override` at the seat's unit plus a reason, which the database re-checks.

## Global Constraints
- Earlier constraints apply (RLS + isolation test per tenant table, scope checks in SQL, no hard deletes, audit, axe, 390 px).
- Posting/cancelling/deciding needs `scheduling.roster.edit` at the **seat's unit**. Claiming needs the new `scheduling.openshift.claim`. Nobody decides their own claim.
- A claim for a time overlapping the member's own scheduled (non-Kelly) shift is refused. One pending claim per member per open shift.
- Approving one claim marks the open shift filled and supersedes the other pending claims (all are notified).
- Out of scope: call-back lists and mandatory hold-over ordering, special pay rules, leave limits.

## Review Focus
1. Claiming an overlapping time, or claiming twice → refused (Task 1).
2. An officer outside the seat's unit posting/deciding → refused (Task 1).
3. Two claims, one approved → the other superseded; second approval impossible (Task 1).
4. Unqualified claimant → blocked unless an authorised override with reason (Task 2 e2e).

## Tasks
1. DB: `supabase/migrations/20261124000023_open_shifts.sql` + `packages/db/tests/open-shifts.test.ts` (written first).
2. Permission, role templates + test, validators, web server (`server/scheduling/open-shifts.ts`), actions, `/open-shifts` page, nav, `e2e/open-shifts.spec.ts`.
3. Docs section, full verification on a fresh DB, draft PR against `phase-1d-trades`.
