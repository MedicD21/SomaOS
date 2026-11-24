# Phase 1d-1 — Shift Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Checkbox steps.

**Goal:** Members swap shifts with each other. A member proposes a swap, the other member accepts, and an officer who covers both stations approves. The swap is then made on the roster in one step, with every roster rule still enforced.

**Architecture:** `shift_trades` records the proposal and its state. Every write goes through `security definer` functions that check the caller in SQL (like leave). Approving swaps the two assignments' members in one statement, so the database's overlap rules (a member can't be in two places, a seat can't be double-filled) are the conflict check. Qualification (credentials, rank) is evaluated in the web layer with the same engine as manual fills and can be waived only by someone holding `scheduling.qualification.override`, with a reason, which the database re-checks.

## Global Constraints
- Earlier global constraints apply (RLS + isolation test on every tenant table, scope checks in SQL, no hard deletes, axe, 390 px layout, audit).
- A trade is between exactly two future, scheduled, non-Kelly shifts that have seats; each belongs to a different active member. Proposing needs `scheduling.trade.request` (new permission, given to member-type roles).
- Only the counterparty answers a proposal. Either party can withdraw before approval.
- Approving needs `scheduling.roster.edit` at **both** seats' units, and the approver may not be a party. Overriding a qualification block needs `scheduling.qualification.override` at both units and a reason.
- An assignment can be in at most one open trade. If either shift changes (cancelled, moved, reassigned) before approval, approval is refused with a clear message.
- Swapped shifts become type `trade` (paid by the pay rules' `trade` mapping) and record the original type in their explain trail.
- Out of scope (later slices): hours-owed / payback trades, one-way give-aways and open vacancy fill with call-back lists (1d-2), leave limits per shift or station (1d-3), trade limits per member.

## Review Focus
1. A member proposing with someone else's shift, a past/Kelly/cancelled shift, or a seatless shift → refused. Task 1.
2. Approval by someone outside either station, or by a party → refused. Task 1.
3. A shift changed after the proposal → approval refused; nothing swapped. Task 1.
4. A swap that would double-book a member → refused by the database, nothing swapped. Task 1.
5. Unqualified member in the other's seat → blocked unless an authorised override with reason. Task 2.

## Tasks
### Task 1: Database
`supabase/migrations/20261124000022_shift_trades.sql`: table, partial unique indexes for open trades, RLS (parties, or holders of `scheduling.roster.edit` at either seat's unit), audit, functions `request_trade`, `respond_trade`, `cancel_trade`, `decide_trade(id, approve, note, override_reason)`. Tests `packages/db/tests/shift-trades.test.ts` written first.

### Task 2: Permission, validators, web server
`scheduling.trade.request` in the catalog and member-type roles; `packages/validators/src/trade.ts`; `apps/web/src/server/scheduling/trades.ts` (loaders, qualification pre-check, approve); actions.

### Task 3: Pages and e2e
`/trades` (my upcoming shifts → propose; incoming offers; my proposals; approvals queue for officers) with nav; `e2e/trades.spec.ts` (propose → accept → officer approves → both rosters swapped; out-of-scope officer sees nothing; unqualified blocked; decline/withdraw; 390 px, axe).

### Task 4: Docs and verification
DEVELOPMENT.md section; lint, typecheck, unit, db, e2e on a fresh DB; draft PR.
