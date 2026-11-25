-- Consumable inventory: items, stock locations (a tree: storeroom > station > apparatus > compartment),
-- par levels and an append-only stock ledger. On-hand is a view over the ledger, so it cannot drift.
-- Reads are department-wide for inventory.stock.view holders; writes go through scope-checked functions.
-- Controlled substances are Phase 3b and get their own ledger; items.is_controlled is pinned false here.

create table public.items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text check (sku is null or length(sku) between 1 and 80),
  name text not null check (length(name) between 1 and 120),
  category text not null default 'medical' check (category in ('medical', 'station_supply', 'ppe', 'other')),
  unit text not null default 'each' check (length(unit) between 1 and 30),
  is_controlled boolean not null default false check (not is_controlled),
  archived_at timestamptz,
  unique (tenant_id, id)
);
create unique index items_sku_key on public.items (tenant_id, sku) where sku is not null;

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('storeroom', 'station', 'apparatus', 'compartment', 'container')),
  parent_id uuid,
  org_unit_id uuid,
  archived_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, parent_id) references public.stock_locations(tenant_id, id),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id)
);
create index stock_locations_parent_idx on public.stock_locations (tenant_id, parent_id);

create table public.par_levels (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  item_id uuid not null,
  par numeric(12,3) not null check (par >= 0),
  min numeric(12,3) not null default 0 check (min >= 0),
  primary key (location_id, item_id),
  check (min <= par),
  foreign key (tenant_id, location_id) references public.stock_locations(tenant_id, id),
  foreign key (tenant_id, item_id) references public.items(tenant_id, id)
);

create table public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  item_id uuid not null,
  delta numeric(12,3) not null check (delta <> 0),
  type text not null check (type in ('receive', 'use', 'adjust', 'transfer_out', 'transfer_in')),
  transfer_id uuid,
  performed_by uuid not null,
  witnessed_by uuid,                 -- Phase 3b hooks: witness, signature, lot, free-form reference
  lot_id uuid,
  signature_id uuid,
  reference jsonb not null default '{}',
  reason text,
  occurred_at timestamptz not null default clock_timestamp(),
  check ((type in ('receive', 'transfer_in') and delta > 0) or (type in ('use', 'transfer_out') and delta < 0) or type = 'adjust'),
  check ((type in ('transfer_out', 'transfer_in')) = (transfer_id is not null)),
  foreign key (tenant_id, location_id) references public.stock_locations(tenant_id, id),
  foreign key (tenant_id, item_id) references public.items(tenant_id, id),
  foreign key (tenant_id, performed_by) references public.members(tenant_id, id),
  foreign key (tenant_id, witnessed_by) references public.members(tenant_id, id)
);
create index stock_ledger_pair_idx on public.stock_ledger (tenant_id, location_id, item_id);

create trigger forbid_mutation before update or delete on public.stock_ledger
  for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.stock_ledger
  for each statement execute function app.forbid_mutation();

-- Checklists can record the station / container they were done at.
alter table public.checklist_completions
  add foreign key (tenant_id, stock_location_id) references public.stock_locations(tenant_id, id);

revoke insert, update, delete, truncate on public.stock_ledger, public.stock_locations, public.par_levels from authenticated, anon;
revoke delete, truncate on public.items from authenticated, anon;

alter table public.items enable row level security;
alter table public.stock_locations enable row level security;
alter table public.par_levels enable row level security;
alter table public.stock_ledger enable row level security;

create policy tenant_read on public.items for select to authenticated using (tenant_id = app.tenant_id());
create policy tenant_write on public.items for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('inventory.stock.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission_dept('inventory.stock.manage'));
create policy tenant_read on public.stock_locations for select to authenticated using (tenant_id = app.tenant_id());
create policy stock_read on public.par_levels for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('inventory.stock.view'));
create policy stock_read on public.stock_ledger for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('inventory.stock.view'));

create trigger audit after insert or update or delete on public.items for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.stock_locations for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.par_levels for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.stock_ledger for each row execute function app.audit_trigger();

create view public.stock_levels with (security_invoker = true) as
  select tenant_id, location_id, item_id, sum(delta)::numeric(12,3) as on_hand
  from public.stock_ledger group by tenant_id, location_id, item_id;

create view public.low_stock with (security_invoker = true) as
  select p.tenant_id, p.location_id, p.item_id, coalesce(l.on_hand, 0)::numeric(12,3) as on_hand, p.par, p.min,
         (p.par - coalesce(l.on_hand, 0))::numeric(12,3) as short_by,
         coalesce(l.on_hand, 0) <= p.min as critical
  from public.par_levels p
  left join public.stock_levels l on l.location_id = p.location_id and l.item_id = p.item_id
  where coalesce(l.on_hand, 0) < p.par;
