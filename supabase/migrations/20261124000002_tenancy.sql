-- Tenancy: tenants (departments), settings, user profiles, memberships, JWT hook.

-- Nothing in public is reachable by anonymous users.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null,
  us_state char(2),
  department_type text not null
    check (department_type in ('career','combination','volunteer','private_ems','county_ems','other')),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_at timestamptz not null default now()
);

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  terminology jsonb not null default '{}',
  enabled_modules text[] not null default '{}',
  branding jsonb not null default '{}'
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  active_tenant_id uuid references public.tenants(id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','invited','suspended','removed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- RLS -----------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;

create policy memberships_visible on public.memberships for select to authenticated
  using (user_id = auth.uid() or tenant_id = app.tenant_id());

create policy tenants_visible on public.tenants for select to authenticated
  using (
    id = app.tenant_id()
    or exists (select 1 from public.memberships m
               where m.tenant_id = tenants.id and m.user_id = auth.uid() and m.status = 'active')
  );

create policy tenant_isolation on public.tenant_settings for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());

create policy profiles_own on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Profile row for every new auth user ---------------------------------------
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Tenant creation (platform onboarding; service role only in Phase 0) -------
create or replace function app.create_tenant(
  p_name text, p_slug text, p_timezone text, p_department_type text, p_us_state char(2)
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone: %', p_timezone;
  end if;
  insert into public.tenants (name, slug, timezone, department_type, us_state)
    values (p_name, p_slug, p_timezone, p_department_type, p_us_state) returning id into v_id;
  insert into public.tenant_settings (tenant_id) values (v_id);
  return v_id;
end $$;
revoke execute on function app.create_tenant(text, text, text, text, char) from public, anon, authenticated;
grant execute on function app.create_tenant(text, text, text, text, char) to service_role;

-- Switch active tenant (member only) ----------------------------------------
create or replace function app.set_active_tenant(p_tenant uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships
                 where tenant_id = p_tenant and user_id = auth.uid() and status = 'active') then
    raise exception 'not a member of tenant %', p_tenant;
  end if;
  update public.profiles set active_tenant_id = p_tenant where user_id = auth.uid();
end $$;
revoke execute on function app.set_active_tenant(uuid) from public, anon;
grant execute on function app.set_active_tenant(uuid) to authenticated;

-- Custom access token hook: adds tenant_id claim -----------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_tenant uuid;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
begin
  select p.active_tenant_id into v_tenant
  from public.profiles p
  join public.memberships m on m.tenant_id = p.active_tenant_id and m.user_id = p.user_id and m.status = 'active'
  where p.user_id = v_user;

  v_claims := jsonb_set(v_claims, '{tenant_id}', coalesce(to_jsonb(v_tenant), 'null'::jsonb));
  return jsonb_set(event, '{claims}', v_claims);
end $$;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
