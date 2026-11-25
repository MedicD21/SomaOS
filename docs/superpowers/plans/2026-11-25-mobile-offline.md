# Mobile and Offline-First (Expo + PowerSync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This document is a plan and decision record only; Stage 0 is a time-boxed spike and its results update this plan before Stage 1 starts.**

**Goal:** Crews complete rig/daily checklists, record stock use and sign in to drills/shifts on a tablet or phone with no signal for hours, with nothing lost, and everything applied on reconnect through the same permission-checked SQL functions the web app uses.

**Architecture:** PowerSync streams a per-user subset of Postgres into an encrypted on-device SQLite database (read path). Writes never touch synced tables: the app inserts intents into a local `outbox`; an upload connector sends them in order to a Next.js endpoint that replays the existing `app.*` functions as the real user with an **idempotency key**. Decision and rejected options: `docs/adr/0002-mobile-offline-sync.md`.

**Tech Stack:** Expo (dev-client builds), React Native, PowerSync React Native SDK with the OP-SQLite adapter and SQLCipher, Zod (shared). New dependencies, all in `apps/mobile` and one contract package. Versions pinned at Stage 0.

**Spec:** master design §5.7 (offline, conflict policy), §6 Phase 3 (rig checks offline), §6 Phase 4/5 (forms, protocols, ePCR), §8 (security); research 02 §3.1 and 03 (checks), 04 (offline forms, server sealing, device and server time), 05 §6.2-6.6; ADR 0001.

## Global Constraints

- All earlier constraints apply (strict TS, RLS + isolation tests, scope checks in SQL, no hard deletes, append-only ledgers, audit).
- **No direct table writes from any client.** The device writes only to its local `outbox`. The server applies each mutation by calling an existing `app.*` function (or a thin new wrapper) as the authenticated user; the offline path gets no privileges the online path lacks.
- **Idempotency:** every outbox row has a client-generated UUID. The server stores `(tenant_id, member_id, client_id) -> result` in `mutation_receipts` in the same transaction as the effect; a replay returns the stored result and changes nothing.
- **Never silently drop.** A rejected mutation stays visible to the user (status `rejected` plus reason) until acknowledged; sync state is always on screen.
- **Time:** every outbox row carries device time and device monotonic offset; the server adds receipt time. The server's time is authoritative for ordering, the device time is stored as evidence (research 04).
- **Minimum necessary:** the device holds only what the user's streams allow. No PHI is synced before Phase 5 (field-level tagging per master design §5.3 must exist first).
- Sync stream definitions are code-reviewed like RLS policies and have a parity test against RLS.
- Out of scope: ePCR/NEMSIS offline (later plan), protocol viewer (Phase 4), controlled-substance custody offline, schedule/roster editing, leave approval, pay close, offline admin config, push notifications, web (PWA) offline, tablet MDM product choice.

## Key Decisions

| Topic | Decision | Why |
|---|---|---|
| Sync engine | PowerSync | Master design and research 05; official Supabase integration; SQLCipher; self-host option. Fallback ElectricSQL (reads) with the same outbox. |
| Read authz | Sync streams parameterized from verified token claims | Replication role bypasses RLS (PowerSync Supabase guide), so streams must enforce tenant/unit scope. |
| Write path | Outbox -> `/api/mobile/mutations` -> `withUserDb` -> `app.*` fn | Keeps RLS, in-function scope checks, audit and hash chains. |
| Conflicts | By data class, below | Matches master design §5.7. |
| Auth offline | Cached refresh token + local unlock; reads work offline, mutations queue | See Auth. |
| Build | Expo dev client / EAS builds, not Expo Go | Native SQLite adapters do not run in Expo Go (PowerSync docs). |

## Offline Scope and Conflict Policy

| Data class | Offline? | Mutation `kind` -> server function | Conflict policy |
|---|---|---|---|
| Checklist completion (rig/daily) | Yes, first | `checklist.complete` -> `app.complete_checklist` | Append-only event; each completion is its own row, no merge needed. Defect-to-work-order follow-ups run server-side after apply. |
| Stock use (station/med, non-controlled) | Yes | `stock.use` -> `app.use_stock` | Append-only ledger; a use that would take a location below zero is **rejected with a reason**, not clamped (existing rule), and surfaced to the user and officer. Count may diverge from device view until sync; expected. |
| Attendance / drill sign-in | Yes (needs a new attendance function; Phase 2 dependency) | `attendance.signin` | Append-only; duplicates collapse by idempotency key and by (member, event) unique key. |
| Photos and attachments | Yes | file queue, then `attachment_recorded` | Upload resumable; record created after upload; orphan sweep job. |
| Schedule, my shifts, protocols, item catalog | Read-only cache | none | Server wins; staleness banner with last-sync time. |
| Leave/trade/time requests | Queue allowed later | `leave.request` etc. | Evaluated on sync (master design §5.7); not in alpha. |
| Roster edits, approvals, pay close, config, templates | **Online-only** | none | Need live rule evaluation. |
| Controlled-substance custody | **Online-only** until verified | none | Witness must confirm from own session; revisit after the DEA review (Phase 3b). |
| ePCR draft (later) | Yes, later plan | `epcr.*` | One author per chart (owner lock), row-level merge for repeating rows by client UUID, post then amend. |

