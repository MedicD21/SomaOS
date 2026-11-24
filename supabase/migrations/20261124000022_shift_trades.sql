-- Shift trades: a member proposes swapping one of their upcoming shifts with another member's; the other
-- member accepts; an officer covering both stations approves; the swap is one statement-group in the
-- database so overlap rules decide conflicts. Writes only through the functions below.

create table public.shift_trades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requester_id uuid not null,
  requester_assignment_id uuid not null,
  counterparty_id uuid not null,
  counterparty_assignment_id uuid not null,
  note text check (note is null or length(note) <= 300),
  status text not null default 'awaiting_member'
    check (status in ('awaiting_member', 'awaiting_approval', 'approved', 'denied', 'declined', 'cancelled')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> counterparty_id and requester_assignment_id <> counterparty_assignment_id),
  unique (tenant_id, id),
  foreign key (tenant_id, requester_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, counterparty_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, requester_assignment_id) references public.shift_assignments(tenant_id, id),
  foreign key (tenant_id, counterparty_assignment_id) references public.shift_assignments(tenant_id, id)
);
create index shift_trades_requester_idx on public.shift_trades (tenant_id, requester_id, status);
create index shift_trades_counterparty_idx on public.shift_trades (tenant_id, counterparty_id, status);
create unique index shift_trades_open_requester on public.shift_trades (requester_assignment_id)
  where status in ('awaiting_member', 'awaiting_approval');
create unique index shift_trades_open_counterparty on public.shift_trades (counterparty_assignment_id)
  where status in ('awaiting_member', 'awaiting_approval');

revoke insert, update, delete, truncate on public.shift_trades from authenticated, anon;

