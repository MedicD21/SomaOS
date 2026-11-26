-- Controlled substances (Phase 3b), part 3: bound counts, the discrepancy workflow, and expiry / recall views.
-- Expected quantities are read in SQL when a count is submitted; the counter never supplies them.
-- Discrepancies are never deleted or edited: they move through statuses by appending events.

create table public.cs_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  counted_by uuid not null,
  witnessed_by uuid not null,
  counted_at timestamptz not null default clock_timestamp(),
  checklist_completion_id uuid,
  seal_no_seen text,
  seal_ok boolean not null default true,
  note text check (note is null or length(note) <= 500),
  unique (tenant_id, id),
  check (counted_by <> witnessed_by),
  foreign key (tenant_id, location_id) references public.cs_locations(tenant_id, id),
  foreign key (tenant_id, counted_by) references public.members(tenant_id, id),
  foreign key (tenant_id, witnessed_by) references public.members(tenant_id, id)
  -- checklist_completion_id is validated (same tenant, same member, same location) in submit_cs_count; it is not a foreign key
  -- so the 3a completions table keeps its own truncate behaviour.
);
create index cs_counts_location_idx on public.cs_counts (tenant_id, location_id, counted_at desc);

create table public.cs_count_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  count_id uuid not null,
  lot_id uuid not null,
  expected numeric(12,3) not null,
  counted numeric(12,3) not null check (counted >= 0),
  unique (count_id, lot_id),
  foreign key (tenant_id, count_id) references public.cs_counts(tenant_id, id),
  foreign key (tenant_id, lot_id) references public.cs_lots(tenant_id, id)
);

create table public.cs_discrepancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  lot_id uuid,
  kind text not null check (kind in ('quantity', 'seal', 'chain')),
  expected numeric(12,3),
  counted numeric(12,3),
  count_id uuid,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'escalated')),
  opened_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.cs_locations(tenant_id, id),
  foreign key (tenant_id, lot_id) references public.cs_lots(tenant_id, id),
  foreign key (tenant_id, count_id) references public.cs_counts(tenant_id, id)
);
create index cs_discrepancies_open_idx on public.cs_discrepancies (tenant_id, status, opened_at desc);

create table public.cs_discrepancy_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  discrepancy_id uuid not null,
  kind text not null check (kind in ('note', 'investigate', 'escalate', 'resolve')),
  by_member uuid not null,
  note text,
  adjust_ledger_id bigint references public.cs_ledger(id),
  report_ref text check (report_ref is null or length(report_ref) <= 200),    -- free text; nothing is filed externally
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, discrepancy_id) references public.cs_discrepancies(tenant_id, id),
  foreign key (tenant_id, by_member) references public.members(tenant_id, id)
);
create index cs_discrepancy_events_idx on public.cs_discrepancy_events (tenant_id, discrepancy_id, occurred_at);

alter table public.cs_ledger add foreign key (tenant_id, discrepancy_id) references public.cs_discrepancies(tenant_id, id);

-- Counts, lines and events are insert-only.
create trigger forbid_mutation before update or delete on public.cs_counts for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.cs_counts for each statement execute function app.forbid_mutation();
create trigger forbid_mutation before update or delete on public.cs_count_lines for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.cs_count_lines for each statement execute function app.forbid_mutation();
create trigger forbid_mutation before update or delete on public.cs_discrepancy_events for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.cs_discrepancy_events for each statement execute function app.forbid_mutation();

-- A discrepancy is never deleted, and only its status may change.
create or replace function app.cs_discrepancy_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'cs_discrepancies cannot be deleted'; end if;
  if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then raise exception 'cs_discrepancies can only change status'; end if;
  return new;
end $$;
create trigger guard before update or delete on public.cs_discrepancies for each row execute function app.cs_discrepancy_guard();
create trigger guard_truncate before truncate on public.cs_discrepancies for each statement execute function app.cs_discrepancy_guard();

revoke insert, update, delete, truncate on public.cs_counts, public.cs_count_lines, public.cs_discrepancies, public.cs_discrepancy_events from authenticated, anon;

alter table public.cs_counts enable row level security;
alter table public.cs_count_lines enable row level security;
alter table public.cs_discrepancies enable row level security;
alter table public.cs_discrepancy_events enable row level security;

