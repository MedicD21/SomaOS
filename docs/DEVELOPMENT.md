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
