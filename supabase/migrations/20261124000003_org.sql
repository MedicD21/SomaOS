-- Configurable organization structure: org unit types, any-depth org tree, ranks, shifts.

create table public.org_unit_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  sort int not null default 0,
  unique (tenant_id, key)
);

create table public.org_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type_id uuid not null references public.org_unit_types(id),
  parent_id uuid references public.org_units(id),
  name text not null,
  code text,
  path extensions.ltree not null,
  timezone text,
  status text not null default 'active' check (status in ('active','archived')),
  custom jsonb not null default '{}'
);
create index org_units_path_gist on public.org_units using gist (path);
create index org_units_tenant_idx on public.org_units (tenant_id);

create table public.ranks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  sort int not null, -- lower = more senior
  unique (tenant_id, key)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  color text,
  sort int not null default 0,
  unique (tenant_id, key)
);

-- Path maintenance -----------------------------------------------------------
create or replace function app.org_unit_label(p_id uuid) returns extensions.ltree
language sql immutable set search_path = '' as $$
  select extensions.text2ltree(replace(p_id::text, '-', '_'))
$$;

create or replace function app.org_units_before_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_parent public.org_units;
begin
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    -- Path is derived: only the move cascade (nested trigger) may rewrite it.
    if pg_catalog.pg_trigger_depth() <= 1 then
      new.path := old.path;
    end if;
    return new;
  end if;
  if new.parent_id is null then
    new.path := app.org_unit_label(new.id);
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'org unit cycle';
  end if;
  select * into v_parent from public.org_units where id = new.parent_id;
  if v_parent.tenant_id <> new.tenant_id then
    raise exception 'cross-tenant parent';
  end if;
  if tg_op = 'UPDATE' and v_parent.path operator(extensions.<@) old.path then
    raise exception 'org unit cycle';
  end if;
  new.path := v_parent.path operator(extensions.||) app.org_unit_label(new.id);
  return new;
end $$;

create or replace function app.org_units_after_move()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.org_units
     set path = new.path operator(extensions.||) extensions.subpath(path, extensions.nlevel(old.path))
   where path operator(extensions.<@) old.path and id <> new.id;
  return null;
end $$;

-- Allow the trigger to receive a placeholder path on insert.
alter table public.org_units alter column path set default ''::extensions.ltree;

create trigger org_units_before_write before insert or update on public.org_units
  for each row execute function app.org_units_before_write();
create trigger org_units_after_move after update of parent_id on public.org_units
  for each row when (old.parent_id is distinct from new.parent_id)
  execute function app.org_units_after_move();

-- RLS -----------------------------------------------------------------------
alter table public.org_unit_types enable row level security;
alter table public.org_units enable row level security;
alter table public.ranks enable row level security;
alter table public.shifts enable row level security;

create policy tenant_isolation on public.org_unit_types for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
create policy tenant_isolation on public.org_units for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
create policy tenant_isolation on public.ranks for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
create policy tenant_isolation on public.shifts for all to authenticated
  using (tenant_id = app.tenant_id()) with check (tenant_id = app.tenant_id());