create policy cs_count_read on public.cs_counts for select to authenticated
  using (tenant_id = app.tenant_id() and app.cs_can_read(app.cs_unit_of(location_id)));
create policy cs_count_line_read on public.cs_count_lines for select to authenticated
  using (tenant_id = app.tenant_id() and exists (select 1 from public.cs_counts c where c.id = count_id and app.cs_can_read(app.cs_unit_of(c.location_id))));
create policy cs_discrepancy_read on public.cs_discrepancies for select to authenticated
  using (tenant_id = app.tenant_id() and app.cs_can_read(app.cs_unit_of(location_id)));
create policy cs_discrepancy_event_read on public.cs_discrepancy_events for select to authenticated
  using (tenant_id = app.tenant_id() and exists (select 1 from public.cs_discrepancies d where d.id = discrepancy_id and app.cs_can_read(app.cs_unit_of(d.location_id))));

create trigger audit after insert or update or delete on public.cs_counts for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.cs_count_lines for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.cs_discrepancies for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.cs_discrepancy_events for each row execute function app.audit_trigger();

-- Chain check without a permission test (used inside counts).
create or replace function app.cs_chain_ok(p_location uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_loc public.cs_locations;
  r public.cs_ledger;
  v_prev text := '';
  v_expect bigint := 1;
begin
  select * into v_loc from public.cs_locations where id = p_location;
  for r in select * from public.cs_ledger l where l.location_id = p_location order by l.seq loop
    if r.seq <> v_expect or r.prev_hash <> v_prev
       or r.row_hash <> app.cs_row_hash(r.prev_hash, r.id, r.location_id, r.lot_id, r.delta, r.type, r.performed_by, r.witnessed_by,
                                        r.reference, r.reason, r.occurred_at, r.seq) then
      return false;
    end if;
    v_prev := r.row_hash;
    v_expect := v_expect + 1;
  end loop;
  return v_loc.chain_head = v_prev and v_loc.chain_seq = v_expect - 1;
end $$;
revoke execute on function app.cs_chain_ok(uuid) from public, anon, authenticated;

-- The sheet a counter fills in: the lots held here, without their expected quantities (the count is blind).
create or replace function app.cs_count_sheet(p_location uuid)
returns table (lot_id uuid, item_name text, unit text, lot_no text, expires_on date)
language plpgsql stable security definer set search_path = '' as $$
declare v_unit uuid := app.cs_unit_of(p_location);
begin
  if v_unit is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.record', v_unit) then raise exception 'not allowed: you cannot count here'; end if;
  return query
    select l.id, i.name, i.unit, l.lot_no, l.expires_on
    from public.cs_lots l join public.cs_items i on i.id = l.item_id
    where l.tenant_id = app.tenant_id()
      and (select coalesce(sum(g.delta), 0) from public.cs_ledger g where g.location_id = p_location and g.lot_id = l.id) <> 0
    order by i.name, l.lot_no;
end $$;
revoke execute on function app.cs_count_sheet(uuid) from public, anon;
grant execute on function app.cs_count_sheet(uuid) to authenticated;

-- Submit a witnessed, blind count. p_lines is [{lot_id, counted}] and must cover every lot held at the location.
create or replace function app.submit_cs_count(p_location uuid, p_lines jsonb, p_seal_no text, p_completion uuid, p_witness_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_loc public.cs_locations;
  v_seal text := nullif(trim(coalesce(p_seal_no, '')), '');
  v_wit uuid;
  v_count uuid;
  v_line jsonb;
  v_lot uuid;
  v_counted numeric;
  v_expected numeric;
  v_seal_ok boolean := true;
  v_seen uuid[] := '{}';
  v_missing int;
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id() for update;
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.record', v_loc.org_unit_id) then raise exception 'not allowed: you cannot count here'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'Enter a count for every lot'; end if;
  if v_loc.current_seal_no is not null then
    if v_seal is null then raise exception 'Enter the seal number you see on the box'; end if;
    v_seal_ok := v_seal = v_loc.current_seal_no;
  end if;
  if p_completion is not null and not exists (
    select 1 from public.checklist_completions c
    where c.id = p_completion and c.tenant_id = app.tenant_id() and c.completed_by = v_me
      and (c.org_unit_id = v_loc.org_unit_id or (c.stock_location_id is not null and c.stock_location_id = v_loc.stock_location_id))) then
    raise exception 'That checklist was not completed by you at this location';
  end if;

  v_wit := app.cs_consume_witness(p_witness_request, 'count',
    jsonb_build_object('location', p_location, 'lines', p_lines, 'seal', v_seal), p_location);

  insert into public.cs_counts (tenant_id, location_id, counted_by, witnessed_by, checklist_completion_id, seal_no_seen, seal_ok)
  values (v_loc.tenant_id, v_loc.id, v_me, v_wit, p_completion, v_seal, v_seal_ok) returning id into v_count;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      v_lot := (v_line ->> 'lot_id')::uuid;
      v_counted := (v_line ->> 'counted')::numeric;
    exception when others then
      raise exception 'Each line needs a lot and a counted quantity';
    end;
    if v_counted is null or v_counted < 0 or v_counted <> round(v_counted, 3) then raise exception 'Enter a counted quantity of zero or more (3 decimals at most)'; end if;
    if v_lot = any (v_seen) then raise exception 'Each lot can be counted only once'; end if;
    if not exists (select 1 from public.cs_lots l where l.id = v_lot and l.tenant_id = v_loc.tenant_id) then raise exception 'Unknown lot'; end if;
    v_seen := v_seen || v_lot;
    select coalesce(sum(g.delta), 0) into v_expected from public.cs_ledger g where g.location_id = p_location and g.lot_id = v_lot;
    insert into public.cs_count_lines (tenant_id, count_id, lot_id, expected, counted) values (v_loc.tenant_id, v_count, v_lot, v_expected, v_counted);
    if v_counted <> v_expected then
      insert into public.cs_discrepancies (tenant_id, location_id, lot_id, kind, expected, counted, count_id)
      values (v_loc.tenant_id, v_loc.id, v_lot, 'quantity', v_expected, v_counted, v_count);
    end if;
  end loop;

  select count(*) into v_missing from (
    select g.lot_id from public.cs_ledger g where g.location_id = p_location group by g.lot_id having sum(g.delta) <> 0) held
    where not (held.lot_id = any (v_seen));
  if v_missing > 0 then raise exception 'Count every lot held here (% missing)', v_missing; end if;

  if not v_seal_ok then
    insert into public.cs_discrepancies (tenant_id, location_id, kind, count_id) values (v_loc.tenant_id, v_loc.id, 'seal', v_count);
    insert into public.cs_seal_events (tenant_id, location_id, kind, seal_no, prior_seal_no, ok, performed_by)
    values (v_loc.tenant_id, v_loc.id, 'verify', v_seal, v_loc.current_seal_no, false, v_me);
  end if;
  if not app.cs_chain_ok(p_location) then
    insert into public.cs_discrepancies (tenant_id, location_id, kind, count_id) values (v_loc.tenant_id, v_loc.id, 'chain', v_count);
  end if;
  return v_count;
end $$;
revoke execute on function app.submit_cs_count(uuid, jsonb, text, uuid, uuid) from public, anon;
grant execute on function app.submit_cs_count(uuid, jsonb, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- discrepancy workflow
create or replace function app.cs_discrepancy_for_manage(p_id uuid) returns public.cs_discrepancies
language plpgsql security definer set search_path = '' as $$
declare d public.cs_discrepancies;
begin
  select * into d from public.cs_discrepancies where id = p_id and tenant_id = app.tenant_id() for update;
  if d.id is null then raise exception 'Unknown discrepancy'; end if;
  if not app.has_permission_unit('custody.manage', app.cs_unit_of(d.location_id)) then raise exception 'not allowed: custody.manage required at this location'; end if;
  return d;
end $$;
revoke execute on function app.cs_discrepancy_for_manage(uuid) from public, anon, authenticated;

create or replace function app.investigate_cs_discrepancy(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.cs_discrepancies := app.cs_discrepancy_for_manage(p_id);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if d.status = 'resolved' then raise exception 'That discrepancy is already resolved'; end if;
  if length(coalesce(v_note, '')) < 5 then raise exception 'explain what you are looking into (at least 5 characters)'; end if;
  insert into public.cs_discrepancy_events (tenant_id, discrepancy_id, kind, by_member, note) values (d.tenant_id, d.id, 'investigate', app.cs_me(), v_note);
  update public.cs_discrepancies set status = case when d.status = 'escalated' then 'escalated' else 'investigating' end where id = d.id;
end $$;
revoke execute on function app.investigate_cs_discrepancy(uuid, text) from public, anon;
grant execute on function app.investigate_cs_discrepancy(uuid, text) to authenticated;

create or replace function app.escalate_cs_discrepancy(p_id uuid, p_note text, p_report_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.cs_discrepancies := app.cs_discrepancy_for_manage(p_id);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if d.status = 'resolved' then raise exception 'That discrepancy is already resolved'; end if;
  if length(coalesce(v_note, '')) < 5 then raise exception 'explain why this is escalated (at least 5 characters)'; end if;
  insert into public.cs_discrepancy_events (tenant_id, discrepancy_id, kind, by_member, note, report_ref)
  values (d.tenant_id, d.id, 'escalate', app.cs_me(), v_note, nullif(trim(coalesce(p_report_ref, '')), ''));
  update public.cs_discrepancies set status = 'escalated' where id = d.id;
end $$;
revoke execute on function app.escalate_cs_discrepancy(uuid, text, text) from public, anon;
grant execute on function app.escalate_cs_discrepancy(uuid, text, text) to authenticated;

-- Resolve. The resolver may not be the counter or the witness of the count that opened it. An optional
-- adjustment posts one witnessed `adjust` linked to the discrepancy.
create or replace function app.resolve_cs_discrepancy(p_id uuid, p_note text, p_adjust_delta numeric, p_witness_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.cs_discrepancies := app.cs_discrepancy_for_manage(p_id);
  v_me uuid := app.cs_me();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_count public.cs_counts;
  v_ledger bigint;
begin
  if d.status = 'resolved' then raise exception 'That discrepancy is already resolved'; end if;
  if d.count_id is not null then
    select * into v_count from public.cs_counts where id = d.count_id;
    if v_me in (v_count.counted_by, v_count.witnessed_by) then raise exception 'The counter and the witness cannot resolve their own count'; end if;
  end if;
  if length(coalesce(v_note, '')) < 10 then raise exception 'explain the resolution (at least 10 characters)'; end if;
  if p_adjust_delta is not null and p_adjust_delta <> 0 then
    if d.lot_id is null then raise exception 'Only a quantity discrepancy can be adjusted'; end if;
    v_ledger := app.cs_adjust_internal(d.location_id, d.lot_id, p_adjust_delta, v_note, p_witness_request, d.id);
  end if;
  insert into public.cs_discrepancy_events (tenant_id, discrepancy_id, kind, by_member, note, adjust_ledger_id)
  values (d.tenant_id, d.id, 'resolve', v_me, v_note, v_ledger);
  update public.cs_discrepancies set status = 'resolved' where id = d.id;
end $$;
revoke execute on function app.resolve_cs_discrepancy(uuid, text, numeric, uuid) from public, anon;
grant execute on function app.resolve_cs_discrepancy(uuid, text, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------- views
create view public.cs_open_discrepancies with (security_invoker = true) as
  select * from public.cs_discrepancies where status <> 'resolved';
grant select on public.cs_open_discrepancies to authenticated, service_role;

-- Lots with stock on hand that expire within 90 days (or already have), per location.
create view public.cs_expiring with (security_invoker = true) as
  select b.tenant_id, b.location_id, b.lot_id, l.item_id, l.lot_no, l.expires_on, b.on_hand, (l.expires_on - current_date) as days_left
  from public.cs_balances b join public.cs_lots l on l.id = b.lot_id
  where b.on_hand > 0 and l.expires_on <= current_date + 90;
grant select on public.cs_expiring to authenticated, service_role;

create view public.cs_recalled with (security_invoker = true) as
  select b.tenant_id, b.location_id, b.lot_id, l.item_id, l.lot_no, l.recalled_at, l.recall_note, b.on_hand
  from public.cs_balances b join public.cs_lots l on l.id = b.lot_id
  where l.recalled_at is not null and b.on_hand > 0;
grant select on public.cs_recalled to authenticated, service_role;
