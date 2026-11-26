-- Controlled substances (Phase 3b), part 1: catalog, custody locations, lots and seals.
-- Separate from the 3a stock tables. Every write goes through the functions below; the tables have no
-- direct write grants. Reads are scoped by custody permissions at the location's org unit.

-- Does the caller hold any custody permission (any scope)? Gates reading the shared catalog.
create or replace function app.cs_has_any() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission('custody.record') or app.has_permission('custody.witness')
      or app.has_permission('custody.audit') or app.has_permission('custody.manage')
$$;
revoke execute on function app.cs_has_any() from public, anon;
grant execute on function app.cs_has_any() to authenticated, service_role;

-- May the caller read custody records at this unit? record / witness / manage at the unit, or audit anywhere.
create or replace function app.cs_can_read(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission_unit('custody.record', p_unit) or app.has_permission_unit('custody.witness', p_unit)
      or app.has_permission_unit('custody.manage', p_unit) or app.has_permission_dept('custody.audit')
$$;
revoke execute on function app.cs_can_read(uuid) from public, anon;
grant execute on function app.cs_can_read(uuid) to authenticated, service_role;

create table public.cs_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  schedule text not null check (length(trim(schedule)) between 1 and 12),   -- free label, e.g. 'II'
  ndc text check (ndc is null or length(ndc) <= 20),
  unit text not null check (unit in ('mg', 'mcg', 'g', 'mL', 'each')),
  strength_note text check (strength_note is null or length(strength_note) <= 200),
  archived_at timestamptz,
  unique (tenant_id, id)
);
create unique index cs_items_name_ndc on public.cs_items (tenant_id, lower(name), coalesce(ndc, ''));

create table public.cs_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  lot_no text not null check (length(trim(lot_no)) between 1 and 60),
  expires_on date not null,
  recalled_at timestamptz,
  recall_note text,
  archived_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, item_id, lot_no),
  foreign key (tenant_id, item_id) references public.cs_items(tenant_id, id)
);

create table public.cs_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('vault', 'station', 'unit', 'drug_box', 'member')),
  org_unit_id uuid not null,
  member_id uuid,
  stock_location_id uuid,
  current_seal_no text,
  chain_head text not null default '',
  chain_seq bigint not null default 0,
  archived_at timestamptz,
  unique (tenant_id, id),
  check ((kind = 'member') = (member_id is not null)),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id),
  foreign key (tenant_id, stock_location_id) references public.stock_locations(tenant_id, id)
);
create index cs_locations_unit_idx on public.cs_locations (tenant_id, org_unit_id);

create table public.cs_seal_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  kind text not null check (kind in ('apply', 'break', 'verify')),
  seal_no text not null check (length(trim(seal_no)) between 1 and 60),
  prior_seal_no text,
  ok boolean,                          -- verify only: did the number match
  reason text,
  performed_by uuid not null,
  witnessed_by uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, location_id) references public.cs_locations(tenant_id, id),
  foreign key (tenant_id, performed_by) references public.members(tenant_id, id),
  foreign key (tenant_id, witnessed_by) references public.members(tenant_id, id),
  check (kind <> 'break' or (length(trim(coalesce(reason, ''))) >= 5 and witnessed_by is not null and witnessed_by <> performed_by))
);
create index cs_seal_events_location_idx on public.cs_seal_events (tenant_id, location_id, occurred_at);
-- A seal number is applied once, ever.
create unique index cs_seal_apply_once on public.cs_seal_events (tenant_id, seal_no) where kind = 'apply';

create trigger forbid_mutation before update or delete on public.cs_seal_events
  for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.cs_seal_events
  for each statement execute function app.forbid_mutation();

revoke insert, update, delete, truncate on public.cs_items, public.cs_lots, public.cs_locations, public.cs_seal_events from authenticated, anon;

alter table public.cs_items enable row level security;
alter table public.cs_lots enable row level security;
alter table public.cs_locations enable row level security;
alter table public.cs_seal_events enable row level security;

create policy cs_item_read on public.cs_items for select to authenticated
  using (tenant_id = app.tenant_id() and app.cs_has_any());
create policy cs_lot_read on public.cs_lots for select to authenticated
  using (tenant_id = app.tenant_id() and app.cs_has_any());
create policy cs_location_read on public.cs_locations for select to authenticated
  using (tenant_id = app.tenant_id() and app.cs_can_read(org_unit_id));
create policy cs_seal_read on public.cs_seal_events for select to authenticated
  using (tenant_id = app.tenant_id() and app.cs_can_read((select l.org_unit_id from public.cs_locations l where l.id = location_id)));

create trigger audit after insert or update or delete on public.cs_items for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.cs_lots for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.cs_locations for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.cs_seal_events for each row execute function app.audit_trigger();

