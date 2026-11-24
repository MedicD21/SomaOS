# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A multi-tenant SomaOS foundation where a department admin can sign in (with MFA), configure their department (settings, terminology, org structure, ranks, shifts, members, roles/permissions, custom fields), with tenant isolation enforced in Postgres, an append-only audit log, versioned config, notifications, and file storage — ready for Phase 1 Scheduling to build on.

**Architecture:** pnpm/Turborepo monorepo. Supabase (Postgres + Auth + Storage) is the backend; SQL migrations in `supabase/migrations` are the source of truth (including RLS). Domain logic lives in framework-free packages (`auth`, `config-core`, `custom-fields`, `validators`, `db`); `apps/web` (Next.js) calls them from server actions/route handlers using the *user's* Supabase session so RLS always applies. `apps/worker` (pg-boss) runs background jobs with the service role.

**Tech Stack:** TypeScript 5 strict, Node 22, pnpm, Turborepo, Next.js 16 (App Router), Tailwind + shadcn/ui (Radix), Supabase CLI 3.x (local stack in Docker), `@supabase/supabase-js` 2.x, `@supabase/ssr`, Drizzle ORM 0.45 (types/queries, `drizzle-kit pull` from DB), `postgres` (postgres-js) for tests/worker, Zod 4, Vitest, Playwright + `@axe-core/playwright`, pg-boss.

**Spec:** `docs/superpowers/specs/2026-11-24-somaos-master-design.md` (§5 Architecture, §6 Phase 0, §8 Phase 0 security row, §11–12 owner decisions).

## Global Constraints

- TypeScript `strict: true`; no `any` in package public APIs.
- Every tenant-owned table has `tenant_id uuid not null references tenants(id)` and RLS enabled with the tenant policy pattern from Task 3. No tenant table ships without an isolation test.
- All instants are `timestamptz` stored UTC; every tenant has an IANA `timezone` (default `America/New_York` is NOT assumed — required on tenant creation).
- Effective-dated data uses `effective_from` / `effective_to` (half-open `[from, to)`, `to` null = open-ended).
- Customization is configuration, never per-tenant code (spec §2 anti-goals).
- Records are never hard-deleted by the app in Phase 0 tables that represent people or config; use `status`/`archived_at`.
- MFA (TOTP) required for any user holding a role with an `admin.*` permission (spec §5.5).
- Web UI meets WCAG 2.1 AA: every Playwright page test runs an axe scan with zero serious/critical violations.
- App code never uses the Supabase service-role key; only `apps/worker` and test harnesses may.
- Commit messages end with the session's attribution trailer lines.

## Review Focus

1. **A user who belongs to two departments switches tenants** → JWT `tenant_id` must change only to a tenant where they have an active membership; data from the previous tenant must not be visible after switching. (Test in Task 3 and Task 11.)
2. **A membership is deactivated while the user is signed in** → their next token refresh yields no `tenant_id` and every tenant query returns zero rows. (Task 3.)
3. **Org unit moved under its own descendant** → rejected (cycle), and descendant paths update when a unit is moved legitimately. (Task 4.)
4. **Two approved config versions overlap in time for the same key** → rejected by the database, not just the app. (Task 8.)
5. **Admin removes their own last admin role grant** → blocked so a department can't lock itself out. (Task 6.)

---

## File Structure

```
package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .eslintrc.cjs (flat: eslint.config.mjs), .prettierrc, .github/workflows/ci.yml
supabase/config.toml
supabase/migrations/0001_app_schema.sql         app schema + helper fns
supabase/migrations/0002_tenancy.sql            tenants, tenant_settings, memberships, profiles, access-token hook
supabase/migrations/0003_org.sql                org_unit_types, org_units (ltree), ranks, shifts
supabase/migrations/0004_members.sql            members, member_assignments
supabase/migrations/0005_rbac.sql               roles, role_permissions, role_grants
supabase/migrations/0006_audit.sql              audit_log + trigger fn, attached to all prior tables
supabase/migrations/0007_config.sql             config_versions
supabase/migrations/0008_custom_fields.sql      custom_field_defs
supabase/migrations/0009_notifications.sql      notifications, notification_prefs
supabase/migrations/0010_files.sql              storage bucket + policies, attachments
supabase/seed.sql                               dev-only seed (calls template fn)
packages/db/        src/client.ts, src/schema.ts (drizzle-kit pull output), src/test-harness.ts, tests/*.test.ts
packages/auth/      src/permissions.ts (catalog), src/evaluate.ts (can/explain), tests/
packages/config-core/ src/resolve.ts, tests/
packages/custom-fields/ src/schema-builder.ts, tests/
packages/validators/ src/*.ts (zod schemas shared by web + worker)
packages/templates/ src/career-3-platoon.ts, src/apply.ts, tests/
packages/ui/        shadcn components + tokens
apps/web/           Next.js app (src/app/**, src/server/**), e2e/*.spec.ts
apps/worker/        src/index.ts, src/jobs/send-email.ts, tests/
```

