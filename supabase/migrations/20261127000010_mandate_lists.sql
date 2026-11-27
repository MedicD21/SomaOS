-- Mandate lists: an ordered rotation of members used when staffing falls below the department
-- minimum. Officers reorder, exempt, skip and remove members (each with a reason); recording a
-- mandate creates the overtime shift and moves the member to the bottom. Every change is logged
-- in mandate_events (append-only) and audited. Writes only through the functions below, which
-- check scope in SQL.

create table public.mandate_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index mandate_lists_name_key on public.mandate_lists (tenant_id, lower(name)) where status = 'active';

create table public.mandate_list_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  list_id uuid not null,
  member_id uuid not null,
  -- Dense 1..n among active entries; kept so by the functions below.
  position int not null check (position > 0),
  exempt_reason text check (exempt_reason is null or length(exempt_reason) >= 5),
  exempt_until date,
  status text not null default 'active' check (status in ('active', 'removed')),
  added_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, list_id) references public.mandate_lists(tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  constraint mandate_entries_exempt_shape check (exempt_until is null or exempt_reason is not null)
);
create unique index mandate_list_entries_one_active on public.mandate_list_entries (list_id, member_id) where status = 'active';
create index mandate_list_entries_list_idx on public.mandate_list_entries (tenant_id, list_id, status, position);

create table public.mandate_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  list_id uuid not null,
  -- Null for list-wide events (reordered).
  member_id uuid,
  kind text not null check (kind in ('added', 'removed', 'reordered', 'exempted', 'unexempted', 'skipped', 'mandated')),
  reason text,
  on_date date,
  assignment_id uuid,
  data jsonb not null default '{}',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  -- clock_timestamp keeps events in order within one transaction.
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  foreign key (tenant_id, list_id) references public.mandate_lists(tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignment_id) references public.shift_assignments(tenant_id, id)
);
create index mandate_events_list_idx on public.mandate_events (tenant_id, list_id, created_at desc);
create index mandate_events_date_idx on public.mandate_events (tenant_id, on_date) where on_date is not null;

revoke insert, update, delete, truncate on public.mandate_lists, public.mandate_list_entries, public.mandate_events
  from authenticated, anon;

alter table public.mandate_lists enable row level security;
alter table public.mandate_list_entries enable row level security;
alter table public.mandate_events enable row level security;

-- Transparent to anyone who can see the roster.
do $$
declare t text;
begin
  foreach t in array array['mandate_lists', 'mandate_list_entries', 'mandate_events'] loop
    execute format('create policy tenant_read on public.%I for select to authenticated
                    using (tenant_id = app.tenant_id()
                           and (app.has_permission(%L) or app.has_permission(%L)))',
                   t, 'scheduling.roster.view', 'scheduling.mandate.manage');
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- Shared checks -----------------------------------------------------------------------------

create or replace function app.mandate_require_manage() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission_dept('scheduling.mandate.manage') then
    raise exception 'not allowed: department-wide scheduling.mandate.manage required';
  end if;
end $$;
revoke execute on function app.mandate_require_manage() from public, anon, authenticated;

create or replace function app.mandate_require_list(p_list uuid) returns public.mandate_lists
language plpgsql security definer set search_path = '' as $$
declare v_l public.mandate_lists;
begin
  select * into v_l from public.mandate_lists
  where id = p_list and tenant_id = app.tenant_id() and status = 'active' for update;
  if v_l.id is null then raise exception 'unknown mandate list'; end if;
  return v_l;
end $$;
revoke execute on function app.mandate_require_list(uuid) from public, anon, authenticated;

