-- Assets: customizable asset types, assets with status and location (an org unit), and an append-only
-- event log. Reads are department-wide for holders of inventory.asset.view; every write goes through
-- the functions below, which check scope at the asset's org unit.

alter table public.custom_field_defs drop constraint custom_field_defs_entity_check;
alter table public.custom_field_defs add constraint custom_field_defs_entity_check
  check (entity in ('member', 'org_unit', 'asset'));

-- Insert-only tables raise on any update, delete or truncate, even for the table owner.
create or replace function app.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, lower(tg_op);
end $$;

-- The permission, at an org unit (null unit = department-wide permission needed).
create or replace function app.has_permission_unit(p_perm text, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_unit is null then app.has_permission_dept(p_perm) else app.has_permission_at(p_perm, p_unit) end
$$;
revoke execute on function app.has_permission_unit(text, uuid) from public, anon;
grant execute on function app.has_permission_unit(text, uuid) to authenticated, service_role;

create table public.asset_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  category text not null default 'equipment' check (category in ('apparatus', 'equipment', 'medical_device', 'ppe', 'other')),
  archived_at timestamptz,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  identifier text check (identifier is null or length(identifier) between 1 and 80),
  status text not null default 'in_service' check (status in ('in_service', 'out_of_service', 'reserve', 'maintenance', 'retired')),
  org_unit_id uuid,
  custom jsonb not null default '{}' check (jsonb_typeof(custom) = 'object'),
  in_service_date date,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, type_id) references public.asset_types(tenant_id, id),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id)
);
create unique index assets_identifier_key on public.assets (tenant_id, identifier) where identifier is not null;
create index assets_unit_idx on public.assets (tenant_id, org_unit_id);

create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  kind text not null check (kind in ('check', 'maintenance', 'status_change', 'assignment', 'note')),
  occurred_at timestamptz not null default clock_timestamp(),
  performed_by uuid default auth.uid() references auth.users(id) on delete set null,
  from_status text,
  to_status text,
  from_org_unit_id uuid,
  to_org_unit_id uuid,
  note text,
  data jsonb not null default '{}',
  foreign key (tenant_id, asset_id) references public.assets(tenant_id, id)
);
create index asset_events_asset_idx on public.asset_events (tenant_id, asset_id, occurred_at desc);

create trigger forbid_mutation before update or delete on public.asset_events
  for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.asset_events
  for each statement execute function app.forbid_mutation();

revoke insert, update, delete, truncate on public.assets, public.asset_events from authenticated, anon;
revoke delete, truncate on public.asset_types from authenticated, anon;

alter table public.asset_types enable row level security;
alter table public.assets enable row level security;
alter table public.asset_events enable row level security;

create policy tenant_read on public.asset_types for select to authenticated using (tenant_id = app.tenant_id());
create policy tenant_write on public.asset_types for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('inventory.asset.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission_dept('inventory.asset.manage'));
create policy asset_read on public.assets for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('inventory.asset.view'));
create policy asset_event_read on public.asset_events for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('inventory.asset.view'));

create trigger audit after insert or update or delete on public.asset_types for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.assets for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.asset_events for each row execute function app.audit_trigger();

