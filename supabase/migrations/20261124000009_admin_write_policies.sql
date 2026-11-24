-- Defense in depth: writes to department settings and org structure require the
-- matching admin permission in the database, not only in the app.

-- tenants: admins may change name/timezone/state only.
revoke update on public.tenants from authenticated;
grant update (name, timezone, us_state) on public.tenants to authenticated;
create policy tenants_admin_update on public.tenants for update to authenticated
  using (id = app.tenant_id() and app.has_permission('admin.tenant.manage'))
  with check (id = app.tenant_id());

create or replace function app.tenants_validate_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown timezone: %', new.timezone;
  end if;
  return new;
end $$;
create trigger tenants_validate_timezone before insert or update of timezone on public.tenants
  for each row execute function app.tenants_validate_timezone();

-- Split "for all" tenant policies into read (tenant) + write (tenant + permission).
do $$
declare
  r record;
begin
  for r in select * from (values
      ('tenant_settings', 'admin.tenant.manage'),
      ('org_unit_types', 'admin.org.manage'),
      ('org_units', 'admin.org.manage'),
      ('ranks', 'admin.org.manage'),
      ('shifts', 'admin.org.manage'),
      ('members', 'admin.members.manage'),
      ('member_assignments', 'admin.members.manage'),
      ('roles', 'admin.roles.manage'),
      ('role_permissions', 'admin.roles.manage'),
      ('role_grants', 'admin.roles.manage')
    ) as v(tbl, perm)
  loop
    execute format('drop policy tenant_isolation on public.%I', r.tbl);
    execute format('create policy tenant_read on public.%I for select to authenticated
                    using (tenant_id = app.tenant_id())', r.tbl);
    execute format('create policy tenant_write on public.%I for all to authenticated
                    using (tenant_id = app.tenant_id() and app.has_permission(%L))
                    with check (tenant_id = app.tenant_id() and app.has_permission(%L))', r.tbl, r.perm, r.perm);
  end loop;
end $$;
