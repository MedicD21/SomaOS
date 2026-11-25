-- Controlled substances (Phase 3b), part 2: the append-only custody ledger with a hash chain per location,
-- witness requests confirmed by a different member, and the movement functions.
-- SomaOS records and surfaces; the hash chain shows tampering, it does not stop someone with owner rights.

-- ---------------------------------------------------------------- ledger
create table public.cs_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  lot_id uuid not null,
  delta numeric(12,3) not null check (delta <> 0),
  type text not null check (type in ('receive', 'transfer_out', 'transfer_in', 'return_out', 'return_in', 'administer', 'waste', 'adjust')),
  transfer_id uuid,
  performed_by uuid not null,
  witnessed_by uuid,
  reference text check (reference is null or length(reference) <= 200),   -- incident / run number only; no patient identifiers
  reason text check (reason is null or length(reason) <= 500),
  discrepancy_id uuid,                                                      -- FK added with the discrepancy table
  seq bigint not null,
  prev_hash text not null,
  row_hash text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (location_id, seq),
  foreign key (tenant_id, location_id) references public.cs_locations(tenant_id, id),
  foreign key (tenant_id, lot_id) references public.cs_lots(tenant_id, id),
  foreign key (tenant_id, performed_by) references public.members(tenant_id, id),
  foreign key (tenant_id, witnessed_by) references public.members(tenant_id, id),
  check (witnessed_by is null or witnessed_by <> performed_by),
  check (type not in ('waste', 'adjust') or witnessed_by is not null),
  check (type not in ('receive', 'transfer_in', 'return_in') or delta > 0),
  check (type not in ('transfer_out', 'return_out', 'administer', 'waste') or delta < 0)
);
create index cs_ledger_location_idx on public.cs_ledger (tenant_id, location_id, lot_id);

create trigger forbid_mutation before update or delete on public.cs_ledger
  for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.cs_ledger
  for each statement execute function app.forbid_mutation();
revoke insert, update, delete, truncate on public.cs_ledger from authenticated, anon;

alter table public.cs_ledger enable row level security;
create policy cs_ledger_read on public.cs_ledger for select to authenticated
  using (tenant_id = app.tenant_id() and app.cs_can_read(app.cs_unit_of(location_id)));

-- The hash covers the previous hash and every field that matters, in a fixed text form.
create or replace function app.cs_row_hash(
  p_prev text, p_id bigint, p_location uuid, p_lot uuid, p_delta numeric, p_type text, p_by uuid, p_wit uuid,
  p_ref text, p_reason text, p_at timestamptz, p_seq bigint) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|', p_prev, p_id::text, p_location::text, p_lot::text, p_delta::text, p_type,
    p_by::text, coalesce(p_wit::text, ''), coalesce(p_ref, ''), coalesce(p_reason, ''),
    to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), p_seq::text), 'UTF8')), 'hex')
$$;

-- Chain trigger: serialize writers per location, number the row, link and hash it, advance the location head.
create or replace function app.cs_ledger_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_loc public.cs_locations;
begin
  select * into v_loc from public.cs_locations where id = new.location_id and tenant_id = new.tenant_id for update;
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  new.seq := v_loc.chain_seq + 1;
  new.prev_hash := v_loc.chain_head;
  new.row_hash := app.cs_row_hash(new.prev_hash, new.id, new.location_id, new.lot_id, new.delta, new.type, new.performed_by,
                                  new.witnessed_by, new.reference, new.reason, new.occurred_at, new.seq);
  update public.cs_locations set chain_head = new.row_hash, chain_seq = new.seq where id = v_loc.id;
  return new;
end $$;
create trigger chain before insert on public.cs_ledger for each row execute function app.cs_ledger_chain();

