-- Pay: pay codes, employee groups (members who share pay rules), and effective-dated hourly rates.
-- Rates are sensitive: only department-wide pay.view / pay.manage holders can read them.

create table public.pay_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  kind text not null check (kind in ('regular','overtime','premium','leave','other')),
  multiplier numeric(5,3) not null default 1 check (multiplier >= 0 and multiplier <= 5),
  counts_toward_flsa boolean not null default true,
  export_code text,
  sort int not null default 0,
  archived_at timestamptz,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.employee_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  archived_at timestamptz,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

alter table public.members add column employee_group_id uuid;
alter table public.members add foreign key (tenant_id, employee_group_id) references public.employee_groups(tenant_id, id);

create table public.member_pay_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  hourly_rate numeric(10,4) not null check (hourly_rate > 0),
  effective daterange not null check (not isempty(effective)),
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  constraint member_pay_rates_member_no_overlap exclude using gist (member_id with =, effective with &&)
);
create index member_pay_rates_member_idx on public.member_pay_rates (tenant_id, member_id);

revoke delete, truncate on public.member_pay_rates from authenticated, anon;

create or replace function app.can_view_pay() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission_dept('pay.view') or app.has_permission_dept('pay.manage')
$$;
grant execute on function app.can_view_pay() to authenticated, service_role;

alter table public.pay_codes enable row level security;
alter table public.employee_groups enable row level security;
alter table public.member_pay_rates enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pay_codes', 'employee_groups'] loop
    execute format('create policy tenant_read on public.%I for select to authenticated using (tenant_id = app.tenant_id())', t);
    execute format('create policy tenant_write on public.%I for all to authenticated
                    using (tenant_id = app.tenant_id() and app.has_permission_dept(%L))
                    with check (tenant_id = app.tenant_id() and app.has_permission_dept(%L))', t, 'pay.manage', 'pay.manage');
  end loop;
end $$;

create policy rates_read on public.member_pay_rates for select to authenticated
  using (tenant_id = app.tenant_id() and app.can_view_pay());
create policy rates_write on public.member_pay_rates for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('pay.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission_dept('pay.manage'));

create trigger audit after insert or update or delete on public.pay_codes
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.employee_groups
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.member_pay_rates
  for each row execute function app.audit_trigger();

-- The hourly rate in force for a member on a date (null when none). Department-wide pay.view only.
create or replace function app.pay_rate_on(p_member uuid, p_date date) returns numeric
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_view_pay() then raise exception 'not allowed: pay.view required'; end if;
  return (select r.hourly_rate from public.member_pay_rates r
          where r.tenant_id = app.tenant_id() and r.member_id = p_member and r.effective @> p_date);
end $$;
revoke execute on function app.pay_rate_on(uuid, date) from public, anon;
grant execute on function app.pay_rate_on(uuid, date) to authenticated;