Rejection handling: server returns `applied | duplicate | rejected(reason, retryable)`. Retryable errors (network, 5xx) back off; non-retryable stay in a "needs attention" list. Later outbox rows that depend on a rejected one (same checklist, same item) are held, not applied out of order.

## Auth, Session and Device Security

- **Auth:** Supabase Auth session (password + TOTP; admin and PHI roles need MFA). PowerSync is given a short-lived token fetched while online. Offline, the app uses the stored session only to identify the local user; the server re-verifies everything on sync, so an expired or revoked session simply makes uploads fail with `401`, queued data stays.
- **Offline unlock:** device biometric/PIN gate (idle lock, default 5 min, tenant-configurable). Refresh token and the SQLCipher key live in the OS keystore (`expo-secure-store`, accessible-when-unlocked-this-device-only). Verify in S3.
- **Max offline age:** tenant setting (default 14 days); after it the app locks reads until a successful online refresh.
- **Revocation and remote wipe:** `mobile_devices(tenant_id, member_id, device_id, status, last_seen)` table (new, RLS, audited). Suspending a member or revoking a device makes uploads/sync fail; the app then wipes the local DB on its next contact, and the lock screen offers no data. Honest limit: an offline stolen device keeps data until it reaches the network, so encryption at rest, keystore binding, idle lock and the max-offline-age are the real controls; MDM wipe is a customer option.
- **Encryption:** SQLCipher via the OP-SQLite adapter (documented by PowerSync). Not available in Expo Go or on web. Outbox lives in the same encrypted database, so unsynced work is protected too.
- **PHI minimization:** streams exclude PHI-tagged columns until Phase 5; logs and crash reports must never contain row data; screenshots disabled on PHI screens (later).

## Monorepo Structure

```
apps/mobile/                      Expo app (dev client), expo-router screens, PowerSync provider, lock screen
  src/sync/{schema.ts,connector.ts,outbox.ts,status.ts}
  src/features/{checklists,stock,attendance}/
packages/mutations/               Zod contract: kinds, payloads, results (shared by mobile and web)
packages/mobile-ui/               shared RN components (master design §4)
apps/web/src/app/api/mobile/mutations/route.ts    verifies session, withUserDb, dispatch, receipt
apps/web/src/server/mobile/dispatch.ts            kind -> app.* function map
sync/streams.yaml                 sync stream definitions (reviewed like policies)
supabase/migrations/…_mutation_receipts.sql       mutation_receipts, mobile_devices
packages/db/tests/{mutation-receipts,sync-stream-parity}.test.ts
apps/mobile/e2e/                  airplane-mode scenarios (see Acceptance)
```

Existing packages (`validators`, `auth`) are reused; `packages/db` stays framework-free. Run `pnpm test:unit` for contract tests; DB tests follow existing `pnpm test:db`.

---

## Stage 0: Spike (time-box 1 week, throwaway code in `spikes/`, no production schema)

Answers to record in an appendix of this plan before Stage 1:

- [ ] **S1 Streams from our claims.** Can a PowerSync stream be parameterized from the Supabase JWT (`tenant_id`, member id) and a unit/station list derived from grants? Is a per-member stream set expressible without duplicating the grant evaluator? (Unverified here.) Pass: user A's device receives no row of tenant B or a unit they lack, on seeded data.
- [ ] **S2 Replication role.** Create a `BYPASSRLS` replication role on local Postgres (PowerSync documents this); confirm it does not weaken `authenticated` access and that our `rls-coverage` test and the role-membership rules in `docs/DEVELOPMENT.md` still hold. Decide hosted PowerSync Cloud vs self-hosted (HIPAA terms, cost; both unverified in this repo).
- [ ] **S3 Device encryption and keys.** Expo dev client + `@powersync/op-sqlite` with SQLCipher on a real iPad and an Android tablet; key from secure store; DB unreadable off-device; check the Expo config-plugin and monorepo `package.json` flag handling; measure cold open time.
- [ ] **S4 Outbox replay.** Prototype `outbox` -> endpoint -> `app.use_stock` / `app.complete_checklist` as `authenticated`; confirm in-function checks (`app.my_member_id()`, unit scope) work through the endpoint, and that a replayed key is a no-op under concurrency (two uploads racing).
- [ ] **S5 Upload ordering and failure.** How does the PowerSync connector behave on a rejected item (blocks the queue vs skip)? Our design needs "hold dependents, surface the rest". Read the connector docs and test; if the SDK queue cannot do this, run our own outbox sender and use PowerSync for reads only.
- [ ] **S6 Size and speed.** Sync a realistic unit (items, lots, templates, 90 days of schedule) and record size, first-sync time on LTE, and reconnect-after-8h time.
- [ ] **Go/no-go:** write results and the final engine choice (PowerSync vs ElectricSQL fallback) into ADR 0002 and flip it to Accepted.