-- Walk a location's chain; returns ok = true, or the first sequence number that does not verify.
create or replace function app.verify_cs_chain(p_location uuid) returns table (ok boolean, broken_seq bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_loc public.cs_locations;
  r public.cs_ledger;
  v_prev text := '';
  v_expect bigint := 1;
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id();
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if not (app.has_permission_dept('custody.audit') or app.has_permission_unit('custody.manage', v_loc.org_unit_id)) then
    raise exception 'not allowed: custody.audit or custody.manage required';
  end if;
  for r in select * from public.cs_ledger l where l.location_id = p_location order by l.seq loop
    if r.seq <> v_expect or r.prev_hash <> v_prev
       or r.row_hash <> app.cs_row_hash(r.prev_hash, r.id, r.location_id, r.lot_id, r.delta, r.type, r.performed_by, r.witnessed_by,
                                        r.reference, r.reason, r.occurred_at, r.seq) then
      return query select false, r.seq;
      return;
    end if;
    v_prev := r.row_hash;
    v_expect := v_expect + 1;
  end loop;
  if v_loc.chain_head <> v_prev or v_loc.chain_seq <> v_expect - 1 then
    return query select false, v_expect;
    return;
  end if;
  return query select true, null::bigint;
end $$;
revoke execute on function app.verify_cs_chain(uuid) from public, anon;
grant execute on function app.verify_cs_chain(uuid) to authenticated;

create view public.cs_balances with (security_invoker = true) as
  select tenant_id, location_id, lot_id, sum(delta)::numeric(12,3) as on_hand
  from public.cs_ledger group by tenant_id, location_id, lot_id;
grant select on public.cs_balances to authenticated, service_role;

-- ---------------------------------------------------------------- witness requests
create table public.cs_witness_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action text not null check (action in ('waste', 'adjust', 'transfer', 'return', 'seal_break', 'count')),
  payload jsonb not null,
  payload_hash text not null,
  location_id uuid not null,
  requested_by uuid not null,
  witness_member_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'expired')),
  decided_at timestamptz,
  decline_reason text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  result_ledger_id bigint references public.cs_ledger(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (requested_by <> witness_member_id),
  foreign key (tenant_id, location_id) references public.cs_locations(tenant_id, id),
  foreign key (tenant_id, requested_by) references public.members(tenant_id, id),
  foreign key (tenant_id, witness_member_id) references public.members(tenant_id, id)
);
create index cs_witness_witness_idx on public.cs_witness_requests (tenant_id, witness_member_id, status);
create index cs_witness_requester_idx on public.cs_witness_requests (tenant_id, requested_by, created_at desc);
revoke insert, update, delete, truncate on public.cs_witness_requests from authenticated, anon;
alter table public.cs_witness_requests enable row level security;
create policy cs_witness_read on public.cs_witness_requests for select to authenticated
  using (tenant_id = app.tenant_id()
         and (requested_by = app.my_member_id() or witness_member_id = app.my_member_id() or app.has_permission_dept('custody.audit')));
create trigger audit after insert or update or delete on public.cs_witness_requests for each row execute function app.audit_trigger();

-- Canonical form of a request payload: quantities become fixed-scale text, count lines are sorted, so the
-- request and the later movement compare equal however the numbers were typed.
create or replace function app.cs_canon(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k,
    case
      when k in ('qty', 'delta') and v <> 'null'::jsonb then to_jsonb(((v #>> '{}')::numeric(12,3))::text)
      when k = 'lines' and jsonb_typeof(v) = 'array' then
        (select coalesce(jsonb_agg(jsonb_build_object('lot_id', l ->> 'lot_id', 'counted', ((l ->> 'counted')::numeric(12,3))::text) order by l ->> 'lot_id'), '[]'::jsonb)
         from jsonb_array_elements(v) l)
      else v
    end), '{}'::jsonb)
  from jsonb_each(p) as t(k, v)
$$;
create or replace function app.cs_payload_hash(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_strip_nulls(app.cs_canon(p))::text, 'UTF8')), 'hex')
$$;

-- The caller's own member, or an error.
create or replace function app.cs_me() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := app.my_member_id();
begin
  if v is null then raise exception 'not a member of this department'; end if;
  return v;
end $$;
revoke execute on function app.cs_me() from public, anon, authenticated;

