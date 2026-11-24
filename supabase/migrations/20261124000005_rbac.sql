-- Roles, role permissions, and scoped, time-bound role grants.

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  is_system boolean not null default false,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.role_permissions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role_id uuid not null,
  permission text not null,
  primary key (role_id, permission),
  foreign key (tenant_id, role_id) references public.roles(tenant_id, id) on delete cascade
);

create table public.role_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  role_id uuid not null,
  scope_kind text not null check (scope_kind in ('self','org_unit','department')),
  scope_org_unit_id uuid,
  scope_shift_id uuid,
  valid tstzrange not null default tstzrange(now(), null),
  reason text,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint role_grants_scope_check check ((scope_kind = 'org_unit') = (scope_org_unit_id is not null)),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id) references public.roles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, scope_org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, scope_shift_id) references public.shifts(tenant_id, id)
);
create index role_grants_member_idx on public.role_grants (member_id);

alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_grants enable row level security;
create policy tenant_isolation on public.roles for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
create policy tenant_isolation on public.role_permissions for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
create policy tenant_isolation on public.role_grants for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());

-- Caller's current grants in the active tenant ------------------------------
create or replace function app.my_grants()
returns table (
  permission text, scope_kind text, scope_path text, scope_shift_id uuid,
  valid_from timestamptz, valid_to timestamptz, role_key text
)
language sql stable security definer set search_path = '' as $$
  select rp.permission, g.scope_kind, ou.path::text, g.scope_shift_id,
         lower(g.valid), upper(g.valid), r.key
  from public.role_grants g
  join public.roles r on r.id = g.role_id
  join public.role_permissions rp on rp.role_id = r.id
  left join public.org_units ou on ou.id = g.scope_org_unit_id
  where g.tenant_id = app.tenant_id()
    and g.member_id = app.my_member_id()
    and g.valid @> now()
$$;
grant execute on function app.my_grants() to authenticated, service_role;

-- True when the caller currently holds `perm` in any scope. Used by RLS on
-- admin-only tables (audit log, etc.).
create or replace function app.has_permission(perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.my_grants() g where g.permission = perm)
$$;
grant execute on function app.has_permission(text) to authenticated, service_role;

-- Last-admin protection -------------------------------------------------------
create or replace function app.tenant_has_admin(p_tenant uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.role_grants g
    join public.role_permissions rp on rp.role_id = g.role_id and rp.permission = 'admin.roles.manage'
    where g.tenant_id = p_tenant and g.scope_kind = 'department' and g.valid @> now()
  )
$$;

create or replace function app.guard_last_admin()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_tenant uuid := old.tenant_id;
  v_was_admin boolean;
begin
  -- Tenant being deleted (cascade): nothing to protect.
  if not exists (select 1 from public.tenants where id = v_tenant) then
    return null;
  end if;
  if tg_table_name = 'role_grants' then
    v_was_admin := old.scope_kind = 'department' and old.valid @> now() and exists (
      select 1 from public.role_permissions rp
      where rp.role_id = old.role_id and rp.permission = 'admin.roles.manage');
  else -- role_permissions
    v_was_admin := old.permission = 'admin.roles.manage';
  end if;
  if v_was_admin and not app.tenant_has_admin(v_tenant) then
    raise exception 'cannot remove last admin';
  end if;
  return null;
end $$;

create trigger role_grants_last_admin after update or delete on public.role_grants
  for each row execute function app.guard_last_admin();
create trigger role_permissions_last_admin after update or delete on public.role_permissions
  for each row execute function app.guard_last_admin();