## Stage 1: Plumbing (server)

- [ ] `mutation_receipts(tenant_id, member_id, client_id, kind, result jsonb, applied_at, device_id)` unique `(tenant_id, member_id, client_id)`; RLS select-own, no direct writes; audited; isolation test; `mobile_devices` likewise.
- [ ] `packages/mutations`: Zod discriminated union for the first three kinds; result type; unit tests (payload validation, unknown kind rejected).
- [ ] `POST /api/mobile/mutations`: verify session, reject revoked device/member (401), one DB transaction per mutation (apply + receipt), return `applied|duplicate|rejected`. Tests: replay returns the same result with one ledger row; member lacking permission is `rejected` and nothing written; other tenant's id is rejected.
- [ ] `sync/streams.yaml` + parity test: for seeded users with different grants, the set of rows a stream yields is a subset of what `authenticated` can select under RLS (run both and compare). CI-required.

## Stage 2: Mobile shell and read path

- [ ] `apps/mobile` scaffold, login, MFA, device registration, lock screen, encrypted DB, sync status bar (last sync, pending count, attention count).
- [ ] Read-only screens: my shifts, rig list, checklist templates, items and locations for my unit. Staleness banner.

## Stage 3: Alpha features (one at a time, each with its airplane-mode test)

- [ ] Checklist completion (photos queued). [ ] Stock use. [ ] Attendance sign-in (after Phase 2 attendance function exists). Each is a `kind` + server mapping + screen + e2e.

## Acceptance Tests (airplane mode, real device or emulator with network toggle)

1. Airplane mode, complete a rig checklist with 2 photos and a failed item, close the app, reboot the device, reconnect: exactly one completion, photos attached, work order created once.
2. Offline stock use of the same item on two tablets taking the location to zero: the first applied, the second `rejected` with a visible reason; no negative balance.
3. Replay: kill the app mid-upload and restart: no duplicate rows (receipt count equals ledger rows).
4. Revoke the member while the device is offline: after reconnect, uploads are refused, local DB is wiped, nothing readable at the lock screen. Queued items are reported to the officer, not lost server-side silently (decision in Q4).
5. 14-day-old session offline: reads locked per tenant setting; online refresh restores them.
6. Cross-tenant: a user in two departments never has both departments' rows on device; switching department clears and resyncs.
7. Lock: after idle timeout, no data visible without biometric/PIN; DB file is not readable without the key (inspect on a rooted/emulator image).
8. 8-hour offline day on a seeded unit completes with p95 first screen under 1 s from local data; reconnect drain under 60 s for 200 outbox rows.

## Review Focus

1. Any path where the device or the mobile endpoint writes a table not via an `app.*` function.
2. A stream that returns rows RLS would not (parity test must be the gate).
3. A replayed mutation producing a second effect (Acceptance 3, Task S4).
4. Key material or row data in logs, crash reports or backups (disable device cloud backup of the DB).
5. Rejected-mutation UX: can a user believe something was saved that was not?

## Open Questions for the Owner (recommended defaults)

1. **Hosted PowerSync Cloud or self-host?** Default: hosted for the alpha (BAA/HIPAA terms verified in S2); keep self-host as the exit.
2. **Which devices?** iPads and Android tablets only, or Windows rugged tablets too (research 05 notes Toughbooks are common)? Default: iOS and Android only; Windows via the web app online.
3. **Max offline age before reads lock?** Default: 14 days, tenant-configurable.
4. **What happens to queued work of a revoked member?** Default: apply nothing, wipe the device, notify the officer, and require re-entry on the web.
5. **Controlled substances offline?** Default: no, until the Phase 3b DEA review and a witness-over-sync design are done.
6. **Is offline attendance needed before Phase 2?** Default: build checklists and stock use first; attendance after the Phase 2 function exists.
7. **Managed devices (MDM) required for customers?** Default: recommended, not required; plan assumes unmanaged BYOD can still be wiped on contact.
