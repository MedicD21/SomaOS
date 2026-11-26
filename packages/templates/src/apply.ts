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
  for (const [i, c] of template.pay.codes.entries()) {
    await tx`insert into pay_codes (tenant_id, key, label, kind, multiplier, counts_toward_flsa, export_code, sort)
             values (${tenantId}, ${c.key}, ${c.label}, ${c.kind}, ${c.multiplier}, ${c.countsTowardFlsa}, ${c.exportCode}, ${i + 1})
             on conflict (tenant_id, key) do nothing`;
  }
  for (const g of template.pay.groups) {
    await tx`insert into employee_groups (tenant_id, key, label) values (${tenantId}, ${g.key}, ${g.label})
             on conflict (tenant_id, key) do nothing`;
  }
  // Starter pay rules are DRAFTS: nothing is calculated for pay until an administrator edits and approves them.
  for (const r of template.pay.rules) {
    await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload, change_note)
             values (${tenantId}, 'pay.rules', ${r.groupKey}, 1, 'draft', tstzrange(null, null),
                     ${tx.json(r.payload as never)}, 'Starter values from the department template — review before approving')
             on conflict (tenant_id, kind, key, version) do nothing`;
  }
  // Starter folders and forms (idempotent: nothing that already exists is touched). Forms start published at version 1.
  for (const f of template.documents.folders) {
    await tx`insert into document_folders (tenant_id, name, view_permission)
             select ${tenantId}, ${f.name}, ${f.viewPermission}
             where not exists (select 1 from document_folders where tenant_id = ${tenantId} and parent_id is null and lower(name) = lower(${f.name}))`;
  }
  for (const f of template.documents.forms) {
    await tx`insert into form_definitions (tenant_id, key, version, label, description, fields, requires_signature, signature_statement, approval, status, published_at)
             select ${tenantId}, ${f.key}, 1, ${f.label}, ${f.description}, ${tx.json(f.fields as never)}, ${f.requiresSignature}, ${f.signatureStatement},
                    ${f.approval}, 'published', now()
             where not exists (select 1 from form_definitions where tenant_id = ${tenantId} and key = ${f.key})`;
  }
  const inv = template.inventory;
  for (const t of inv.assetTypes) {
    await tx`insert into asset_types (tenant_id, key, label, category) values (${tenantId}, ${t.key}, ${t.label}, ${t.category})
             on conflict (tenant_id, key) do nothing`;
  }
  for (const [i, f] of inv.assetFields.entries()) {
    await tx`insert into custom_field_defs (tenant_id, entity, key, label, type, required, sort)
             values (${tenantId}, 'asset', ${f.key}, ${f.label}, ${f.type}, ${f.required}, ${i + 1})
             on conflict (tenant_id, entity, key) do nothing`;
  }
  for (const c of inv.checklists) {
    await tx`insert into checklist_templates (tenant_id, key, label, asset_type_id, version, items, log_failure)
             select ${tenantId}, ${c.key}, ${c.label}, (select id from asset_types where tenant_id = ${tenantId} and key = ${c.assetTypeKey}),
                    1, ${tx.json(c.items)}, ${c.logFailure}
             where not exists (select 1 from checklist_templates where tenant_id = ${tenantId} and key = ${c.key})`;
  }
  for (const it of inv.items) {
    await tx`insert into items (tenant_id, sku, name, category, unit)
             select ${tenantId}, ${it.sku}, ${it.name}, ${it.category}, ${it.unit}
             where not exists (select 1 from items where tenant_id = ${tenantId} and name = ${it.name})`;
  }
  for (const l of inv.stockLocations) {
    await tx`insert into stock_locations (tenant_id, name, kind)
             select ${tenantId}, ${l.name}, ${l.kind}
             where not exists (select 1 from stock_locations where tenant_id = ${tenantId} and name = ${l.name} and parent_id is null)`;
  }
  // Starter training catalog (idempotent). Example requirements start next January 1 so nothing is overdue before edited.
  const tr = template.training;
  for (const c of tr.categories) {
    await tx`insert into training_categories (tenant_id, key, label, external_code) values (${tenantId}, ${c.key}, ${c.label}, ${c.externalCode})
             on conflict (tenant_id, key) do nothing`;
  }
  for (const c of tr.courses) {
    await tx`insert into training_courses (tenant_id, key, label, category_id, default_hours, credential_type_id, description)
             select ${tenantId}, ${c.key}, ${c.label}, (select id from training_categories where tenant_id = ${tenantId} and key = ${c.categoryKey}),
                    ${c.defaultHours},
                    (select id from credential_types where tenant_id = ${tenantId} and key = ${c.credentialTypeKey}), ${c.description}
             where not exists (select 1 from training_courses where tenant_id = ${tenantId} and key = ${c.key})`;
  }
  for (const r of tr.requirements) {
    await tx`insert into training_requirements (tenant_id, label, category_id, required_hours, span, effective_from)
             select ${tenantId}, ${r.label}, (select id from training_categories where tenant_id = ${tenantId} and key = ${r.categoryKey}),
                    ${r.requiredHours}, ${tx.json(r.window as never)}, make_date(extract(year from current_date)::int + 1, 1, 1)
             where not exists (select 1 from training_requirements where tenant_id = ${tenantId} and label = ${r.label})`;
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