grant select on public.stock_levels, public.low_stock to authenticated, service_role;

-- The org unit that governs a location: its own, else the nearest ancestor's (null = department-wide).
create or replace function app.stock_unit(p_location uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select l.id, l.parent_id, l.org_unit_id, 0 as depth from public.stock_locations l
    where l.id = p_location and l.tenant_id = app.tenant_id()
    union all
    select p.id, p.parent_id, p.org_unit_id, up.depth + 1 from public.stock_locations p join up on p.id = up.parent_id
    where up.org_unit_id is null and up.depth < 20)
  select org_unit_id from up where org_unit_id is not null order by depth limit 1
$$;
revoke execute on function app.stock_unit(uuid) from public, anon;
grant execute on function app.stock_unit(uuid) to authenticated, service_role;

create or replace function app.create_stock_location(p_name text, p_kind text, p_parent uuid, p_org_unit uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := app.tenant_id(); v_name text := nullif(trim(coalesce(p_name, '')), ''); v_unit uuid := p_org_unit; v_id uuid;
begin
  if v_name is null then raise exception 'Enter a name for the location'; end if;
  if p_kind is null or p_kind not in ('storeroom', 'station', 'apparatus', 'compartment', 'container') then raise exception 'Choose a location type'; end if;
  if p_parent is not null then
    if not exists (select 1 from public.stock_locations l where l.id = p_parent and l.tenant_id = v_tenant and l.archived_at is null) then
      raise exception 'Unknown parent location';
    end if;
    v_unit := coalesce(v_unit, app.stock_unit(p_parent));
  end if;
  if p_org_unit is not null and not exists (select 1 from public.org_units o where o.id = p_org_unit and o.tenant_id = v_tenant) then
    raise exception 'Unknown station';
  end if;
  if not app.has_permission_unit('inventory.stock.manage', v_unit) then raise exception 'not allowed: you cannot add locations here'; end if;
  insert into public.stock_locations (tenant_id, name, kind, parent_id, org_unit_id)
  values (v_tenant, v_name, p_kind, p_parent, p_org_unit) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.create_stock_location(text, text, uuid, uuid) from public, anon;
grant execute on function app.create_stock_location(text, text, uuid, uuid) to authenticated;

create or replace function app.archive_stock_location(p_location uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stock_locations where id = p_location and tenant_id = app.tenant_id()) then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('inventory.stock.manage', app.stock_unit(p_location)) then raise exception 'not allowed: you cannot archive this location'; end if;
  update public.stock_locations set archived_at = coalesce(archived_at, now()) where id = p_location;
end $$;
revoke execute on function app.archive_stock_location(uuid) from public, anon;
grant execute on function app.archive_stock_location(uuid) to authenticated;

-- Shared checks for the movement functions.
create or replace function app.stock_check_pair(p_location uuid, p_item uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stock_locations l where l.id = p_location and l.tenant_id = app.tenant_id()) then raise exception 'Unknown location'; end if;
  if not exists (select 1 from public.items i where i.id = p_item and i.tenant_id = app.tenant_id()) then raise exception 'Unknown item'; end if;
  if exists (select 1 from public.stock_locations l where l.id = p_location and l.archived_at is not null) then raise exception 'That location is archived'; end if;
  if exists (select 1 from public.items i where i.id = p_item and i.archived_at is not null) then raise exception 'That item is archived'; end if;
end $$;
revoke execute on function app.stock_check_pair(uuid, uuid) from public, anon, authenticated;

create or replace function app.stock_lock(p_location uuid, p_item uuid) returns void
language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(p_location::text || ':' || p_item::text, 0))
$$;
revoke execute on function app.stock_lock(uuid, uuid) from public, anon, authenticated;

create or replace function app.stock_on_hand(p_location uuid, p_item uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0) from public.stock_ledger where location_id = p_location and item_id = p_item and tenant_id = app.tenant_id()
$$;
revoke execute on function app.stock_on_hand(uuid, uuid) from public, anon, authenticated;

