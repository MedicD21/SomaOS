# ADR 0001 — Modular monolith on Supabase with DB-enforced tenancy

**Status:** Accepted (2026-11-24)

## Context
SomaOS starts with one department but will be sold to many (master design §1, §4). The owner chose a modular
monolith (approach A), TypeScript, Postgres, Expo, and their own sign-in on Supabase.

## Decision
- One pnpm/Turborepo monorepo: `apps/web` (Next.js), `apps/worker`, framework-free `packages/*`.
- Supabase provides Postgres, Auth (password + TOTP MFA; SSO later) and Storage.
- Multi-tenant from day one: every tenant row has `tenant_id`; Postgres RLS keyed on a `tenant_id` JWT claim set by
  a custom access-token hook.
- PostgREST is disabled; the server queries Postgres as `authenticated` with verified claims, so RLS always applies
  and app permission checks cannot be bypassed through Supabase's REST API.
- Permissions are code-defined strings; roles/grants are data with scopes (department / org unit subtree / self),
  optional shift restriction and validity windows; an explainable evaluator (`can`) answers "why".
- Background work uses a Postgres `jobs` outbox processed by `apps/worker`.

## Consequences
- Selling to another department is onboarding (`app.create_tenant` + template), not a rewrite.
- Every new table must follow the checklist in `docs/DEVELOPMENT.md`; `rls-coverage.test.ts` enforces it.
- Offline mobile (PowerSync) is added in Phase 3 and will need its own sync rules derived from these policies.