-- Ask a different member to witness. The witness must hold custody.witness at the location's unit.
create or replace function app.request_cs_witness(p_action text, p_payload jsonb, p_location uuid, p_witness uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_loc public.cs_locations;
  v_id uuid;
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id();
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if p_action is null or p_action not in ('waste', 'adjust', 'transfer', 'return', 'seal_break', 'count') then raise exception 'Unknown witnessed action'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Missing details to witness'; end if;
  if p_action = 'adjust' then
    if not app.has_permission_unit('custody.manage', v_loc.org_unit_id) then raise exception 'not allowed: you cannot request this here'; end if;
  elsif not (app.has_permission_unit('custody.record', v_loc.org_unit_id) or (p_action = 'seal_break' and app.has_permission_unit('custody.manage', v_loc.org_unit_id))) then
    raise exception 'not allowed: you cannot request this here';
  end if;
  if p_witness is null or p_witness = v_me then raise exception 'The witness must be a different member'; end if;
  if not exists (select 1 from public.members m where m.id = p_witness and m.tenant_id = app.tenant_id() and m.status <> 'separated') then
    raise exception 'Unknown member';
  end if;
  -- The witness's own permission is checked with their grants, so look them up directly.
  if not exists (
    select 1 from public.role_grants g
    join public.role_permissions rp on rp.role_id = g.role_id and rp.tenant_id = g.tenant_id
    left join public.org_units gu on gu.id = g.scope_org_unit_id
    join public.org_units tu on tu.id = v_loc.org_unit_id
    where g.member_id = p_witness and g.tenant_id = app.tenant_id() and rp.permission = 'custody.witness'
      and g.valid @> now()
      and (g.scope_kind = 'department' or (g.scope_kind = 'org_unit' and tu.path operator(extensions.<@) gu.path))) then
    raise exception 'That member cannot witness at this location';
  end if;
  insert into public.cs_witness_requests (tenant_id, action, payload, payload_hash, location_id, requested_by, witness_member_id)
  values (app.tenant_id(), p_action, app.cs_canon(p_payload), app.cs_payload_hash(p_payload), p_location, v_me, p_witness) returning id into v_id;
  perform app.notify_internal(p_witness, 'custody', 'Witness needed',
    (select m.first_name || ' ' || m.last_name from public.members m where m.id = v_me) || ' needs you to witness a custody action.', '/custody/witness');
  return v_id;
end $$;
revoke execute on function app.request_cs_witness(text, jsonb, uuid, uuid) from public, anon;
grant execute on function app.request_cs_witness(text, jsonb, uuid, uuid) to authenticated;

-- Only the named witness, from their own session, can confirm. They must still hold the permission at the unit.
create or replace function app.confirm_cs_witness(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_r public.cs_witness_requests;
begin
  select * into v_r from public.cs_witness_requests where id = p_request and tenant_id = app.tenant_id() for update;
  if v_r.id is null then raise exception 'Unknown witness request'; end if;
  if v_r.witness_member_id <> v_me or v_r.requested_by = v_me then raise exception 'only the named witness can confirm this'; end if;
  if v_r.status <> 'pending' then raise exception 'This request is already %', v_r.status; end if;
  if v_r.expires_at <= now() then raise exception 'This witness request has expired'; end if;
  if not app.has_permission_unit('custody.witness', app.cs_unit_of(v_r.location_id)) then raise exception 'not allowed: custody.witness required at this location'; end if;
  update public.cs_witness_requests set status = 'confirmed', decided_at = now() where id = v_r.id;
  perform app.notify_internal(v_r.requested_by, 'custody', 'Witness confirmed', 'Your witness confirmed. You can complete the action now.', '/custody');
end $$;
revoke execute on function app.confirm_cs_witness(uuid) from public, anon;
grant execute on function app.confirm_cs_witness(uuid) to authenticated;

create or replace function app.decline_cs_witness(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_r public.cs_witness_requests;
begin
  select * into v_r from public.cs_witness_requests where id = p_request and tenant_id = app.tenant_id() for update;
  if v_r.id is null then raise exception 'Unknown witness request'; end if;
  if v_r.witness_member_id <> v_me then raise exception 'only the named witness can decline this'; end if;
  if v_r.status <> 'pending' then raise exception 'This request is already %', v_r.status; end if;
  update public.cs_witness_requests set status = 'declined', decided_at = now(), decline_reason = nullif(trim(coalesce(p_reason, '')), '') where id = v_r.id;
  perform app.notify_internal(v_r.requested_by, 'custody', 'Witness declined', 'Your witness request was declined.', '/custody');
end $$;
revoke execute on function app.decline_cs_witness(uuid, text) from public, anon;
grant execute on function app.decline_cs_witness(uuid, text) to authenticated;

-- Use up a confirmed request: caller is the requester, same action and details, unexpired, not used before.
create or replace function app.cs_consume_witness(p_request uuid, p_action text, p_payload jsonb, p_location uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_r public.cs_witness_requests;
begin
  if p_request is null then raise exception 'A witness is required: request one first'; end if;
  select * into v_r from public.cs_witness_requests where id = p_request and tenant_id = app.tenant_id() for update;
  if v_r.id is null or v_r.requested_by <> v_me then raise exception 'Unknown witness request'; end if;
  if v_r.action <> p_action or v_r.location_id <> p_location or v_r.payload_hash <> app.cs_payload_hash(p_payload) then
    raise exception 'That witness request is for different details';
  end if;
  if v_r.consumed_at is not null then raise exception 'That witness request has already been used'; end if;
  if v_r.status <> 'confirmed' then raise exception 'The witness has not confirmed yet'; end if;
  if v_r.expires_at <= now() then raise exception 'That witness request has expired'; end if;
  update public.cs_witness_requests set consumed_at = now() where id = v_r.id;
  return v_r.witness_member_id;
end $$;
revoke execute on function app.cs_consume_witness(uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function app.cs_link_result(p_request uuid, p_ledger bigint) returns void
language sql security definer set search_path = '' as $$
  update public.cs_witness_requests set result_ledger_id = p_ledger where id = p_request and tenant_id = app.tenant_id()
$$;
revoke execute on function app.cs_link_result(uuid, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- posting
create or replace function app.cs_post(
  p_location uuid, p_lot uuid, p_delta numeric, p_type text, p_transfer uuid, p_by uuid, p_witness uuid,
  p_reference text, p_reason text, p_discrepancy uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_loc public.cs_locations;
  v_lot public.cs_lots;
  v_on numeric;
  v_id bigint;
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id() for update;
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if v_loc.archived_at is not null then raise exception 'That location is archived'; end if;
  select * into v_lot from public.cs_lots where id = p_lot and tenant_id = app.tenant_id();
  if v_lot.id is null then raise exception 'Unknown lot'; end if;
  if p_type in ('receive', 'transfer_out', 'transfer_in', 'administer') then
    if v_lot.archived_at is not null then raise exception 'That lot is archived'; end if;
    if v_lot.recalled_at is not null then raise exception 'That lot is recalled and cannot be used'; end if;
    if v_lot.expires_on < current_date then raise exception 'That lot has expired and cannot be used'; end if;
  end if;
  select coalesce(sum(l.delta), 0) into v_on from public.cs_ledger l where l.location_id = p_location and l.lot_id = p_lot;
  if v_on + p_delta < 0 then raise exception 'Not enough on hand: % available', v_on; end if;
  insert into public.cs_ledger (tenant_id, location_id, lot_id, delta, type, transfer_id, performed_by, witnessed_by, reference, reason, discrepancy_id)
  values (app.tenant_id(), p_location, p_lot, p_delta, p_type, p_transfer, p_by, p_witness, p_reference, p_reason, p_discrepancy)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.cs_post(uuid, uuid, numeric, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function app.cs_qty(p numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p <= 0 then raise exception 'Enter a quantity above zero'; end if;
  if p <> round(p, 3) then raise exception 'Use at most 3 decimal places'; end if;
  if p > 999999 then raise exception 'That quantity is too large'; end if;
  return p;
end $$;
revoke execute on function app.cs_qty(numeric) from public, anon;
grant execute on function app.cs_qty(numeric) to authenticated;

create or replace function app.cs_receive(p_location uuid, p_lot uuid, p_qty numeric, p_reference text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_unit uuid := app.cs_unit_of(p_location);
begin
  if v_unit is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.record', v_unit) then raise exception 'not allowed: you cannot record custody here'; end if;
  perform app.cs_qty(p_qty);
  return app.cs_post(p_location, p_lot, p_qty, 'receive', null, v_me, null, nullif(trim(coalesce(p_reference, '')), ''), null);
end $$;
revoke execute on function app.cs_receive(uuid, uuid, numeric, text) from public, anon;
grant execute on function app.cs_receive(uuid, uuid, numeric, text) to authenticated;

create or replace function app.cs_administer(p_location uuid, p_lot uuid, p_qty numeric, p_reference text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_unit uuid := app.cs_unit_of(p_location);
  v_ref text := nullif(trim(coalesce(p_reference, '')), '');
begin
  if v_unit is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.record', v_unit) then raise exception 'not allowed: you cannot record custody here'; end if;
  perform app.cs_qty(p_qty);
  if length(coalesce(v_ref, '')) < 3 then raise exception 'Enter the incident or run number (at least 3 characters)'; end if;
  return app.cs_post(p_location, p_lot, -p_qty, 'administer', null, v_me, null, v_ref, null);
end $$;
revoke execute on function app.cs_administer(uuid, uuid, numeric, text) from public, anon;
grant execute on function app.cs_administer(uuid, uuid, numeric, text) to authenticated;

-- Transfer or return between two locations. A witness is required when either end is a member or a drug box.
create or replace function app.cs_move(p_kind text, p_from uuid, p_to uuid, p_lot uuid, p_qty numeric, p_note text, p_request uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_from public.cs_locations;
  v_to public.cs_locations;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_wit uuid;
  v_tid uuid := gen_random_uuid();
  v_out text := case when p_kind = 'return' then 'return_out' else 'transfer_out' end;
  v_in text := case when p_kind = 'return' then 'return_in' else 'transfer_in' end;
  v_a bigint;
  v_b bigint;
begin
  perform app.cs_qty(p_qty);
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Choose two different locations'; end if;
  perform 1 from public.cs_locations where id in (p_from, p_to) and tenant_id = app.tenant_id() order by id for update;
  select * into v_from from public.cs_locations where id = p_from and tenant_id = app.tenant_id();
  select * into v_to from public.cs_locations where id = p_to and tenant_id = app.tenant_id();
  if v_from.id is null or v_to.id is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.record', v_from.org_unit_id) then raise exception 'not allowed: you cannot move custody stock from here'; end if;
  if not (app.has_permission_unit('custody.record', v_to.org_unit_id) or app.has_permission_unit('custody.manage', v_to.org_unit_id)) then
    raise exception 'not allowed: you cannot move custody stock to that location';
  end if;
  if v_from.kind in ('member', 'drug_box') or v_to.kind in ('member', 'drug_box') then
    v_wit := app.cs_consume_witness(p_request, p_kind, jsonb_build_object('from', p_from, 'to', p_to, 'lot', p_lot, 'qty', p_qty), p_from);
  end if;
  v_a := app.cs_post(p_from, p_lot, -p_qty, v_out, v_tid, v_me, v_wit, null, v_note);
  v_b := app.cs_post(p_to, p_lot, p_qty, v_in, v_tid, v_me, v_wit, null, v_note);
  if v_wit is not null then perform app.cs_link_result(p_request, v_a); end if;
  return v_tid;
end $$;
revoke execute on function app.cs_move(text, uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;

create or replace function app.cs_transfer(p_from uuid, p_to uuid, p_lot uuid, p_qty numeric, p_note text, p_witness_request uuid default null) returns uuid
language sql security definer set search_path = '' as $$
  select app.cs_move('transfer', p_from, p_to, p_lot, p_qty, p_note, p_witness_request)
$$;
revoke execute on function app.cs_transfer(uuid, uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function app.cs_transfer(uuid, uuid, uuid, numeric, text, uuid) to authenticated;

create or replace function app.cs_return(p_from uuid, p_to uuid, p_lot uuid, p_qty numeric, p_note text, p_witness_request uuid default null) returns uuid
language sql security definer set search_path = '' as $$
  select app.cs_move('return', p_from, p_to, p_lot, p_qty, p_note, p_witness_request)
$$;
revoke execute on function app.cs_return(uuid, uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function app.cs_return(uuid, uuid, uuid, numeric, text, uuid) to authenticated;

create or replace function app.cs_waste(p_location uuid, p_lot uuid, p_qty numeric, p_reason text, p_witness_request uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_unit uuid := app.cs_unit_of(p_location);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_wit uuid;
  v_id bigint;
begin
  if v_unit is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.record', v_unit) then raise exception 'not allowed: you cannot record custody here'; end if;
  perform app.cs_qty(p_qty);
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain the waste (at least 5 characters)'; end if;
  v_wit := app.cs_consume_witness(p_witness_request, 'waste',
    jsonb_build_object('location', p_location, 'lot', p_lot, 'qty', p_qty, 'reason', v_reason), p_location);
  v_id := app.cs_post(p_location, p_lot, -p_qty, 'waste', null, v_me, v_wit, null, v_reason);
  perform app.cs_link_result(p_witness_request, v_id);
  return v_id;
end $$;
revoke execute on function app.cs_waste(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function app.cs_waste(uuid, uuid, numeric, text, uuid) to authenticated;

-- Correct a balance (witnessed). The optional discrepancy link is used by the resolution workflow.
create or replace function app.cs_adjust_internal(p_location uuid, p_lot uuid, p_delta numeric, p_reason text, p_request uuid, p_discrepancy uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_unit uuid := app.cs_unit_of(p_location);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_wit uuid;
  v_id bigint;
begin
  if v_unit is null then raise exception 'Unknown location'; end if;
  if not app.has_permission_unit('custody.manage', v_unit) then raise exception 'not allowed: custody.manage required at this location'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Enter a non-zero adjustment'; end if;
  if p_delta <> round(p_delta, 3) then raise exception 'Use at most 3 decimal places'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain the adjustment (at least 5 characters)'; end if;
  v_wit := app.cs_consume_witness(p_request, 'adjust',
    jsonb_build_object('location', p_location, 'lot', p_lot, 'delta', p_delta, 'reason', v_reason, 'discrepancy', p_discrepancy), p_location);
  v_id := app.cs_post(p_location, p_lot, p_delta, 'adjust', null, v_me, v_wit, null, v_reason, p_discrepancy);
  perform app.cs_link_result(p_request, v_id);
  return v_id;
end $$;
revoke execute on function app.cs_adjust_internal(uuid, uuid, numeric, text, uuid, uuid) from public, anon, authenticated;

create or replace function app.cs_adjust(p_location uuid, p_lot uuid, p_delta numeric, p_reason text, p_witness_request uuid) returns bigint
language sql security definer set search_path = '' as $$
  select app.cs_adjust_internal(p_location, p_lot, p_delta, p_reason, p_witness_request, null)
$$;
revoke execute on function app.cs_adjust(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function app.cs_adjust(uuid, uuid, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------------- seal break (witnessed)
create or replace function app.break_cs_seal(p_location uuid, p_reason text, p_new_seal_no text, p_witness_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.cs_me();
  v_loc public.cs_locations;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_new text := nullif(trim(coalesce(p_new_seal_no, '')), '');
  v_wit uuid;
begin
  select * into v_loc from public.cs_locations where id = p_location and tenant_id = app.tenant_id() for update;
  if v_loc.id is null then raise exception 'Unknown location'; end if;
  if not (app.has_permission_unit('custody.record', v_loc.org_unit_id) or app.has_permission_unit('custody.manage', v_loc.org_unit_id)) then
    raise exception 'not allowed: you cannot seal boxes here';
  end if;
  if v_loc.current_seal_no is null then raise exception 'That box has no seal to break'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain why the seal is broken (at least 5 characters)'; end if;
  if v_new is null then raise exception 'Enter the new seal number'; end if;
  if exists (select 1 from public.cs_seal_events e where e.tenant_id = v_loc.tenant_id and e.seal_no = v_new and e.kind = 'apply') then
    raise exception 'That seal number has already been used';
  end if;
  v_wit := app.cs_consume_witness(p_witness_request, 'seal_break',
    jsonb_build_object('location', p_location, 'new_seal_no', v_new, 'reason', v_reason), p_location);
  insert into public.cs_seal_events (tenant_id, location_id, kind, seal_no, prior_seal_no, reason, performed_by, witnessed_by)
  values (v_loc.tenant_id, v_loc.id, 'break', v_loc.current_seal_no, v_loc.current_seal_no, v_reason, v_me, v_wit);
  insert into public.cs_seal_events (tenant_id, location_id, kind, seal_no, performed_by, witnessed_by)
  values (v_loc.tenant_id, v_loc.id, 'apply', v_new, v_me, v_wit);
  update public.cs_locations set current_seal_no = v_new where id = v_loc.id;
end $$;
revoke execute on function app.break_cs_seal(uuid, text, text, uuid) from public, anon;
grant execute on function app.break_cs_seal(uuid, text, text, uuid) to authenticated;