---

### Task 1: Monorepo scaffold + CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.nvmrc` (`22`), `.github/workflows/ci.yml`, `packages/validators/{package.json,tsconfig.json,src/index.ts,tests/smoke.test.ts}`

**Interfaces:**
- Produces: root scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (Turbo pipelines); package naming `@soma/<name>`; each package exports from `src/index.ts`.

- [ ] **Step 1:** Write `packages/validators/tests/smoke.test.ts`: `expect(SOMA_PACKAGE).toBe('@soma/validators')`.
- [ ] **Step 2:** Run `pnpm -F @soma/validators test` → FAIL (`SOMA_PACKAGE` not exported).
- [ ] **Step 3:** Create workspace files; `packages/validators/src/index.ts` exports `SOMA_PACKAGE = '@soma/validators'`. CI workflow on push/PR: setup pnpm + Node 22, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (DB tests job added in Task 2).
- [ ] **Step 4:** Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test` → all pass.
- [ ] **Step 5:** Commit `chore: scaffold monorepo with turbo, vitest, CI`.

### Task 2: Supabase local stack + DB test harness

**Files:**
- Create: `supabase/config.toml` (via `pnpm dlx supabase init`), `supabase/migrations/0001_app_schema.sql`, `packages/db/{package.json,src/client.ts,src/test-harness.ts,tests/harness.test.ts,drizzle.config.ts}`
- Modify: `.github/workflows/ci.yml` (job `db-tests`: `supabase/setup-cli`, `supabase start`, `pnpm -F @soma/db test`), root `package.json` scripts `db:start`, `db:reset`, `db:pull`.

**Interfaces:**
- Produces:
  - `withUser<T>(claims: { sub: string; tenant_id?: string | null }, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>` — opens a transaction as superuser, `set local role authenticated`, `select set_config('request.jwt.claims', <claims json incl. role:'authenticated'>, true)`, runs `fn`, **always rolls back**.
  - `withAdmin<T>(fn: (tx) => Promise<T>): Promise<T>` — superuser transaction, always rolls back.
  - `createTestUser(tx, email?: string): Promise<string /* auth.users.id */>`.
  - SQL: schema `app`; `app.tenant_id() returns uuid` = `nullif(auth.jwt() ->> 'tenant_id', '')::uuid` (stable, security definer not needed).
  - DB URL from env `SOMA_DB_URL`, default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

- [ ] **Step 1:** Test `harness.test.ts`: inside `withUser({ sub: <uuid>, tenant_id: T })`, `select app.tenant_id()` returns `T`; with `tenant_id: null` returns `null`; `select current_user` returns `authenticated`.
- [ ] **Step 2:** Run `pnpm db:start && pnpm -F @soma/db test` → FAIL (`schema "app" does not exist`).
- [ ] **Step 3:** Write migration `0001_app_schema.sql` (create schema `app`, `create extension if not exists ltree`, `btree_gist`, `app.tenant_id()`, `grant usage on schema app to authenticated, service_role`) and the harness.
- [ ] **Step 4:** `pnpm db:reset && pnpm -F @soma/db test` → PASS.
- [ ] **Step 5:** Commit `feat(db): supabase local stack and RLS test harness`.

### Task 3: Tenancy, memberships, access-token hook

**Files:**
- Create: `supabase/migrations/0002_tenancy.sql`, `packages/db/tests/tenancy.test.ts`
- Modify: `supabase/config.toml` (`[auth.hook.custom_access_token] enabled = true, uri = "pg-functions://postgres/public/custom_access_token_hook"`; `[auth.mfa.totp] enroll_enabled = true, verify_enabled = true`)

**Interfaces:**
- Produces tables:
  - `tenants(id uuid pk default gen_random_uuid(), name text not null, slug text unique not null, timezone text not null, us_state char(2), department_type text not null check in ('career','combination','volunteer','private_ems','county_ems','other'), status text not null default 'active', created_at timestamptz default now())`
  - `tenant_settings(tenant_id uuid pk fk, terminology jsonb not null default '{}', enabled_modules text[] not null default '{}', branding jsonb not null default '{}')`
  - `profiles(user_id uuid pk references auth.users on delete cascade, display_name text, active_tenant_id uuid null references tenants)`
  - `memberships(id uuid pk, tenant_id uuid fk, user_id uuid fk auth.users, status text not null default 'active' check in ('active','invited','suspended','removed'), created_at, unique(tenant_id,user_id))`
- Tenant RLS pattern (copy for every later tenant table):
  ```sql
  alter table X enable row level security;
  create policy tenant_isolation on X for all to authenticated
    using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
  ```
  `tenants` uses `id = app.tenant_id()` (select only for authenticated; insert/update via `app.create_tenant` security-definer fn). `profiles`: user sees/updates own row only. `memberships`: user sees own memberships across tenants (for the switcher) **and** all memberships in the current tenant.
- `public.custom_access_token_hook(event jsonb) returns jsonb` (security definer, granted to `supabase_auth_admin` only): reads `profiles.active_tenant_id` for `event->>'user_id'`; sets claim `tenant_id` only if an `active` membership exists in that tenant, otherwise sets `tenant_id` to JSON null.
- `app.set_active_tenant(p_tenant uuid) returns void` (security definer): raises `'not a member'` unless caller (`auth.uid()`) has an active membership; updates `profiles.active_tenant_id`. Client then refreshes session.
- `app.create_tenant(p_name text, p_slug text, p_timezone text, p_department_type text, p_us_state char(2)) returns uuid` — callable by `service_role` only in Phase 0 (platform onboarding); validates `p_timezone` exists in `pg_timezone_names`.

- [ ] **Step 1:** Tests in `tenancy.test.ts`:
  - `isolation`: create tenants A and B with a row each in `tenant_settings`; `withUser({sub:u, tenant_id:A})` selecting `tenant_settings` returns exactly A's row; inserting a row with `tenant_id = B` throws `new row violates row-level security policy`.
  - `hook grants tenant only with active membership`: user with active membership in A and `active_tenant_id = A` → hook output `claims.tenant_id === A`; set membership `suspended` → `claims.tenant_id === null` (Review Focus 2).
  - `set_active_tenant rejects non-member`: user member of A only, `app.set_active_tenant(B)` throws `not a member` (Review Focus 1).
  - `switching hides prior tenant`: user member of A and B; under claims for B, `select count(*) from tenant_settings where tenant_id = A` = 0.
  - `create_tenant rejects bad timezone`: `'Mars/Olympus'` throws.
- [ ] **Step 2:** Run `pnpm -F @soma/db test tenancy` → FAIL.
- [ ] **Step 3:** Write `0002_tenancy.sql` per Interfaces; `create trigger on auth.users after insert` creates a `profiles` row.
- [ ] **Step 4:** `pnpm db:reset && pnpm -F @soma/db test` → PASS.
- [ ] **Step 5:** Commit `feat(db): tenants, memberships, tenant-scoped JWT hook with RLS`.

### Task 4: Org structure, ranks, shifts

**Files:**
- Create: `supabase/migrations/0003_org.sql`, `packages/db/tests/org.test.ts`

**Interfaces:**
- Produces tables (all tenant-scoped with the Task 3 policy):
  - `org_unit_types(id, tenant_id, key text, label text, sort int, unique(tenant_id,key))` — e.g. `division`, `battalion`, `station`, `unit`.
  - `org_units(id uuid, tenant_id, type_id fk org_unit_types, parent_id uuid null fk org_units, name text not null, code text, path ltree not null, timezone text null /* overrides tenant */, status text default 'active', custom jsonb not null default '{}')`; gist index on `path`.
  - `ranks(id, tenant_id, key, label, sort int not null /* lower = more senior */, unique(tenant_id,key))`
  - `shifts(id, tenant_id, key, label, color text, sort int, unique(tenant_id,key))` — platoons A/B/C.
- `path` is maintained by trigger: label = unit id with `-` replaced by `_`; on insert path = parent.path || label; on parent change, reject if new parent's path `<@` own path (error `'org unit cycle'`), else rewrite own and all descendants' paths. Parent must be in same tenant (error `'cross-tenant parent'`).

- [ ] **Step 1:** Tests: (a) inserting station under battalion yields `path` with 2 labels; (b) moving battalion B1 under division D2 rewrites its stations' paths so `path <@ D2.path`; (c) setting B1.parent_id to one of its stations throws `org unit cycle` (Review Focus 3); (d) parent from another tenant throws (as admin, bypassing RLS); (e) tenant isolation for all four tables.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement migration + trigger.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(db): configurable org tree, ranks, shifts`.

### Task 5: Members and effective-dated assignments

**Files:**
- Create: `supabase/migrations/0004_members.sql`, `packages/db/tests/members.test.ts`

**Interfaces:**
- Produces:
  - `members(id uuid, tenant_id, user_id uuid null fk auth.users, employee_number text, first_name text not null, last_name text not null, preferred_name text, email text, phone text, hire_date date, seniority_date date, rank_id uuid null fk ranks, employment_type text not null check in ('career_full_time','career_part_time','volunteer','per_diem','other'), status text not null default 'active' check in ('active','leave','separated'), separated_on date, custom jsonb not null default '{}', unique(tenant_id, employee_number))`. Unique `(tenant_id,user_id)` where user_id not null.
  - `member_assignments(id, tenant_id, member_id fk, org_unit_id fk, shift_id uuid null fk, is_primary boolean not null default true, effective daterange not null)`; exclusion constraint: no overlapping `effective` for the same member where `is_primary` (`exclude using gist (member_id with =, effective with &&) where (is_primary)`).
  - View `app.current_primary_assignment` (member_id, org_unit_id, shift_id) for `current_date` in tenant timezone.
  - `app.my_member_id() returns uuid` — member row in current tenant linked to `auth.uid()`.

- [ ] **Step 1:** Tests: two primary assignments with overlapping ranges → exclusion violation; back-to-back `[2026-01-01,2026-07-01)` and `[2026-07-01,)` OK; `app.my_member_id()` returns the linked member under that user's claims and null for an unlinked user; tenant isolation.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(db): members and effective-dated assignments`.

### Task 6: Permissions catalog, roles, grants, evaluator

**Files:**
- Create: `packages/auth/{package.json,src/permissions.ts,src/evaluate.ts,src/index.ts,tests/evaluate.test.ts}`, `supabase/migrations/0005_rbac.sql`, `packages/db/tests/rbac.test.ts`

**Interfaces:**
- `permissions.ts`: `export const PERMISSIONS = { 'admin.tenant.manage': {...}, 'admin.org.manage', 'admin.members.view', 'admin.members.manage', 'admin.roles.manage', 'admin.audit.view', 'admin.config.manage', 'admin.custom_fields.manage', 'files.upload', 'files.view', 'notifications.send' } as const` each with `{ label: string; module: string; sensitive?: 'PHI'|'HR'|'MEDICAL'|'CJI' }`; `export type Permission = keyof typeof PERMISSIONS`.
- DB:
  - `roles(id, tenant_id, key, label, description, is_system boolean default false, unique(tenant_id,key))`
  - `role_permissions(role_id fk, permission text not null, tenant_id, primary key(role_id, permission))`
  - `role_grants(id, tenant_id, member_id fk members, role_id fk roles, scope_kind text not null check in ('self','org_unit','department'), scope_org_unit_id uuid null fk org_units, scope_shift_id uuid null fk shifts, valid tstzrange not null default tstzrange(now(), null), reason text, granted_by uuid)`; check: `scope_org_unit_id` not null iff `scope_kind='org_unit'`.
  - Trigger on `role_grants`/`role_permissions` delete/update: raise `'cannot remove last admin'` if afterwards no current grant in the tenant includes `admin.roles.manage` with `scope_kind='department'` (Review Focus 5).
  - `app.my_grants()` returns setof (permission, scope_kind, scope_path ltree, scope_shift_id, valid) for the caller's member in the current tenant, current grants only.
- `evaluate.ts`:
  ```ts
  export type Grant = { permission: Permission; scope: { kind: 'self' } | { kind: 'department' } | { kind: 'org_unit'; path: string }; shiftId?: string | null; validFrom: Date; validTo: Date | null; roleKey: string };
  export type Target = { orgUnitPath?: string | null; shiftId?: string | null; ownerMemberId?: string | null };
  export type Decision = { allowed: boolean; reason: string; matchedRole?: string };
  export function can(grants: Grant[], actorMemberId: string, permission: Permission, target: Target, at: Date): Decision;
  ```
  Rules: grant active iff `validFrom <= at < validTo ?? ∞`. `department` matches any target. `org_unit` matches iff `target.orgUnitPath` equals or descends from `path` (dot-label prefix). `self` matches iff `target.ownerMemberId === actorMemberId`. If grant has `shiftId`, target's `shiftId` must equal it. `reason` strings: `"allowed by role <key> (<scope>)"` or `"no active grant for <permission> covering target"`.

- [ ] **Step 1:** Evaluator tests: department grant allows any target; org_unit grant on battalion `a.b` allows station `a.b.c`, denies `a.x`; self grant allows only own records; shift-restricted grant denies other shift; acting grant valid only within `[from,to)` (`at = to` → denied); reason strings as specified.
- [ ] **Step 2:** DB tests (`rbac.test.ts`): `app.my_grants()` returns only current grants for caller; deleting the only department-scoped `admin.roles.manage` grant throws `cannot remove last admin`; tenant isolation for 3 tables.
- [ ] **Step 3:** Run both → FAIL.
- [ ] **Step 4:** Implement catalog, evaluator, migration.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `feat(auth): RBAC with scoped, time-bound grants and explainable evaluator`.

### Task 7: Append-only audit log

**Files:**
- Create: `supabase/migrations/0006_audit.sql`, `packages/db/tests/audit.test.ts`

**Interfaces:**
- `audit_log(id bigint identity, tenant_id uuid null, occurred_at timestamptz default now(), actor_user_id uuid null default auth.uid(), table_name text, record_id uuid, action text check in ('insert','update','delete'), before jsonb, after jsonb, changed_fields text[], reason text null /* from set_config('app.reason') */)`.
- `app.audit_trigger()` generic AFTER row trigger; attach to: tenants, tenant_settings, memberships, org_unit_types, org_units, ranks, shifts, members, member_assignments, roles, role_permissions, role_grants. **Every later migration that creates a tenant table attaches this trigger.**
- RLS: authenticated may `select` only own-tenant rows and only if caller holds `admin.audit.view` (check via `app.my_grants()`); no insert/update/delete policy for anyone; `revoke update, delete, truncate on audit_log from authenticated, service_role`.

- [ ] **Step 1:** Tests: updating a member's `last_name` writes a row with `changed_fields = {last_name}` and before/after values; `update audit_log` as service_role throws permission denied; member without `admin.audit.view` sees 0 rows; with it sees own-tenant rows only.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement.  **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(db): append-only audit log on all foundation tables`.

### Task 8: Versioned, effective-dated config core

**Files:**
- Create: `supabase/migrations/0007_config.sql`, `packages/db/tests/config.test.ts`, `packages/config-core/{package.json,src/resolve.ts,src/index.ts,tests/resolve.test.ts}`

**Interfaces:**
- DB `config_versions(id, tenant_id, kind text not null, key text not null, version int not null, status text not null check in ('draft','approved','retired'), effective tstzrange not null, payload jsonb not null, change_note text, created_by uuid, approved_by uuid, approved_at timestamptz, unique(tenant_id,kind,key,version))`; exclusion: `exclude using gist (tenant_id with =, kind with =, key with =, effective with &&) where (status = 'approved')` (Review Focus 4). Approving requires `admin.config.manage`.
- `resolve.ts`:
  ```ts
  export type ConfigVersion<T> = { kind: string; key: string; version: number; effectiveFrom: Date; effectiveTo: Date | null; payload: T };
  export function resolveEffective<T>(versions: ConfigVersion<T>[], at: Date): ConfigVersion<T> | null;
  export type Layer<T> = { name: string; payload: Partial<T> };
  export function resolveLayered<T extends object>(layers: Layer<T>[]): { value: T; sources: Record<string, string> };
  ```
  `resolveLayered`: layers ordered most-general first (e.g., `platform`, `state`, `tenant`); deep-merge plain objects, arrays replace; `sources` maps each dotted leaf path to the layer name that set it.

- [ ] **Step 1:** Tests: `resolveEffective` picks version whose `[from,to)` contains `at`, null if none, boundary `at = to` excluded; `resolveLayered` with platform `{ot:{threshold:212, periodDays:28}}` and tenant `{ot:{threshold:204}}` yields threshold 204 from `tenant`, periodDays 28 from `platform`; DB test: two approved overlapping versions → exclusion violation; draft overlapping approved is allowed.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement.  **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(config): versioned effective-dated config with layered resolution`.

### Task 9: Custom fields registry

**Files:**
- Create: `supabase/migrations/0008_custom_fields.sql`, `packages/custom-fields/{package.json,src/schema-builder.ts,src/index.ts,tests/schema-builder.test.ts}`

**Interfaces:**
- DB `custom_field_defs(id, tenant_id, entity text not null check in ('member','org_unit'), key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'), label text, type text check in ('text','long_text','number','integer','boolean','date','select','multi_select','email','phone'), options jsonb /* for selects: [{value,label}] */, required boolean default false, sensitivity text null check in ('PHI','HR','MEDICAL','CJI'), sort int, archived_at timestamptz, unique(tenant_id, entity, key))` + audit trigger.
- `schema-builder.ts`:
  ```ts
  export type CustomFieldDef = { key: string; label: string; type: 'text'|'long_text'|'number'|'integer'|'boolean'|'date'|'select'|'multi_select'|'email'|'phone'; options?: { value: string; label: string }[]; required: boolean; archived: boolean };
  export function buildCustomFieldSchema(defs: CustomFieldDef[]): z.ZodObject<...>;
  ```
  Archived defs are optional and ignored for required-ness but existing values are preserved (passthrough). Unknown keys are rejected (`strict`). `date` = ISO `YYYY-MM-DD`.

- [ ] **Step 1:** Tests: required text missing → error at path `[key]`; select value not in options → error; integer `1.5` → error; unknown key → error; archived field value preserved without error.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement.  **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(custom-fields): per-tenant field registry and zod schema builder`.

### Task 10: Department templates

**Files:**
- Create: `packages/templates/{package.json,src/types.ts,src/career-3-platoon.ts,src/volunteer.ts,src/apply.ts,src/index.ts,tests/apply.test.ts}`, `supabase/seed.sql`

**Interfaces:**
- `export type DepartmentTemplate = { key: string; label: string; orgUnitTypes: {key;label;sort}[]; ranks: {key;label;sort}[]; shifts: {key;label;color}[]; roles: { key: string; label: string; permissions: Permission[] }[]; enabledModules: string[] }`
- `export async function applyTemplate(tx: postgres.TransactionSql, tenantId: string, template: DepartmentTemplate, firstAdmin: { userId: string; firstName: string; lastName: string }): Promise<void>` — idempotent on `(tenant_id,key)` uniques; creates member for `firstAdmin`, active membership, and a `department`-scoped grant of role `dept_admin`.
- `career-3-platoon`: org unit types division/battalion/station/unit; ranks Fire Chief(1), Deputy Chief(2), Battalion Chief(3), Captain(4), Lieutenant(5), Driver/Engineer(6), Firefighter/Paramedic(7), Firefighter/EMT(8), Probationary Firefighter(9); shifts A/B/C; roles from spec §5.5 default list (dept_admin has every permission in the catalog; member has `files.view`; others hold the admin.* subset relevant to them).
- `volunteer`: same types without battalion; ranks Chief, Assistant Chief, Captain, Lieutenant, Firefighter, Probationary; no shifts.

- [ ] **Step 1:** Tests: applying career template twice yields 3 shifts and 9 ranks (idempotent); first admin `can(... 'admin.roles.manage', {}, now)` is allowed via `app.my_grants()` mapped to `Grant[]`; every permission in templates exists in `PERMISSIONS` (type-level + runtime check).
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement; `seed.sql` creates a dev tenant "Demo Fire Rescue" (timezone `America/New_York`, career) and a dev admin `admin@soma.local` / password `somadev123!` — dev only.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(templates): career and volunteer department starter templates`.

### Task 11: Web app shell — auth, MFA, tenant context

**Files:**
- Create: `apps/web` (Next.js 16, App Router, Tailwind, shadcn/ui via `packages/ui`), `apps/web/src/server/supabase.ts`, `apps/web/src/server/context.ts`, `apps/web/src/middleware.ts`, `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/(auth)/mfa/page.tsx`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/page.tsx`, `apps/web/src/app/(app)/switch-tenant/actions.ts`, `apps/web/e2e/auth.spec.ts`, `apps/web/playwright.config.ts`

**Interfaces:**
- `getRequestContext(): Promise<RequestContext>` where `RequestContext = { userId: string; tenant: { id; name; timezone; terminology: Record<string,string>; enabledModules: string[] }; memberId: string | null; grants: Grant[]; aal: 'aal1'|'aal2' }`; redirects to `/login` if no session, to `/mfa` if any grant has an `admin.*` permission and `aal !== 'aal2'`.
- `requirePermission(ctx, permission: Permission, target?: Target): void` — throws `ForbiddenError` with the evaluator's `reason`.
- `t(ctx, key: string, fallback: string): string` — terminology lookup.
- Nav items declare `{ href, label, permission, module }`; rendered only when module enabled and `can` allows.
- Tenant switcher calls `app.set_active_tenant` then `supabase.auth.refreshSession()`.

- [ ] **Step 1:** Playwright `auth.spec.ts`: dev admin logs in → redirected to `/mfa` enrollment (TOTP; test computes code with `otplib` from the displayed secret) → lands on dashboard showing "Demo Fire Rescue"; wrong password shows "Invalid email or password"; axe scan zero serious/critical on login and dashboard; user with two tenants switches and the header tenant name changes (Review Focus 1).
- [ ] **Step 2:** Run `pnpm -F web e2e` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): auth with MFA, tenant context and switcher`.

### Task 12: Admin — department settings, org structure, ranks, shifts

**Files:**
- Create: `apps/web/src/app/(app)/admin/settings/*`, `apps/web/src/app/(app)/admin/org/*`, `apps/web/src/app/(app)/admin/ranks/*`, `apps/web/src/app/(app)/admin/shifts/*`, `packages/validators/src/{tenant-settings,org-unit,rank,shift}.ts`, `apps/web/e2e/admin-org.spec.ts`

**Interfaces:**
- Server actions validate with `@soma/validators` schemas, call `requirePermission(ctx,'admin.tenant.manage'|'admin.org.manage')`, write through the user's Supabase client (RLS applies), and set `app.reason` when the form provides a change reason.
- Settings: timezone (select from IANA list), terminology overrides (key/label table for keys `shift`, `station`, `unit`, `member`, `battalion`), enabled modules (checkboxes; only `admin` and `files` exist in Phase 0).
- Org: tree view with add child, rename, move (parent picker excludes self/descendants), archive.

- [ ] **Step 1:** Playwright: admin sets terminology `shift → Platoon`, nav/header labels show "Platoon"; creates Battalion 1 → Station 1 → Engine 1; moves Station 1 to Battalion 2; move dialog does not list Station 1's descendants; axe passes on each page. Validator unit tests: invalid timezone rejected; terminology key not in allowed list rejected.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement.  **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): department settings, org structure, ranks, shifts admin`.

### Task 13: Admin — members, roles, grants, custom fields, audit viewer

**Files:**
- Create: `apps/web/src/app/(app)/admin/members/*`, `.../admin/roles/*`, `.../admin/custom-fields/*`, `.../admin/audit/*`, `packages/validators/src/{member,role,grant,custom-field-def}.ts`, `apps/web/e2e/admin-people.spec.ts`

**Interfaces:**
- Member form renders standard fields + custom fields from `custom_field_defs` (entity `member`) validated by `buildCustomFieldSchema`; fields with a `sensitivity` label are shown only to holders of `admin.members.manage` (Phase 0 rule; refined in Phase 2).
- Invite member: creates `members` row + Supabase invite email (via server route using `auth.admin.inviteUserByEmail` **in `apps/worker` job `invite-member`**, since web never holds the service key) + `memberships(status='invited')`; acceptance flips to `active` and links `members.user_id`.
- Roles page: permission checklist grouped by module from `PERMISSIONS`; grants page: member, role, scope (department / org unit picker / self), optional shift, valid from/to, reason. "Why can't X do Y?" panel calls `can()` and shows `reason`.
- Audit viewer: filter by table, record, actor, date range; requires `admin.audit.view`.

- [ ] **Step 1:** Playwright: create custom field "Badge Number" (text, required) → member form requires it; create member, assign to Station 1 / B shift; create role "Shift Scheduler" with `admin.members.view`; grant to member scoped to Battalion 1 for B shift with an end date; explain panel shows `allowed by role shift_scheduler (org_unit)` for a Station 1/B target and denial reason for C shift; attempt to revoke own last admin grant shows "cannot remove last admin"; audit viewer lists the member change; axe passes.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement.  **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): members, roles, scoped grants, custom fields, audit viewer`.

### Task 14: Worker, notifications, email

**Files:**
- Create: `supabase/migrations/0009_notifications.sql`, `apps/worker/{package.json,src/index.ts,src/jobs/send-email.ts,src/jobs/invite-member.ts,src/mailer.ts,tests/send-email.test.ts}`, `apps/web/src/app/(app)/notifications/*`, `apps/web/src/components/notification-bell.tsx`

**Interfaces:**
- DB `notifications(id, tenant_id, member_id fk, kind text, title text, body text, link text, created_at, read_at timestamptz null)` — RLS: tenant policy AND `member_id = app.my_member_id()` for select/update(read_at only); `notification_prefs(tenant_id, member_id, kind, channels text[] check subset of {'in_app','email'})`.
- `app.notify(p_member uuid, p_kind text, p_title text, p_body text, p_link text) returns uuid` (security definer, requires caller to hold `notifications.send` or be service_role): inserts notification and, if prefs include `email` (default `{in_app,email}`), enqueues pg-boss job `send-email` via `pgboss.send` SQL-compatible insert (or a `notification_outbox` table polled by the worker — implementer's choice, documented in code).
- `sendEmail(job: { to: string; subject: string; text: string }, transport: Mailer): Promise<void>`; `Mailer` interface wraps SMTP (nodemailer) pointed at Supabase local Inbucket/Mailpit in dev.

- [ ] **Step 1:** Tests: `send-email` job calls transport with expected fields (fake Mailer); DB: member sees only own notifications; marking read updates `read_at` only (updating `title` fails); `app.notify` by member without `notifications.send` throws.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement; bell shows unread count; page lists and marks read.
- [ ] **Step 4:** Run → PASS (+ Playwright: invite member → email appears in local mail catcher API).
- [ ] **Step 5:** Commit `feat: worker with pg-boss, in-app and email notifications, member invites`.

### Task 15: File storage and attachments

**Files:**
- Create: `supabase/migrations/0010_files.sql`, `packages/db/tests/files.test.ts`, `apps/web/src/server/files.ts`, `apps/web/src/components/file-upload.tsx`

**Interfaces:**
- Private bucket `tenant-files`; object path convention `<tenant_id>/<entity>/<entity_id>/<uuid>-<safe filename>`; storage RLS on `storage.objects`: `(storage.foldername(name))[1]::uuid = app.tenant_id()` plus `files.upload` for insert / `files.view` for select (via `app.my_grants()`).
- `attachments(id, tenant_id, entity text, entity_id uuid, object_path text unique, file_name text, mime_type text, size_bytes bigint, sha256 text, uploaded_by uuid, uploaded_at, sensitivity text null)` + audit trigger.
- `uploadAttachment(ctx, { entity, entityId, file: File }): Promise<Attachment>` — max 25 MB, allowed MIME list (pdf, png, jpeg, heic, docx, xlsx, csv, txt), computes sha256 server-side; `getSignedUrl(ctx, attachmentId): Promise<string>` 5-minute expiry.

- [ ] **Step 1:** Tests: user of tenant A cannot select/insert objects under tenant B prefix; attachment row isolation; upload over 25 MB rejected with "File exceeds 25 MB"; disallowed MIME rejected.
- [ ] **Step 2:** Run → FAIL.  **Step 3:** Implement; attach a file on member profile in UI.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: tenant-isolated file storage and attachments`.

### Task 16: Developer docs and final verification

**Files:**
- Create: `docs/DEVELOPMENT.md` (prereqs, `pnpm db:start`, `pnpm db:reset`, `pnpm dev`, test commands, dev login, how to add a tenant table: migration + RLS policy + audit trigger + isolation test checklist), `docs/adr/0001-supabase-modular-monolith.md`
- Modify: `README.md` (link to DEVELOPMENT.md)

- [ ] **Step 1:** Run full suite: `pnpm lint && pnpm typecheck && pnpm test && pnpm -F @soma/db test && pnpm -F web e2e` → all pass.
- [ ] **Step 2:** Verify every table in `supabase/migrations` with a `tenant_id` column has RLS enabled: `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity` → returns 0 rows (add this as `packages/db/tests/rls-coverage.test.ts`).
- [ ] **Step 3:** Commit `docs: development guide and ADR; RLS coverage test`.
