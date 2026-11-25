# Phase 1d-3 — Leave Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Cap how many members can be on approved leave on the same day (per station subtree and/or shift, optionally per leave type). Members can still request; **approving** a request that would put any day over a limit is refused unless an approver holding `leave.manage` gives an override reason.

**Architecture:** `leave_limits` (config, managed by `leave.manage`, RLS like pay codes) + `app.leave_limit_check(member, start, end, type)` (definer; one row per day × applicable limit with the count of *other* members already on approved leave in the same scope) + `app.decide_leave` gains an optional override reason and enforces limits at approval. A member counts for a day when an **approved** leave request covers that date (cancelled/denied/pending don't count). A member's scope is their current placement (primary assignment, else standing seat) — the same rule as leave approval.

## Global Constraints
- Earlier constraints apply (RLS + isolation test on config tables, scope in SQL, audit, axe, 390 px layout, no hard deletes → archive).
- Exactly at the limit is allowed; one over is refused (`on_leave + 1 > max_concurrent`).
- Override needs `leave.manage` (department) and a reason of ≥ 5 characters; the reason is recorded in the request's decision note.
- Out of scope: seniority auto-approval, waitlists, per-leave-type fairness, limits that depend on the roster's actual staffing.

## Review Focus
1. Boundary: at limit allowed, one over refused. 2. Subtree and shift scoping; leave-type-specific limits. 3. Effective dates. 4. Cancelled/denied/pending don't count. 5. Override needs permission and reason; plain approvers cannot waive.

## Tasks
1. `supabase/migrations/20261124000024_leave_limits.sql` + `packages/db/tests/leave-limits.test.ts` (tests first).
2. Validators, admin UI (Admin → Leave: limits list + add/archive), approvals page limit status and override field.
3. `e2e/leave-limits.spec.ts`; docs in `docs/DEVELOPMENT.md`; full verification; draft PR.
