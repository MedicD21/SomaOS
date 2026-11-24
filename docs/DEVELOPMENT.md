# SomaOS — Development Guide

## Prerequisites
- Node 22 (`.nvmrc`), pnpm 10
- Docker (for the local Supabase stack)

## First run
```bash
pnpm install
pnpm db:start        # local Supabase: Postgres, Auth, Storage, Mailpit
pnpm db:reset        # apply migrations + seed "Demo Fire Rescue"
pnpm env:local       # write apps/web/.env.local and apps/worker/.env.local
pnpm -F @soma/web dev     # http://localhost:3000
pnpm -F @soma/worker start   # background jobs (email, invites)
```

Dev logins (local only):

| Email | Password | Notes |
|---|---|---|
| admin@soma.local | somadev123! | Department admin — enrolls TOTP MFA on first sign-in |
| member@soma.local | somadev123! | Plain member |

Local email: Mailpit at http://127.0.0.1:54324.

## Tests
| Command | What |
|---|---|
| `pnpm test:unit` | Pure package tests (no DB) |
| `pnpm test:db` | Database tests: RLS isolation, triggers, functions; worker jobs (needs `pnpm db:start`) |
| `pnpm -F @soma/web e2e` | Playwright end-to-end (resets + seeds the DB, builds and starts the app) |
| `pnpm lint` / `pnpm typecheck` | Static checks |

## How data access works
- **Supabase PostgREST is disabled** (`supabase/config.toml` → `[api] schemas = []`). Browsers never query tables directly.
- The web server verifies the Supabase session, then runs SQL with `withUserDb` / `withCtxDb`: a transaction that sets
  `role authenticated` and the user's JWT claims. **Row-level security applies to every query.**
- The JWT carries `tenant_id` (the active department), added by `public.custom_access_token_hook` only when the user
  has an *active* membership.
- App-level permission checks (`requirePermission`, `check`) run first; RLS is the backstop. Writes to admin tables also
  require the matching `admin.*` permission inside RLS (`app.has_permission`).
- Only `apps/worker` and test harnesses use the service role.
- The tenant claim counts only while the user has an **active** membership in an **active** department
  (`app.tenant_id()` re-checks on every statement), so suspending a member cuts access immediately.
- Database-side admin checks require **department-wide** grants (`app.has_permission_dept`), and nobody can grant a
  permission they do not hold themselves.
- Accounts are **invite-only** (`enable_signup = false`). An invitation is accepted explicitly by the owner of the
  verified invited email on `/invites` (`app.accept_invite`); nothing is linked automatically.
- **Production:** `SOMA_DB_URL` (web) must be a login role that is a member of `authenticated`, not a superuser, and a
  direct/session connection (postgres-js prepares statements; the transaction pooler on port 6543 needs `prepare: false`).
  The worker needs a privileged role (it reads `auth.users` and processes `jobs`).

## Adding a tenant-owned table (checklist)
1. Migration in `supabase/migrations/<timestamp>_<name>.sql`:
   - `tenant_id uuid not null references public.tenants(id) on delete cascade`
   - Composite FKs `(tenant_id, x_id) references x(tenant_id, id)` for every reference to another tenant table
   - `alter table ... enable row level security;`
   - `tenant_read` policy (`tenant_id = app.tenant_id()`) and a `tenant_write` policy that also checks the permission
   - `create trigger audit after insert or update or delete on public.<t> for each row execute function app.audit_trigger();`
2. Add any new permission to `packages/auth/src/permissions.ts`.
3. DB test in `packages/db/tests/` with an isolation test (`expectTenantIsolation`) and permission tests.
4. `rls-coverage.test.ts` fails if RLS or a tenant policy is missing.

## Configuration rules
- Effective-dated data uses half-open ranges `[from, to)`.
- Rule sets (pay, accruals, etc.) live in `config_versions` (versioned, effective-dated, approved versions immutable).
- Never hard-code regulatory numbers — store them as config/data.
- Customization is configuration, never per-department code.

## Scheduling (Phase 1a)

Design: `docs/superpowers/specs/2026-11-24-somaos-master-design.md` §5.9, §7. Plan:
`docs/superpowers/plans/2026-11-24-phase-1a-roster.md`.

### Concepts
- **Shift pattern** — a `config_versions` document (kind `schedule.pattern`), so it is versioned, effective-dated and
  approved like any other config. Payload (`ShiftPattern` in `@soma/schedule-engine`): `cycle` of `on`/`off` days,
  `shiftStart` (local `HH:MM`), `shiftHours`, `anchorDate`, `platoons` (shift key → day offset) and optional
  `kelly: { everyNthShift }`. Edit under **Admin → Scheduling → Patterns**: save a draft, then approve it with the date
  it takes effect.
- **Seat** — a position a unit must staff, with required credentials (`anyOf` groups) and a minimum rank. Defined under
  **Admin → Scheduling → Seats**.
- **Standing seat** — a member's regular seat, platoon and Kelly group, effective-dated. Setting a new one ends the
  current one. Set on the member's admin page.
- **Shift assignment** — one materialized shift on one seat. Exclusion constraints stop double-booking a person or a
  seat (`shift_assignments_seat_no_overlap`).
- **Credential type / member credential** — validity is N months, a fixed cycle end (NREMT EMT/AEMT/Paramedic **Mar 31**,
  EMR **Sep 30**) or never expires. The numbers live in template data, not engine code.

### Engine
`packages/schedule-engine` is pure (no DB, no framework): `expandPattern`, `planRegularRoster`, `credentialExpiry`,
`checkQualification`, `dueWarning`. Results carry `Explain` traces (rule + message) so the UI can say *why*. The web
server loads data with `withCtxDb` (RLS applies), calls the engine and writes results.

### Regenerating the roster
- **Roster** page → **Generate schedule** (needs `scheduling.config.manage`) creates regular and Kelly assignments from
  standing seats, at most 120 days at a time.
- Generation is idempotent: existing rows, including generated rows an officer cancelled, are not recreated or
  resurrected, and manual assignments are untouched.
- Approving a new pattern version supersedes future generated, still-scheduled shifts from its effective date
  (`supersedeGenerated`); generate again to recreate them from the new version. Separated members get nothing after
  their `separated_on` date.

### Credential gating and override
A member is qualified for a seat only if every required credential is valid **through the end of the shift**, not just
today (credential expiring 2026-03-31 does not cover a shift ending 2026-04-01 07:00). Filling an unqualified member is
a **hard block**. Someone holding `scheduling.qualification.override` for that unit may fill anyway by entering a reason
(at least 5 characters); the reason is stored on the assignment and audited.

### Expiry warnings
`apps/worker` runs `credential-expiry-scan` daily at 06:00 UTC. Warnings go out at 90/60/30/7 days (configurable per
credential type) and when a credential has expired, via `app.notify`; `last_warned_days` prevents repeats. The worker
inserts the first scan job on start if none is pending.

### Time and DST
Shifts are defined in local wall-clock time; the time zone is the seat's org unit's `timezone`, else the department's.
Actual hours come from real instants, so a 24-hour shift is 23 h across spring-forward and 25 h across fall-back. A local
start time that does not exist (02:30 on spring-forward) starts at the next valid instant.