-- Custom values must use known, unarchived fields of the 'asset' registry and include every required one.
create or replace function app.check_asset_custom(p_custom jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_key text; v_def record;
begin
  if jsonb_typeof(p_custom) is distinct from 'object' then raise exception 'custom fields must be an object'; end if;
  for v_key in select jsonb_object_keys(p_custom) loop
    if not exists (select 1 from public.custom_field_defs d
                   where d.tenant_id = app.tenant_id() and d.entity = 'asset' and d.key = v_key and d.archived_at is null) then
      raise exception 'Unknown asset field: %', v_key;
    end if;
  end loop;
  for v_def in select d.key, d.label from public.custom_field_defs d
               where d.tenant_id = app.tenant_id() and d.entity = 'asset' and d.required and d.archived_at is null loop
    if p_custom -> v_def.key is null or p_custom ->> v_def.key = '' then
      raise exception 'Missing required asset field: %', v_def.label;
    end if;
  end loop;
end $$;
revoke execute on function app.check_asset_custom(jsonb) from public, anon, authenticated;

create or replace function app.create_asset(p_type uuid, p_name text, p_identifier text, p_org_unit uuid, p_custom jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_ident text := nullif(trim(coalesce(p_identifier, '')), '');
  v_custom jsonb := coalesce(p_custom, '{}'::jsonb);
  v_id uuid;
begin
  if not app.has_permission_unit('inventory.asset.manage', p_org_unit) then raise exception 'not allowed: you cannot add assets at this location'; end if;
  if v_name is null then raise exception 'Enter a name for the asset'; end if;
  if not exists (select 1 from public.asset_types t where t.id = p_type and t.tenant_id = v_tenant and t.archived_at is null) then
    raise exception 'Unknown or archived asset type';
  end if;
  if p_org_unit is not null and not exists (select 1 from public.org_units o where o.id = p_org_unit and o.tenant_id = v_tenant) then
    raise exception 'Unknown location';
  end if;
  perform app.check_asset_custom(v_custom);
  insert into public.assets (tenant_id, type_id, name, identifier, org_unit_id, custom)
  values (v_tenant, p_type, v_name, v_ident, p_org_unit, v_custom) returning id into v_id;
  insert into public.asset_events (tenant_id, asset_id, kind, to_status, to_org_unit_id, note)
  values (v_tenant, v_id, 'note', 'in_service', p_org_unit, 'Asset added');
  return v_id;
end $$;
revoke execute on function app.create_asset(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function app.create_asset(uuid, text, text, uuid, jsonb) to authenticated;

-- Log an event. status_change and assignment (a move) also change the asset in the same transaction.
create or replace function app.record_asset_event(p_asset uuid, p_kind text, p_to_status text, p_to_org_unit uuid, p_note text, p_data jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_a public.assets;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  select * into v_a from public.assets where id = p_asset and tenant_id = app.tenant_id() for update;
  if v_a.id is null then raise exception 'Unknown asset'; end if;
  if p_kind not in ('check', 'maintenance', 'status_change', 'assignment', 'note') then raise exception 'Unknown event type'; end if;
  if not app.has_permission_unit('inventory.asset.event', v_a.org_unit_id) then raise exception 'not allowed: you cannot log events for this asset'; end if;
  if v_a.status = 'retired' and p_kind <> 'note' then raise exception 'This asset is retired; only notes can be added'; end if;
  if v_a.archived_at is not null then raise exception 'This asset is archived'; end if;

  if p_kind = 'status_change' then
    if p_to_status is null or p_to_status not in ('in_service', 'out_of_service', 'reserve', 'maintenance', 'retired') then
      raise exception 'Choose a status';
    end if;
    if p_to_status = v_a.status then raise exception 'The asset is already %', replace(p_to_status, '_', ' '); end if;
    if p_to_status in ('out_of_service', 'retired') and length(coalesce(v_note, '')) < 5 then
      raise exception 'Explain why (at least 5 characters)';
    end if;
    update public.assets set status = p_to_status where id = v_a.id;
  elsif p_kind = 'assignment' then
    if p_to_org_unit is null then raise exception 'Choose the new location'; end if;
    if p_to_org_unit is not distinct from v_a.org_unit_id then raise exception 'The asset is already at that location'; end if;
    if not exists (select 1 from public.org_units o where o.id = p_to_org_unit and o.tenant_id = app.tenant_id()) then raise exception 'Unknown location'; end if;
    if not app.has_permission_unit('inventory.asset.event', p_to_org_unit) then raise exception 'not allowed: you cannot move assets to that location'; end if;
    update public.assets set org_unit_id = p_to_org_unit where id = v_a.id;
  elsif p_kind in ('note', 'maintenance') and v_note is null then
    raise exception 'Add a note';
  end if;

  insert into public.asset_events (tenant_id, asset_id, kind, from_status, to_status, from_org_unit_id, to_org_unit_id, note, data)
  values (app.tenant_id(), v_a.id, p_kind,
          case when p_kind = 'status_change' then v_a.status end, case when p_kind = 'status_change' then p_to_status end,
          case when p_kind = 'assignment' then v_a.org_unit_id end, case when p_kind = 'assignment' then p_to_org_unit end,
          v_note, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.record_asset_event(uuid, text, text, uuid, text, jsonb) from public, anon;
grant execute on function app.record_asset_event(uuid, text, text, uuid, text, jsonb) to authenticated;

create or replace function app.archive_asset(p_asset uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.assets; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_a from public.assets where id = p_asset and tenant_id = app.tenant_id() for update;
  if v_a.id is null then raise exception 'Unknown asset'; end if;
  if not app.has_permission_unit('inventory.asset.manage', v_a.org_unit_id) then raise exception 'not allowed: you cannot archive this asset'; end if;
  if v_a.status <> 'retired' then raise exception 'Retire the asset before archiving it'; end if;
  if v_a.archived_at is not null then raise exception 'This asset is already archived'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'Explain why (at least 5 characters)'; end if;
  update public.assets set archived_at = now() where id = v_a.id;
  insert into public.asset_events (tenant_id, asset_id, kind, note) values (app.tenant_id(), v_a.id, 'note', 'Archived: ' || v_reason);
end $$;
revoke execute on function app.archive_asset(uuid, text) from public, anon;
grant execute on function app.archive_asset(uuid, text) to authenticated;