create or replace function app.mandate_require_reason(p_reason text, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if length(coalesce(v, '')) < 5 then raise exception 'explain the % (at least 5 characters)', p_what; end if;
  if length(v) > 500 then raise exception 'keep the reason under 500 characters'; end if;
  return v;
end $$;
revoke execute on function app.mandate_require_reason(text, text) from public, anon, authenticated;

create or replace function app.mandate_active_entry(p_list uuid, p_member uuid) returns public.mandate_list_entries
language plpgsql security definer set search_path = '' as $$
declare v_e public.mandate_list_entries;
begin
  select * into v_e from public.mandate_list_entries
  where list_id = p_list and member_id = p_member and status = 'active' for update;
  if v_e.id is null then raise exception 'That member is not on this list'; end if;
  return v_e;
end $$;
revoke execute on function app.mandate_active_entry(uuid, uuid) from public, anon, authenticated;

-- Renumbers active entries 1..n, keeping their order.
create or replace function app.mandate_renumber(p_list uuid) returns void
language sql security definer set search_path = '' as $$
  update public.mandate_list_entries e set position = r.rn
  from (select id, row_number() over (order by position, added_at, id) as rn
        from public.mandate_list_entries where list_id = p_list and status = 'active') r
  where e.id = r.id and e.position <> r.rn
$$;
revoke execute on function app.mandate_renumber(uuid) from public, anon, authenticated;

-- List functions ----------------------------------------------------------------------------

create or replace function app.create_mandate_list(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  perform app.mandate_require_manage();
  if length(coalesce(v_name, '')) < 2 or length(v_name) > 80 then raise exception 'Name the list (2 to 80 characters)'; end if;
  if exists (select 1 from public.mandate_lists where tenant_id = app.tenant_id() and status = 'active' and lower(name) = lower(v_name)) then
    raise exception 'A list with that name already exists';
  end if;
  insert into public.mandate_lists (tenant_id, name) values (app.tenant_id(), v_name) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.create_mandate_list(text) from public, anon;
grant execute on function app.create_mandate_list(text) to authenticated;

create or replace function app.mandate_add(p_list uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l public.mandate_lists;
begin
  perform app.mandate_require_manage();
  v_l := app.mandate_require_list(p_list);
  if not exists (select 1 from public.members m where m.id = p_member and m.tenant_id = v_l.tenant_id and m.status <> 'separated') then
    raise exception 'unknown member';
  end if;
  if exists (select 1 from public.mandate_list_entries where list_id = v_l.id and member_id = p_member and status = 'active') then
    raise exception 'That member is already on this list';
  end if;
  insert into public.mandate_list_entries (tenant_id, list_id, member_id, position)
  values (v_l.tenant_id, v_l.id, p_member,
          coalesce((select max(position) from public.mandate_list_entries where list_id = v_l.id and status = 'active'), 0) + 1);
  insert into public.mandate_events (tenant_id, list_id, member_id, kind) values (v_l.tenant_id, v_l.id, p_member, 'added');
end $$;
revoke execute on function app.mandate_add(uuid, uuid) from public, anon;
grant execute on function app.mandate_add(uuid, uuid) to authenticated;

create or replace function app.mandate_remove(p_list uuid, p_member uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.mandate_lists;
  v_e public.mandate_list_entries;
  v_reason text;
begin
  perform app.mandate_require_manage();
  v_l := app.mandate_require_list(p_list);
  v_reason := app.mandate_require_reason(p_reason, 'removal');
  v_e := app.mandate_active_entry(v_l.id, p_member);
  update public.mandate_list_entries set status = 'removed' where id = v_e.id;
  perform app.mandate_renumber(v_l.id);
  insert into public.mandate_events (tenant_id, list_id, member_id, kind, reason)
  values (v_l.tenant_id, v_l.id, p_member, 'removed', v_reason);
end $$;
revoke execute on function app.mandate_remove(uuid, uuid, text) from public, anon;
grant execute on function app.mandate_remove(uuid, uuid, text) to authenticated;

-- p_members must be exactly the active members, in the new order.
create or replace function app.mandate_reorder(p_list uuid, p_members uuid[], p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.mandate_lists;
  v_reason text;
  v_active uuid[];
begin
  perform app.mandate_require_manage();
  v_l := app.mandate_require_list(p_list);
  v_reason := app.mandate_require_reason(p_reason, 'new order');
  select coalesce(array_agg(member_id order by position), '{}') into v_active
  from public.mandate_list_entries where list_id = v_l.id and status = 'active';
  if p_members is null
     or cardinality(p_members) <> cardinality(v_active)
     or (select count(distinct x) from unnest(p_members) x) <> cardinality(v_active)
     or not (p_members <@ v_active) then
    raise exception 'The new order must list exactly the members on the list, once each';
  end if;
  update public.mandate_list_entries e set position = o.n
  from unnest(p_members) with ordinality as o(member_id, n)
  where e.list_id = v_l.id and e.status = 'active' and e.member_id = o.member_id;
  insert into public.mandate_events (tenant_id, list_id, kind, reason, data)
  values (v_l.tenant_id, v_l.id, 'reordered', v_reason,
          jsonb_build_object('before', to_jsonb(v_active), 'after', to_jsonb(p_members)));
end $$;
revoke execute on function app.mandate_reorder(uuid, uuid[], text) from public, anon;
grant execute on function app.mandate_reorder(uuid, uuid[], text) to authenticated;

-- A null reason clears the exemption. An exemption keeps the member's position.
create or replace function app.mandate_set_exempt(p_list uuid, p_member uuid, p_reason text, p_until date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.mandate_lists;
  v_e public.mandate_list_entries;
  v_reason text;
begin
  perform app.mandate_require_manage();
  v_l := app.mandate_require_list(p_list);
  v_e := app.mandate_active_entry(v_l.id, p_member);
  if p_reason is null then
    if v_e.exempt_reason is null then raise exception 'That member is not exempt'; end if;
    update public.mandate_list_entries set exempt_reason = null, exempt_until = null where id = v_e.id;
    insert into public.mandate_events (tenant_id, list_id, member_id, kind, data)
    values (v_l.tenant_id, v_l.id, p_member, 'unexempted', jsonb_build_object('was', v_e.exempt_reason));
    return;
  end if;
  v_reason := app.mandate_require_reason(p_reason, 'exemption');
  update public.mandate_list_entries set exempt_reason = v_reason, exempt_until = p_until where id = v_e.id;
  insert into public.mandate_events (tenant_id, list_id, member_id, kind, reason, data)
  values (v_l.tenant_id, v_l.id, p_member, 'exempted', v_reason, jsonb_build_object('until', p_until));
end $$;
revoke execute on function app.mandate_set_exempt(uuid, uuid, text, date) from public, anon;
grant execute on function app.mandate_set_exempt(uuid, uuid, text, date) to authenticated;

-- Passes a member over for one date; their position is kept.
create or replace function app.mandate_skip(p_list uuid, p_member uuid, p_reason text, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_l public.mandate_lists;
  v_reason text;
begin
  perform app.mandate_require_manage();
  v_l := app.mandate_require_list(p_list);
  v_reason := app.mandate_require_reason(p_reason, 'skip');
  if p_on is null then raise exception 'Choose the date the member is skipped for'; end if;
  perform app.mandate_active_entry(v_l.id, p_member);
  insert into public.mandate_events (tenant_id, list_id, member_id, kind, reason, on_date)
  values (v_l.tenant_id, v_l.id, p_member, 'skipped', v_reason, p_on);
end $$;
revoke execute on function app.mandate_skip(uuid, uuid, text, date) from public, anon;
grant execute on function app.mandate_skip(uuid, uuid, text, date) to authenticated;

-- Records a mandate: creates the overtime shift on the seat, moves the member to the bottom of
-- the list, logs it and notifies the member. Needs list rights and roster edit at the seat's
-- unit; p_override waives a qualification block (checked by the web layer) and needs
-- scheduling.qualification.override there. The roster's overlap constraints refuse a double-booking.
create or replace function app.mandate_record(p_list uuid, p_member uuid, p_seat uuid, p_start timestamptz, p_end timestamptz,
                                              p_reason text, p_override text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_l public.mandate_lists;
  v_e public.mandate_list_entries;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_override text := nullif(trim(coalesce(p_override, '')), '');
  v_during tstzrange;
  v_tz text;
  v_asg uuid;
begin
  perform app.mandate_require_manage();
  v_l := app.mandate_require_list(p_list);
  v_e := app.mandate_active_entry(v_l.id, p_member);
  if not app.can_write_assignment('scheduling.roster.edit', p_seat) then
    raise exception 'not in your scope: mandating needs roster edit at that station';
  end if;
  select coalesce(ou.timezone, t.timezone) into v_tz
  from public.seats s join public.org_units ou on ou.id = s.org_unit_id join public.tenants t on t.id = s.tenant_id
  where s.id = p_seat and s.tenant_id = v_l.tenant_id and s.status = 'active';
  if v_tz is null then raise exception 'That seat is not available'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'The end must be after the start'; end if;
  if p_start <= now() then raise exception 'Only upcoming times can be mandated'; end if;
  if p_end - p_start > interval '48 hours' then raise exception 'A mandated shift can be at most 48 hours'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'keep the reason under 500 characters'; end if;
  if v_override is not null then
    if length(v_override) < 5 then raise exception 'an override reason of at least 5 characters is required'; end if;
    if not app.can_write_assignment('scheduling.qualification.override', p_seat) then
      raise exception 'not in your scope: overriding needs qualification override at the station';
    end if;
  end if;
  if exists (select 1 from public.members m where m.id = p_member
             and (m.status = 'separated' or m.separated_on <= (p_start at time zone v_tz)::date)) then
    raise exception 'That member has separated from the department';
  end if;
  v_during := tstzrange(p_start, p_end);
  if exists (select 1 from public.shift_assignments a where a.member_id = p_member and a.status = 'scheduled'
             and a.type <> 'kelly' and a.during && v_during) then
    raise exception 'That member is already scheduled during that time';
  end if;
  if exists (select 1 from public.shift_assignments a where a.seat_id = p_seat and a.status = 'scheduled' and a.during && v_during) then
    raise exception 'That seat is already filled for that time';
  end if;

  insert into public.shift_assignments (tenant_id, member_id, seat_id, during, type, source, override_reason, explain)
  values (v_l.tenant_id, p_member, p_seat, v_during, 'overtime', 'manual', v_override,
          jsonb_build_array(jsonb_build_object('rule', 'mandate', 'message', 'Mandated from the list ' || v_l.name)))
  returning id into v_asg;

  update public.mandate_list_entries
     set position = (select max(position) from public.mandate_list_entries where list_id = v_l.id and status = 'active') + 1
   where id = v_e.id;
  perform app.mandate_renumber(v_l.id);
  insert into public.mandate_events (tenant_id, list_id, member_id, kind, reason, on_date, assignment_id, data)
  values (v_l.tenant_id, v_l.id, p_member, 'mandated', v_reason, (p_start at time zone v_tz)::date, v_asg,
          jsonb_build_object('seat_id', p_seat, 'override', v_override));
  perform app.notify_internal(p_member, 'mandate', 'You have been mandated',
                              'You were mandated for a shift. It is on your schedule.', '/schedule');
  return v_asg;
end $$;
revoke execute on function app.mandate_record(uuid, uuid, uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function app.mandate_record(uuid, uuid, uuid, timestamptz, timestamptz, text, text) to authenticated;
