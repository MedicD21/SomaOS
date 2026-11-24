import type postgres from 'postgres';
import type { DepartmentTemplate } from './types';

export type FirstAdmin = { userId: string; firstName: string; lastName: string };

/**
 * Seeds a tenant from a template. Idempotent: re-running adds anything missing and
 * changes nothing that already exists. Must run with a privileged connection
 * (service role / platform onboarding).
 */
export async function applyTemplate(
  tx: postgres.TransactionSql,
  tenantId: string,
  template: DepartmentTemplate,
  firstAdmin: FirstAdmin,
): Promise<void> {
  for (const t of template.orgUnitTypes) {
    await tx`insert into org_unit_types (tenant_id, key, label, sort)
             values (${tenantId}, ${t.key}, ${t.label}, ${t.sort}) on conflict (tenant_id, key) do nothing`;
  }
  for (const r of template.ranks) {
    await tx`insert into ranks (tenant_id, key, label, sort)
             values (${tenantId}, ${r.key}, ${r.label}, ${r.sort}) on conflict (tenant_id, key) do nothing`;
  }
  for (const [i, s] of template.shifts.entries()) {
    await tx`insert into shifts (tenant_id, key, label, color, sort)
             values (${tenantId}, ${s.key}, ${s.label}, ${s.color}, ${i + 1}) on conflict (tenant_id, key) do nothing`;
  }
  for (const role of template.roles) {
    const [row] = await tx<{ id: string }[]>`
      insert into roles (tenant_id, key, label, is_system) values (${tenantId}, ${role.key}, ${role.label}, true)
      on conflict (tenant_id, key) do update set key = excluded.key returning id`;
    for (const p of role.permissions) {
      await tx`insert into role_permissions (tenant_id, role_id, permission)
               values (${tenantId}, ${row!.id}, ${p}) on conflict do nothing`;
    }
  }
  for (const c of template.credentialTypes) {
    await tx`insert into credential_types (tenant_id, key, label, validity, warn_days)
             values (${tenantId}, ${c.key}, ${c.label}, ${tx.json(c.validity)}, ${c.warnDays})
             on conflict (tenant_id, key) do nothing`;
  }
  if (template.schedulePattern) {
    const { key, payload } = template.schedulePattern;
    await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload, approved_at)
             select t.id, 'schedule.pattern', ${key}, 1, 'approved',
                    tstzrange((${payload.anchorDate}::date)::timestamp at time zone t.timezone, null),
                    ${tx.json(payload)}, now()
             from tenants t where t.id = ${tenantId}
             on conflict (tenant_id, kind, key, version) do nothing`;
  }
  for (const b of template.leave.banks) {
    await tx`insert into leave_banks (tenant_id, key, label) values (${tenantId}, ${b.key}, ${b.label})
             on conflict (tenant_id, key) do nothing`;
  }
  for (const [i, lt] of template.leave.types.entries()) {
    await tx`insert into leave_types (tenant_id, key, label, bank_id, requires_documentation, lead_time_days, counts_as_worked, sort)
             select ${tenantId}, ${lt.key}, ${lt.label}, b.id, ${lt.requiresDocumentation}, ${lt.leadTimeDays}, ${lt.countsAsWorked}, ${i + 1}
             from (select 1) x left join leave_banks b on b.tenant_id = ${tenantId} and b.key = ${lt.bankKey}
             on conflict (tenant_id, key) do nothing`;
  }
  // Starter policies are DRAFTS: nothing accrues until an administrator edits and approves them.
  for (const p of template.leave.policies) {
    await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload, change_note)
             values (${tenantId}, 'leave.accrual', ${p.bankKey}, 1, 'draft', tstzrange(null, null),
                     ${tx.json(p.payload as never)}, 'Starter values from the department template — review before approving')
             on conflict (tenant_id, kind, key, version) do nothing`;
  }
  await tx`update tenant_settings set enabled_modules = ${template.enabledModules}
           where tenant_id = ${tenantId} and enabled_modules = '{}'`;

  await tx`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${firstAdmin.userId}, 'active')
           on conflict (tenant_id, user_id) do update set status = 'active'`;
  const [member] = await tx<{ id: string }[]>`
    insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${firstAdmin.userId}, ${firstAdmin.firstName}, ${firstAdmin.lastName}, 'career_full_time')
    on conflict (tenant_id, user_id) where user_id is not null do update set user_id = excluded.user_id
    returning id`;
  await tx`
    insert into role_grants (tenant_id, member_id, role_id, scope_kind, reason)
    select ${tenantId}, ${member!.id}, r.id, 'department', 'initial department admin'
    from roles r where r.tenant_id = ${tenantId} and r.key = 'dept_admin'
      and not exists (select 1 from role_grants g where g.member_id = ${member!.id} and g.role_id = r.id)`;
  await tx`update profiles set active_tenant_id = ${tenantId} where user_id = ${firstAdmin.userId} and active_tenant_id is null`;
}