-- The org unit of an assignment's seat.
create or replace function app.assignment_unit(p_assignment uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.org_unit_id from public.shift_assignments a join public.seats s on s.id = a.seat_id
  where a.id = p_assignment and a.tenant_id = app.tenant_id()
$$;
revoke execute on function app.assignment_unit(uuid) from public, anon;
grant execute on function app.assignment_unit(uuid) to authenticated, service_role;

-- Officers who may roster-edit at either station of a trade can see it.
create or replace function app.can_see_trade(p_req_assignment uuid, p_cp_assignment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission_at('scheduling.roster.edit', app.assignment_unit(p_req_assignment))
      or app.has_permission_at('scheduling.roster.edit', app.assignment_unit(p_cp_assignment))
$$;
revoke execute on function app.can_see_trade(uuid, uuid) from public, anon;
grant execute on function app.can_see_trade(uuid, uuid) to authenticated, service_role;

alter table public.shift_trades enable row level security;
create policy trade_read on public.shift_trades for select to authenticated
  using (tenant_id = app.tenant_id()
         and (requester_id = app.my_member_id() or counterparty_id = app.my_member_id()
              or app.can_see_trade(requester_assignment_id, counterparty_assignment_id)));

create trigger audit after insert or update or delete on public.shift_trades
  for each row execute function app.audit_trigger();

-- May the caller approve or deny this trade? roster.edit at BOTH stations, and not a party to it.
create or replace function app.can_decide_trade(p_trade uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shift_trades t
    where t.id = p_trade and t.tenant_id = app.tenant_id()
      and app.my_member_id() is distinct from t.requester_id
      and app.my_member_id() is distinct from t.counterparty_id
      and app.has_permission_at('scheduling.roster.edit', app.assignment_unit(t.requester_assignment_id))
      and app.has_permission_at('scheduling.roster.edit', app.assignment_unit(t.counterparty_assignment_id)))
$$;
revoke execute on function app.can_decide_trade(uuid) from public, anon;
grant execute on function app.can_decide_trade(uuid) to authenticated, service_role;

create or replace function app.request_trade(p_mine uuid, p_theirs uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_me uuid := app.my_member_id();
  v_a1 public.shift_assignments;
  v_a2 public.shift_assignments;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if not app.has_permission('scheduling.trade.request') then raise exception 'not allowed: scheduling.trade.request required'; end if;
  if v_me is null then raise exception 'not a member of this department'; end if;
  select * into v_a1 from public.shift_assignments where id = p_mine and tenant_id = v_tenant;
  select * into v_a2 from public.shift_assignments where id = p_theirs and tenant_id = v_tenant;
  if v_a1.id is null or v_a1.member_id <> v_me then raise exception 'That is not one of your shifts'; end if;
  if v_a2.id is null then raise exception 'That shift was not found'; end if;
  if v_a2.member_id = v_me then raise exception 'Choose a shift worked by someone else'; end if;
  if v_a1.status <> 'scheduled' or v_a2.status <> 'scheduled' or v_a1.type = 'kelly' or v_a2.type = 'kelly'
     or v_a1.seat_id is null or v_a2.seat_id is null or lower(v_a1.during) <= now() or lower(v_a2.during) <= now() then
    raise exception 'Only upcoming scheduled shifts with a seat can be traded';
  end if;
  if exists (select 1 from public.members m where m.id = v_a2.member_id and m.status = 'separated') then
    raise exception 'That member has separated from the department';
  end if;
  if exists (select 1 from public.shift_trades t
             where t.status in ('awaiting_member', 'awaiting_approval')
               and (t.requester_assignment_id in (p_mine, p_theirs) or t.counterparty_assignment_id in (p_mine, p_theirs))) then
    raise exception 'One of those shifts is already in a pending trade';
  end if;
  insert into public.shift_trades (tenant_id, requester_id, requester_assignment_id, counterparty_id, counterparty_assignment_id, note)
  values (v_tenant, v_me, p_mine, v_a2.member_id, p_theirs, v_note) returning id into v_id;
  perform app.notify_internal(v_a2.member_id, 'trade', 'Shift trade proposed',
    (select m.first_name || ' ' || m.last_name from public.members m where m.id = v_me) || ' would like to trade shifts with you.', '/trades');
  return v_id;
end $$;
revoke execute on function app.request_trade(uuid, uuid, text) from public, anon;
grant execute on function app.request_trade(uuid, uuid, text) to authenticated;

create or replace function app.respond_trade(p_trade uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t public.shift_trades;
begin
  select * into v_t from public.shift_trades where id = p_trade and tenant_id = app.tenant_id() for update;
  if v_t.id is null then raise exception 'unknown trade'; end if;
  if v_t.counterparty_id is distinct from app.my_member_id() then raise exception 'only the member asked can answer this trade'; end if;
  if v_t.status <> 'awaiting_member' then raise exception 'This trade is no longer waiting for your answer'; end if;
  update public.shift_trades
     set status = case when p_accept then 'awaiting_approval' else 'declined' end, updated_at = now()
   where id = v_t.id;
  perform app.notify_internal(v_t.requester_id, 'trade',
    case when p_accept then 'Trade accepted' else 'Trade declined' end,
    case when p_accept then 'Your trade was accepted and is waiting for an officer to approve it.' else 'Your trade proposal was declined.' end,
    '/trades');
end $$;
revoke execute on function app.respond_trade(uuid, boolean) from public, anon;
grant execute on function app.respond_trade(uuid, boolean) to authenticated;

create or replace function app.cancel_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t public.shift_trades; v_other uuid;
begin
  select * into v_t from public.shift_trades where id = p_trade and tenant_id = app.tenant_id() for update;
  if v_t.id is null then raise exception 'unknown trade'; end if;
  if app.my_member_id() is distinct from v_t.requester_id and app.my_member_id() is distinct from v_t.counterparty_id then
    raise exception 'only the members in this trade can withdraw it';
  end if;
  if v_t.status not in ('awaiting_member', 'awaiting_approval') then raise exception 'This trade is already decided'; end if;
  update public.shift_trades set status = 'cancelled', updated_at = now() where id = v_t.id;
  v_other := case when app.my_member_id() = v_t.requester_id then v_t.counterparty_id else v_t.requester_id end;
  perform app.notify_internal(v_other, 'trade', 'Trade withdrawn', 'A shift trade you were part of was withdrawn.', '/trades');
end $$;
revoke execute on function app.cancel_trade(uuid) from public, anon;
grant execute on function app.cancel_trade(uuid) to authenticated;

-- Approve (swapping the two shifts) or deny. p_override waives a qualification block and needs
-- scheduling.qualification.override at both stations.
create or replace function app.decide_trade(p_trade uuid, p_approve boolean, p_note text, p_override text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.shift_trades;
  v_a1 public.shift_assignments;
  v_a2 public.shift_assignments;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_override text := nullif(trim(coalesce(p_override, '')), '');
begin
  select * into v_t from public.shift_trades where id = p_trade and tenant_id = app.tenant_id() for update;
  if v_t.id is null then raise exception 'unknown trade'; end if;
  if v_t.status <> 'awaiting_approval' then raise exception 'This trade is not waiting for approval'; end if;
  if not app.can_decide_trade(p_trade) then raise exception 'not in your scope: approving needs roster edit at both stations'; end if;

  if not p_approve then
    update public.shift_trades set status = 'denied', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = v_t.id;
  else
    select * into v_a1 from public.shift_assignments where id = v_t.requester_assignment_id for update;
    select * into v_a2 from public.shift_assignments where id = v_t.counterparty_assignment_id for update;
    if v_a1.status <> 'scheduled' or v_a2.status <> 'scheduled'
       or v_a1.member_id <> v_t.requester_id or v_a2.member_id <> v_t.counterparty_id
       or lower(v_a1.during) <= now() or lower(v_a2.during) <= now() then
      raise exception 'That trade is no longer valid: one of the shifts has changed';
    end if;
    if v_override is not null then
      if length(v_override) < 5 then raise exception 'an override reason of at least 5 characters is required'; end if;
      if not (app.has_permission_at('scheduling.qualification.override', app.assignment_unit(v_a1.id))
              and app.has_permission_at('scheduling.qualification.override', app.assignment_unit(v_a2.id))) then
        raise exception 'not in your scope: overriding needs qualification override at both stations';
      end if;
    end if;

    -- Free the first shift so same-time swaps are not a transient double-booking, then swap.
    update public.shift_assignments set status = 'cancelled', cancelled_reason = 'Trade in progress' where id = v_a1.id;
    update public.shift_assignments
       set member_id = v_t.requester_id, type = 'trade',
           override_reason = coalesce(v_override, override_reason),
           explain = explain || jsonb_build_array(jsonb_build_object('rule', 'trade', 'message', 'Traded (was ' || v_a2.type || ')'))
     where id = v_a2.id;
    update public.shift_assignments
       set member_id = v_t.counterparty_id, type = 'trade', status = 'scheduled', cancelled_reason = null,
           override_reason = coalesce(v_override, override_reason),
           explain = explain || jsonb_build_array(jsonb_build_object('rule', 'trade', 'message', 'Traded (was ' || v_a1.type || ')'))
     where id = v_a1.id;

    update public.shift_trades
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
           override_reason = v_override, updated_at = now()
     where id = v_t.id;
  end if;

  perform app.notify_internal(v_t.requester_id, 'trade', case when p_approve then 'Trade approved' else 'Trade denied' end,
    case when p_approve then 'Your shift trade was approved and the roster is updated.' else 'Your shift trade was denied.' end, '/trades');
  perform app.notify_internal(v_t.counterparty_id, 'trade', case when p_approve then 'Trade approved' else 'Trade denied' end,
    case when p_approve then 'Your shift trade was approved and the roster is updated.' else 'Your shift trade was denied.' end, '/trades');
end $$;
revoke execute on function app.decide_trade(uuid, boolean, text, text) from public, anon;
grant execute on function app.decide_trade(uuid, boolean, text, text) to authenticated;
