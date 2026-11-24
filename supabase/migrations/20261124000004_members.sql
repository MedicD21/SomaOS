-- Members (people in a department) and effective-dated assignments.
-- Cross-tenant references are prevented with composite (tenant_id, id) foreign keys.

alter table public.org_units add constraint org_units_tenant_id_id_key unique (tenant_id, id);
alter table public.shifts add constraint shifts_tenant_id_id_key unique (tenant_id, id);
alter table public.ranks add constraint ranks_tenant_id_id_key unique (tenant_id, id);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  employee_number text,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  email text,
  phone text,
  hire_date date,
  seniority_date date,
  rank_id uuid,
  employment_type text not null
    check (employment_type in ('career_full_time','career_part_time','volunteer','per_diem','other')),
  status text not null default 'active' check (status in ('active','leave','separated')),
  separated_on date,
  custom jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, employee_number),
  foreign key (tenant_id, rank_id) references public.ranks(tenant_id, id)
);
create unique index members_tenant_user_key on public.members (tenant_id, user_id) where user_id is not null;

create table public.member_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  org_unit_id uuid not null,
  shift_id uuid,
  is_primary boolean not null default true,
  effective daterange not null,
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, shift_id) references public.shifts(tenant_id, id),
  constraint member_assignments_no_overlap
    exclude using gist (member_id with =, effective with &&) where (is_primary)
);

alter table public.members enable row level security;
alter table public.member_assignments enable row level security;
create policy tenant_isolation on public.members for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
create policy tenant_isolation on public.member_assignments for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());

-- The caller's member record in the active tenant.
create or replace function app.my_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.members m
  where m.tenant_id = app.tenant_id() and m.user_id = auth.uid()
$$;
grant execute on function app.my_member_id() to authenticated, service_role;

-- Current primary assignment per member, "today" in the tenant's timezone.
create or replace view app.current_primary_assignment with (security_invoker = true) as
  select a.member_id, a.org_unit_id, a.shift_id
  from public.member_assignments a
  join public.tenants t on t.id = a.tenant_id
  where a.is_primary
    and a.effective @> (now() at time zone t.timezone)::date;
grant select on app.current_primary_assignment to authenticated, service_role;
