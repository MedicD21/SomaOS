import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Grant, MyGrantRow, Permission, Target } from '@soma/auth';
import { can, requiresMfa, toGrants } from '@soma/auth';
import { createSupabaseServer } from '@/lib/supabase/server';
import type { DbClaims, Tx } from './db';
import { withUserDb } from './db';

export type TenantInfo = {
  id: string;
  name: string;
  timezone: string;
  terminology: Record<string, string>;
  enabledModules: string[];
};

export type RequestContext = {
  userId: string;
  claims: DbClaims;
  tenant: TenantInfo;
  memberId: string | null;
  grants: Grant[];
  memberships: { id: string; name: string }[];
  aal: 'aal1' | 'aal2';
};

export class ForbiddenError extends Error {
  constructor(reason: string) {
    super(`Forbidden: ${reason}`);
    this.name = 'ForbiddenError';
  }
}

/** Verified claims for the current request, or null when signed out. */
export const getClaims = cache(async (): Promise<DbClaims | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims as DbClaims | undefined) ?? null;
});

/** Loads the signed-in user's department context. Redirects when signed out or MFA is due. */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const claims = await getClaims();
  if (!claims) redirect('/login');
  if (!claims.tenant_id) redirect('/no-department');

  const data = await withUserDb(claims, async (tx) => {
    const [tenant] = await tx<{ id: string; name: string; timezone: string; terminology: Record<string, string>; enabled_modules: string[] }[]>`
      select t.id, t.name, t.timezone, s.terminology, s.enabled_modules
      from tenants t join tenant_settings s on s.tenant_id = t.id where t.id = app.tenant_id()`;
    const grantRows = await tx<MyGrantRow[]>`select * from app.my_grants()`;
    const [me] = await tx<{ id: string | null }[]>`select app.my_member_id() as id`;
    const memberships = await tx<{ id: string; name: string }[]>`
      select t.id, t.name from memberships m join tenants t on t.id = m.tenant_id
      where m.user_id = auth.uid() and m.status = 'active' order by t.name`;
    return { tenant, grantRows, memberId: me?.id ?? null, memberships: [...memberships] };
  });
  if (!data.tenant) redirect('/no-department');

  const grants = toGrants(data.grantRows);
  const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
  if (requiresMfa(grants) && aal !== 'aal2') redirect('/mfa');

  return {
    userId: claims.sub,
    claims,
    tenant: {
      id: data.tenant.id,
      name: data.tenant.name,
      timezone: data.tenant.timezone,
      terminology: data.tenant.terminology ?? {},
      enabledModules: data.tenant.enabled_modules ?? [],
    },
    memberId: data.memberId,
    grants,
    memberships: data.memberships,
    aal,
  };
});

export function check(ctx: RequestContext, permission: Permission, target: Target = {}) {
  return can(ctx.grants, ctx.memberId ?? '', permission, target, new Date());
}

/** Throws ForbiddenError (with the evaluator's reason) unless the caller holds permission. */
export function requirePermission(ctx: RequestContext, permission: Permission, target: Target = {}): void {
  const decision = check(ctx, permission, target);
  if (!decision.allowed) throw new ForbiddenError(decision.reason);
}

/** True when the caller holds permission in any scope (used for navigation). */
export function hasAny(ctx: RequestContext, permission: Permission): boolean {
  const now = Date.now();
  return ctx.grants.some(
    (g) => g.permission === permission && g.validFrom.getTime() <= now && (g.validTo === null || now < g.validTo.getTime()),
  );
}

/** Department terminology override, e.g. t(ctx, 'shift', 'Shift') → 'Platoon'. */
export function t(ctx: RequestContext, key: string, fallback: string): string {
  return ctx.tenant.terminology[key] || fallback;
}

/** Runs fn as the signed-in user within their active tenant. */
export async function withCtxDb<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUserDb(ctx.claims, fn);
}
