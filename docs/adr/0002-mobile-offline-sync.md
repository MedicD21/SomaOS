# ADR 0002 — Offline mobile: PowerSync reads, mutation-queue writes

**Status:** Proposed (2026-11-25) — awaiting owner review of the open questions in
`docs/superpowers/plans/2026-11-25-mobile-offline.md`.

## Context
Master design §5.7 and ADR 0001 pick Expo plus PowerSync. Since then the data layer hardened: PostgREST is disabled,
the web server runs SQL as role `authenticated` with verified JWT claims, RLS is on every table, every write is a
`security definer` function in schema `app`, and ledgers (stock, custody, leave, pay) are append-only. Tablets in rigs
must keep working for hours without signal (research 05 §6.1).

## Decision
1. **Read path: PowerSync** (Postgres -> encrypted SQLite on device). Replication bypasses RLS (PowerSync's docs have
   the replication role hold `BYPASSRLS`), so **sync streams are the read-authorization layer**. Each stream is
   parameterized from verified token claims (`tenant_id`, member id, unit/station scope) and is tested against the
   RLS policies for the same data (parity test).
2. **Write path: we do not use PowerSync's CRUD upload as table writes.** The app never writes synced tables. It
   writes **intents** to a local `outbox` table (insert-only, client UUID = idempotency key). The PowerSync upload
   connector POSTs outbox rows, in order, to `apps/web` (`/api/mobile/mutations`). The server maps each `kind` to the
   existing SQL function, runs it with `withUserDb` as the real user (role `authenticated`, RLS and in-function scope
   checks apply), and records `(tenant_id, member_id, client_id)` in a `mutation_receipts` table in the same
   transaction. A replay returns the stored result. No new write path bypasses "no direct table writes".
3. **Conflict policy by data class:** append-only events merge trivially (server orders by receipt, device time kept
   as evidence); configuration, roster edits and approvals are **online-only**; single-author drafts (ePCR, later) use
   an owner lock and post-then-amend.
4. **Offline-first scope, in order:** rig/daily checklists, stock use, attendance sign-in, then (later phase) ePCR drafts.
   Controlled-substance custody movements are **excluded** from offline until the DEA workflow is verified (witness
   must confirm from their own session).
5. **Device trust:** SQLCipher database (PowerSync supports it via the OP-SQLite adapter), key in the OS keystore,
   idle lock, server-side device revocation plus local wipe on next contact, PHI minimization (no PHI synced until
   Phase 5).
6. **Apps:** `apps/mobile` (Expo dev-client build; Expo Go cannot load the native SQLite adapters) and shared
   framework-free packages (`validators`, `mobile-ui`, a new `mutations` contract package).

## Alternatives rejected
- ElectricSQL: read-path only like PowerSync, but React Native support is described as community-level (research 05
  §6.3, a PowerSync-authored comparison; unverified here). Kept as the fallback if the PowerSync spike fails.
- WatermelonDB: maintenance and Expo New Architecture problems (research 05 §6.6). Zero: web-first, no offline.
- PowerSync default CRUD upload applying row writes directly: would need table write policies, contradicting ADR 0001
  and the append-only/ledger design.
- Generic CRDTs: unnecessary for structured, mostly append-only records.

## Consequences
- Sync streams duplicate part of the authorization model (dual maintenance, research 05 §6.2); parity tests are
  mandatory CI.
- Every offline-capable action needs an idempotent server mutation and a `kind` in the shared contract.
- Rules that need live evaluation (schedule, pay, approvals) stay online by design.
- Unverified facts (stream parameters from custom claims with Supabase JWTs, hosted-vs-self-hosted HIPAA terms,
  op-sqlite plus Expo config plugins on current SDK) are spike tasks S1-S4 and gate Stage 1.
