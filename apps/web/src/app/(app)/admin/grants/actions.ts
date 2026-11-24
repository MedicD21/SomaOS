'use server';
import type { MyGrantRow } from '@soma/auth';
import { can, isPermission, toGrants } from '@soma/auth';
import { grantSchema } from '@soma/validators';
import { z } from 'zod';
import type { ActionResult } from '@/server/actions';
import { runAdmin, zodFieldErrors } from '@/server/actions';
import { check, getRequestContext, withCtxDb } from '@/server/context';

export async function addGrant(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = grantSchema.safeParse({
    memberId: form.get('memberId'), roleId: form.get('roleId'), scopeKind: form.get('scopeKind'),
    scopeOrgUnitId: form.get('scopeOrgUnitId'), scopeShiftId: form.get('scopeShiftId'),
    validFrom: form.get('validFrom'), validTo: form.get('validTo'), reason: form.get('reason'),
  });
  if (!parsed.success) return zodFieldErrors(parsed.error.issues);
  const g = parsed.data;
  return runAdmin('admin.roles.manage', form, async (tx, ctx) => {
    const tz = ctx.tenant.timezone;
    await tx`
      insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id, scope_shift_id, valid, reason, granted_by)
      values (app.tenant_id(), ${g.memberId}, ${g.roleId}, ${g.scopeKind}, ${g.scopeOrgUnitId}, ${g.scopeShiftId},
        tstzrange(
          coalesce((${g.validFrom}::date)::timestamp at time zone ${tz}, now()),
          (${g.validTo}::date)::timestamp at time zone ${tz}),
        ${g.reason}, auth.uid())`;
    return 'Grant added';
  });
}

export async function revokeGrant(id: string, _prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAdmin('admin.roles.manage', form, async (tx) => {
    await tx`delete from role_grants where id = ${id}`;
    return 'Revoked';
  });
}

const checkSchema = z.object({
  memberId: z.uuid(),
  permission: z.string().refine(isPermission),
  orgUnitId: z.union([z.uuid(), z.literal('')]),
  shiftId: z.union([z.uuid(), z.literal('')]),
});

/** "Why can / can't this member do X here?" — evaluates the member's current grants. */
export async function checkAccess(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getRequestContext();
  const d = check(ctx, 'admin.roles.manage');
  if (!d.allowed) return { ok: false, message: `Not allowed: ${d.reason}` };
  const parsed = checkSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: 'Choose a member and permission.' };
  const q = parsed.data;
  const { rows, path } = await withCtxDb(ctx, async (tx) => ({
    rows: await tx<MyGrantRow[]>`
      select rp.permission, g.scope_kind, ou.path::text as scope_path, g.scope_shift_id,
             lower(g.valid) as valid_from, upper(g.valid) as valid_to, r.key as role_key
      from role_grants g join roles r on r.id = g.role_id join role_permissions rp on rp.role_id = r.id
      left join org_units ou on ou.id = g.scope_org_unit_id
      where g.member_id = ${q.memberId} and g.valid @> now()`,
    path: q.orgUnitId ? (await tx<{ p: string }[]>`select path::text as p from org_units where id = ${q.orgUnitId}`)[0]?.p ?? null : null,
  }));
  const decision = can(toGrants([...rows]), q.memberId, q.permission as Parameters<typeof can>[2],
    { orgUnitPath: path, shiftId: q.shiftId || null, ownerMemberId: null }, new Date());
  return { ok: true, message: decision.reason };
}