-- The org unit of a custody location (null when it does not exist in this department).
create or replace function app.cs_unit_of(p_location uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select l.org_unit_id from public.cs_locations l where l.id = p_location and l.tenant_id = app.tenant_id()
$$;
revoke execute on function app.cs_unit_of(uuid) from public, anon;
grant execute on function app.cs_unit_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- catalog functions
create or replace function app.create_cs_item(p_name text, p_schedule text, p_ndc text, p_unit text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_sched text := nullif(trim(coalesce(p_schedule, '')), '');
  v_ndc text := nullif(trim(coalesce(p_ndc, '')), '');
  v_id uuid;
begin
  if not app.has_permission_dept('custody.manage') then raise exception 'not allowed: custody.manage required'; end if;
  if v_name is null then raise exception 'Enter the medication name'; end if;
  if v_sched is null then raise exception 'Enter the schedule (for example II)'; end if;
  if p_unit is null or p_unit not in ('mg', 'mcg', 'g', 'mL', 'each') then raise exception 'Unknown unit: choose mg, mcg, g, mL or each'; end if;
  if exists (select 1 from public.cs_items i where i.tenant_id = v_tenant and lower(i.name) = lower(v_name) and coalesce(i.ndc, '') = coalesce(v_ndc, '')) then
    raise exception 'That medication already exists';
  end if;
  insert into public.cs_items (tenant_id, name, schedule, ndc, unit, strength_note)
  values (v_tenant, v_name, v_sched, v_ndc, p_unit, nullif(trim(coalesce(p_note, '')), '')) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.create_cs_item(text, text, text, text, text) from public, anon;
grant execute on function app.create_cs_item(text, text, text, text, text) to authenticated;

create or replace function app.create_cs_lot(p_item uuid, p_lot_no text, p_expires_on date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_no text := nullif(trim(coalesce(p_lot_no, '')), '');
  v_id uuid;
begin
  if not app.has_permission_dept('custody.manage') then raise exception 'not allowed: custody.manage required'; end if;
  if v_no is null then raise exception 'Enter the lot number'; end if;
  if p_expires_on is null then raise exception 'Enter the expiration date'; end if;
  if not exists (select 1 from public.cs_items i where i.id = p_item and i.tenant_id = v_tenant and i.archived_at is null) then
    raise exception 'Unknown medication';
  end if;
  if exists (select 1 from public.cs_lots l where l.tenant_id = v_tenant and l.item_id = p_item and l.lot_no = v_no) then
    raise exception 'That lot already exists';
  end if;
  insert into public.cs_lots (tenant_id, item_id, lot_no, expires_on) values (v_tenant, p_item, v_no, p_expires_on) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.create_cs_lot(uuid, text, date) from public, anon;
grant execute on function app.create_cs_lot(uuid, text, date) to authenticated;

create or replace function app.flag_cs_lot_recall(p_lot uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_lot public.cs_lots;
begin
  if not app.has_permission_dept('custody.manage') then raise exception 'not allowed: custody.manage required'; end if;
  if length(coalesce(v_note, '')) < 5 then raise exception 'explain the recall (at least 5 characters)'; end if;
  select * into v_lot from public.cs_lots where id = p_lot and tenant_id = app.tenant_id() for update;
  if v_lot.id is null then raise exception 'Unknown lot'; end if;
  if v_lot.recalled_at is not null then raise exception 'That lot is already recalled'; end if;
  update public.cs_lots set recalled_at = now(), recall_note = v_note where id = v_lot.id;
end $$;
revoke execute on function app.flag_cs_lot_recall(uuid, text) from public, anon;
grant execute on function app.flag_cs_lot_recall(uuid, text) to authenticated;

create or replace function app.create_cs_location(p_name text, p_kind text, p_org_unit uuid, p_member uuid, p_stock_location uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if p_org_unit is null or not exists (select 1 from public.org_units o where o.id = p_org_unit and o.tenant_id = v_tenant) then
    raise exception 'Unknown unit';
  end if;
  if not app.has_permission_unit('custody.manage', p_org_unit) then raise exception 'not allowed: you cannot add locations here'; end if;
  if v_name is null then raise exception 'Enter a name for the location'; end if;
  if p_kind is null or p_kind not in ('vault', 'station', 'unit', 'drug_box', 'member') then raise exception 'Unknown location kind'; end if;
  if p_kind = 'member' and p_member is null then raise exception 'A member location needs a member'; end if;
  if p_kind <> 'member' and p_member is not null then raise exception 'Only a member location can name a member'; end if;
  if p_member is not null and not exists (select 1 from public.members m where m.id = p_member and m.tenant_id = v_tenant) then
    raise exception 'Unknown member';
  end if;
  if p_stock_location is not null and not exists (select 1 from public.stock_locations s where s.id = p_stock_location and s.tenant_id = v_tenant) then
    raise exception 'Unknown stock location';
  end if;
  insert into public.cs_locations (tenant_id, name, kind, org_unit_id, member_id, stock_location_id)
  values (v_tenant, v_name, p_kind, p_org_unit, p_member, p_stock_location) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.create_cs_location(text, text, uuid, uuid, uuid) from public, anon;
grant execute on function app.create_cs_location(text, text, uuid, uuid, uuid) to authenticated;

-- Archiving never deletes; a location or lot that still holds stock cannot be archived (the ledger table
-- exists after the next migration, so the balance check lives in app.cs_on_hand_total).
create or replace function app.cs_total_at(p_location uuid, p_lot uuid) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare v numeric;
begin
  if to_regclass('public.cs_ledger') is null then return 0; end if;
  execute 'select coalesce(sum(delta), 0) from public.cs_ledger where tenant_id = $1 and ($2::uuid is null or location_id = $2) and ($3::uuid is null or lot_id = $3)'
    into v using app.tenant_id(), p_location, p_lot;
  return v;
end $$;
revoke execute on function app.cs_total_at(uuid, uuid) from public, anon, authenticated;

create or replace function app.archive_cs_location(p_location uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_loc public.cs_locations;
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id() for update;
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.manage', v_loc.org_unit_id) then raise exception 'not allowed: you cannot archive this location'; end if;
  if app.cs_total_at(v_loc.id, null) <> 0 then raise exception 'That location still holds stock; transfer or adjust it first'; end if;
  update public.cs_locations set archived_at = coalesce(archived_at, now()) where id = v_loc.id;
end $$;
revoke execute on function app.archive_cs_location(uuid) from public, anon;
grant execute on function app.archive_cs_location(uuid) to authenticated;

create or replace function app.archive_cs_lot(p_lot uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_permission_dept('custody.manage') then raise exception 'not allowed: custody.manage required'; end if;
  if not exists (select 1 from public.cs_lots l where l.id = p_lot and l.tenant_id = app.tenant_id()) then raise exception 'Unknown lot'; end if;
  if app.cs_total_at(null, p_lot) <> 0 then raise exception 'That lot still holds stock; transfer or adjust it first'; end if;
  update public.cs_lots set archived_at = coalesce(archived_at, now()) where id = p_lot;
end $$;
revoke execute on function app.archive_cs_lot(uuid) from public, anon;
grant execute on function app.archive_cs_lot(uuid) to authenticated;

create or replace function app.archive_cs_item(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_permission_dept('custody.manage') then raise exception 'not allowed: custody.manage required'; end if;
  if not exists (select 1 from public.cs_items i where i.id = p_item and i.tenant_id = app.tenant_id()) then raise exception 'Unknown medication'; end if;
  if exists (select 1 from public.cs_lots l where l.item_id = p_item and l.archived_at is null) then raise exception 'Archive its lots first'; end if;
  update public.cs_items set archived_at = coalesce(archived_at, now()) where id = p_item;
end $$;
revoke execute on function app.archive_cs_item(uuid) from public, anon;
grant execute on function app.archive_cs_item(uuid) to authenticated;

-- ---------------------------------------------------------------- seals
-- Apply a seal to a drug box that has none. A seal number is never reused.
create or replace function app.apply_cs_seal(p_location uuid, p_seal_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loc public.cs_locations;
  v_no text := nullif(trim(coalesce(p_seal_no, '')), '');
  v_me uuid := app.my_member_id();
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id() for update;
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if not (app.has_permission_unit('custody.record', v_loc.org_unit_id) or app.has_permission_unit('custody.manage', v_loc.org_unit_id)) then
    raise exception 'not allowed: you cannot seal boxes here';
  end if;
  if v_me is null then raise exception 'not a member of this department'; end if;
  if v_loc.kind <> 'drug_box' then raise exception 'Only a drug box can be sealed'; end if;
  if v_loc.archived_at is not null then raise exception 'That location is archived'; end if;
  if v_no is null then raise exception 'Enter the seal number'; end if;
  if v_loc.current_seal_no is not null then raise exception 'That box already has a seal; break it first'; end if;
  if exists (select 1 from public.cs_seal_events e where e.tenant_id = v_loc.tenant_id and e.seal_no = v_no and e.kind = 'apply') then
    raise exception 'That seal number has already been used';
  end if;
  insert into public.cs_seal_events (tenant_id, location_id, kind, seal_no, performed_by) values (v_loc.tenant_id, v_loc.id, 'apply', v_no, v_me);
  update public.cs_locations set current_seal_no = v_no where id = v_loc.id;
end $$;
revoke execute on function app.apply_cs_seal(uuid, text) from public, anon;
grant execute on function app.apply_cs_seal(uuid, text) to authenticated;

-- Check a seal number against the box's current seal. The result is stored either way and returned.
create or replace function app.verify_cs_seal(p_location uuid, p_seal_no text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_loc public.cs_locations;
  v_no text := nullif(trim(coalesce(p_seal_no, '')), '');
  v_me uuid := app.my_member_id();
  v_ok boolean;
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id();
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.record', v_loc.org_unit_id) then raise exception 'not allowed: you cannot check seals here'; end if;
  if v_me is null then raise exception 'not a member of this department'; end if;
  if v_no is null then raise exception 'Enter the seal number you see'; end if;
  v_ok := v_loc.current_seal_no is not null and v_loc.current_seal_no = v_no;
  insert into public.cs_seal_events (tenant_id, location_id, kind, seal_no, prior_seal_no, ok, performed_by)
  values (v_loc.tenant_id, v_loc.id, 'verify', v_no, v_loc.current_seal_no, v_ok, v_me);
  return v_ok;
end $$;
revoke execute on function app.verify_cs_seal(uuid, text) from public, anon;
grant execute on function app.verify_cs_seal(uuid, text) to authenticated;