create or replace function app.receive_stock(p_location uuid, p_item uuid, p_qty numeric, p_reference jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.stock_check_pair(p_location, p_item);
  if not app.has_permission_unit('inventory.stock.manage', app.stock_unit(p_location)) then raise exception 'not allowed: you cannot receive stock here'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a quantity above zero'; end if;
  insert into public.stock_ledger (tenant_id, location_id, item_id, delta, type, performed_by, reference)
  values (app.tenant_id(), p_location, p_item, p_qty, 'receive', app.my_member_id(), coalesce(p_reference, '{}'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.receive_stock(uuid, uuid, numeric, jsonb) from public, anon;
grant execute on function app.receive_stock(uuid, uuid, numeric, jsonb) to authenticated;

create or replace function app.use_stock(p_location uuid, p_item uuid, p_qty numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_unit uuid;
begin
  perform app.stock_check_pair(p_location, p_item);
  v_unit := app.stock_unit(p_location);
  if not (app.has_permission_unit('inventory.stock.use', v_unit) or app.has_permission_unit('inventory.stock.manage', v_unit)) then
    raise exception 'not allowed: you cannot use stock from here';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a quantity above zero'; end if;
  perform app.stock_lock(p_location, p_item);
  if app.stock_on_hand(p_location, p_item) < p_qty then raise exception 'Not enough stock: only % on hand', app.stock_on_hand(p_location, p_item); end if;
  insert into public.stock_ledger (tenant_id, location_id, item_id, delta, type, performed_by, reason)
  values (app.tenant_id(), p_location, p_item, -p_qty, 'use', app.my_member_id(), nullif(trim(coalesce(p_reason, '')), '')) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.use_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function app.use_stock(uuid, uuid, numeric, text) to authenticated;

create or replace function app.adjust_stock(p_location uuid, p_item uuid, p_delta numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform app.stock_check_pair(p_location, p_item);
  if not app.has_permission_unit('inventory.stock.manage', app.stock_unit(p_location)) then raise exception 'not allowed: you cannot adjust stock here'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Enter a change other than zero'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'Explain the adjustment (at least 5 characters)'; end if;
  perform app.stock_lock(p_location, p_item);
  if app.stock_on_hand(p_location, p_item) + p_delta < 0 then raise exception 'Not enough stock: only % on hand', app.stock_on_hand(p_location, p_item); end if;
  insert into public.stock_ledger (tenant_id, location_id, item_id, delta, type, performed_by, reason)
  values (app.tenant_id(), p_location, p_item, p_delta, 'adjust', app.my_member_id(), v_reason) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.adjust_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function app.adjust_stock(uuid, uuid, numeric, text) to authenticated;

create or replace function app.transfer_stock(p_from uuid, p_to uuid, p_item uuid, p_qty numeric, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_transfer uuid := gen_random_uuid();
  v_unit_from uuid; v_unit_to uuid;
begin
  if p_from is not distinct from p_to then raise exception 'Choose two different locations'; end if;
  perform app.stock_check_pair(p_from, p_item);
  perform app.stock_check_pair(p_to, p_item);
  v_unit_from := app.stock_unit(p_from);
  v_unit_to := app.stock_unit(p_to);
  if not (app.has_permission_unit('inventory.stock.use', v_unit_from) or app.has_permission_unit('inventory.stock.manage', v_unit_from))
     or not (app.has_permission_unit('inventory.stock.use', v_unit_to) or app.has_permission_unit('inventory.stock.manage', v_unit_to)) then
    raise exception 'not allowed: you cannot transfer between these locations';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a quantity above zero'; end if;
  -- Lock both pairs in a fixed order so two opposite transfers cannot deadlock.
  if p_from::text < p_to::text then
    perform app.stock_lock(p_from, p_item); perform app.stock_lock(p_to, p_item);
  else
    perform app.stock_lock(p_to, p_item); perform app.stock_lock(p_from, p_item);
  end if;
  if app.stock_on_hand(p_from, p_item) < p_qty then raise exception 'Not enough stock: only % on hand', app.stock_on_hand(p_from, p_item); end if;
  insert into public.stock_ledger (tenant_id, location_id, item_id, delta, type, transfer_id, performed_by, reason)
  values (app.tenant_id(), p_from, p_item, -p_qty, 'transfer_out', v_transfer, app.my_member_id(), nullif(trim(coalesce(p_note, '')), '')),
         (app.tenant_id(), p_to, p_item, p_qty, 'transfer_in', v_transfer, app.my_member_id(), nullif(trim(coalesce(p_note, '')), ''));
  return v_transfer;
end $$;
revoke execute on function app.transfer_stock(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function app.transfer_stock(uuid, uuid, uuid, numeric, text) to authenticated;

create or replace function app.set_par(p_location uuid, p_item uuid, p_par numeric, p_min numeric default 0) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.stock_check_pair(p_location, p_item);
  if not app.has_permission_unit('inventory.stock.manage', app.stock_unit(p_location)) then raise exception 'not allowed: you cannot set par levels here'; end if;
  if p_par is null or p_par < 0 or coalesce(p_min, 0) < 0 or coalesce(p_min, 0) > p_par then raise exception 'Par must be zero or more, and the minimum cannot exceed it'; end if;
  insert into public.par_levels (tenant_id, location_id, item_id, par, min)
  values (app.tenant_id(), p_location, p_item, p_par, coalesce(p_min, 0))
  on conflict (location_id, item_id) do update set par = excluded.par, min = excluded.min;
end $$;
revoke execute on function app.set_par(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function app.set_par(uuid, uuid, numeric, numeric) to authenticated;
