-- Leave workflow. Every write goes through these definer functions, which check the caller's
-- scope in SQL (org unit subtree AND shift) so nothing depends on the application alone.

-- Approved accrual policy for a bank, effective now (null when none). Internal.
create or replace function app.leave_policy(p_bank uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select c.payload
  from public.config_versions c
  join public.leave_banks b on b.key = c.key and b.tenant_id = c.tenant_id
  where b.id = p_bank and c.tenant_id = app.tenant_id() and c.kind = 'leave.accrual'
    and c.status = 'approved' and c.effective @> now()
$$;
revoke execute on function app.leave_policy(uuid) from public, anon, authenticated;

-- A member's scheduled, non-Kelly shifts whose local start date falls in [p_start, p_end], with
-- scheduled (wall-clock) hours: a 24-hour shift counts 24 even across a daylight-saving change.
create or replace function app.leave_shifts(p_member uuid, p_start date, p_end date)
returns table (shift_id uuid, hours numeric)
language sql stable security definer set search_path = '' as $$
  select a.id,
         round(extract(epoch from ((upper(a.during) at time zone z.tz) - (lower(a.during) at time zone z.tz))) / 3600.0, 2)
  from public.shift_assignments a
  cross join lateral (
    select coalesce(ou.timezone, t.timezone) as tz
    from public.tenants t
    left join public.seats s on s.id = a.seat_id
    left join public.org_units ou on ou.id = s.org_unit_id
    where t.id = a.tenant_id) z
  where a.tenant_id = app.tenant_id() and a.member_id = p_member
    and a.status = 'scheduled' and a.type <> 'kelly'
    and (lower(a.during) at time zone z.tz)::date between p_start and p_end
$$;
revoke execute on function app.leave_shifts(uuid, date, date) from public, anon, authenticated;

-- May the caller decide leave for this member? Needs a leave.approve grant covering the member's
-- current primary org unit (department scope, or an org-unit subtree) and, when the grant is
-- limited to a shift, the member's primary shift. Nobody decides their own leave.
create or replace function app.can_decide_leave(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_member is distinct from app.my_member_id()
    and exists (
      select 1
      from app.my_grants() g
      left join lateral (
        select a.shift_id, ou.path
        from public.member_assignments a
        join public.tenants t on t.id = a.tenant_id
        left join public.org_units ou on ou.id = a.org_unit_id
        where a.member_id = p_member and a.tenant_id = app.tenant_id() and a.is_primary
          and a.effective @> (now() at time zone t.timezone)::date
        limit 1
      ) pa on true
      where g.permission = 'leave.approve'
        and (g.scope_shift_id is null or g.scope_shift_id = pa.shift_id)
        and (g.scope_kind = 'department'
             or (g.scope_kind = 'org_unit' and pa.path is not null
                 and pa.path operator(extensions.<@) g.scope_path::extensions.ltree)))
$$;
revoke execute on function app.can_decide_leave(uuid) from public, anon;
grant execute on function app.can_decide_leave(uuid) to authenticated, service_role;

create or replace function app.leave_label(p_type text, p_start date, p_end date) returns text
language sql immutable set search_path = '' as $$
  select p_type || ', ' || to_char(p_start, 'Mon FMDD') ||
         case when p_end <> p_start then '–' || to_char(p_end, 'Mon FMDD') else '' end
$$;

-- Member asks for leave. Hours come from their scheduled shifts in the range.
create or replace function app.request_leave(p_type uuid, p_start date, p_end date, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid := app.my_member_id();
  v_type public.leave_types;
  v_hours numeric;
  v_today date;
  v_balance numeric := 0;
  v_pending numeric := 0;
  v_id uuid;
begin
  if v_member is null then raise exception 'not a member of this department'; end if;
  if not app.has_permission('leave.request') then raise exception 'not allowed: leave.request required'; end if;
  if p_end < p_start then raise exception 'the end date is before the start date'; end if;

  select * into v_type from public.leave_types
  where id = p_type and tenant_id = app.tenant_id() and archived_at is null;
  if v_type.id is null then raise exception 'unknown leave type'; end if;

  select (now() at time zone t.timezone)::date into v_today from public.tenants t where t.id = app.tenant_id();
  if v_type.lead_time_days > 0 and p_start < v_today + v_type.lead_time_days then
    raise exception 'lead time: % must be requested at least % days ahead', v_type.label, v_type.lead_time_days;
  end if;

  select coalesce(sum(s.hours), 0) into v_hours from app.leave_shifts(v_member, p_start, p_end) s;
  if v_hours <= 0 then raise exception 'No scheduled shifts in that range'; end if;

  if v_type.bank_id is not null
     and not coalesce((app.leave_policy(v_type.bank_id) ->> 'negativeAllowed')::boolean, false) then
    select coalesce(sum(hours), 0) into v_balance from public.leave_ledger
    where member_id = v_member and bank_id = v_type.bank_id;
    select coalesce(sum(r.hours), 0) into v_pending
    from public.leave_requests r join public.leave_types lt on lt.id = r.leave_type_id
    where r.member_id = v_member and r.status = 'pending' and lt.bank_id = v_type.bank_id;
    if v_hours > v_balance - v_pending then
      raise exception 'insufficient balance: % h available, % h needed', round(v_balance - v_pending, 2), v_hours;
    end if;
  end if;

  insert into public.leave_requests (tenant_id, member_id, leave_type_id, start_date, end_date, hours, reason)
  values (app.tenant_id(), v_member, p_type, p_start, p_end, v_hours, nullif(trim(p_reason), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.request_leave(uuid, date, date, text) from public, anon;
grant execute on function app.request_leave(uuid, date, date, text) to authenticated;

-- Approver decides a pending request: approval debits the bank and frees the member's shifts.
create or replace function app.decide_leave(p_request uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_req public.leave_requests;
  v_type public.leave_types;
  v_hours numeric;
  v_balance numeric;
  v_label text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_req from public.leave_requests
  where id = p_request and tenant_id = app.tenant_id() for update;
  if v_req.id is null or not app.can_decide_leave(v_req.member_id) then
    raise exception 'not in your scope';
  end if;
  if v_req.status <> 'pending' then raise exception 'this request is already %', v_req.status; end if;
  select * into v_type from public.leave_types where id = v_req.leave_type_id;
  v_label := app.leave_label(v_type.label, v_req.start_date, v_req.end_date);

  if not p_approve then
    if length(coalesce(v_note, '')) < 5 then raise exception 'a reason is required to deny leave (at least 5 characters)'; end if;
    update public.leave_requests
       set status = 'denied', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = p_request;
    perform app.notify_internal(v_req.member_id, 'leave.decided', 'Leave denied: ' || v_label,
                                'Reason: ' || v_note, '/leave');
    return;
  end if;

  select coalesce(sum(s.hours), 0) into v_hours from app.leave_shifts(v_req.member_id, v_req.start_date, v_req.end_date) s;
  if v_hours <= 0 then raise exception 'No scheduled shifts remain in that range; deny or cancel the request'; end if;

  if v_type.bank_id is not null
     and not coalesce((app.leave_policy(v_type.bank_id) ->> 'negativeAllowed')::boolean, false) then
    select coalesce(sum(hours), 0) into v_balance from public.leave_ledger
    where member_id = v_req.member_id and bank_id = v_type.bank_id;
    if v_hours > v_balance then
      raise exception 'insufficient balance: % h available, % h needed', round(v_balance, 2), v_hours;
    end if;
  end if;

  update public.shift_assignments
     set status = 'cancelled', cancelled_reason = 'Leave: ' || v_type.label, leave_request_id = p_request
   where id in (select s.shift_id from app.leave_shifts(v_req.member_id, v_req.start_date, v_req.end_date) s);

  if v_type.bank_id is not null then
    insert into public.leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, request_id, note)
    values (v_req.tenant_id, v_req.member_id, v_type.bank_id, 'use', -v_hours, v_req.start_date, p_request, v_label);
  end if;

  update public.leave_requests
     set status = 'approved', hours = v_hours, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = p_request;
  perform app.notify_internal(v_req.member_id, 'leave.decided', 'Leave approved: ' || v_label,
                              coalesce(v_note, 'Your leave was approved.'), '/leave');
end $$;
revoke execute on function app.decide_leave(uuid, boolean, text) from public, anon;
grant execute on function app.decide_leave(uuid, boolean, text) to authenticated;

-- Cancel a pending or approved request. Approved leave is reversed once and its shifts restored.
create or replace function app.cancel_leave(p_request uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_req public.leave_requests;
  v_type public.leave_types;
  v_today date;
  v_net numeric;
  v_is_owner boolean;
  v_can_decide boolean;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_req from public.leave_requests
  where id = p_request and tenant_id = app.tenant_id() for update;
  if v_req.id is null then raise exception 'not in your scope'; end if;
  v_is_owner := v_req.member_id = app.my_member_id();
  v_can_decide := app.can_decide_leave(v_req.member_id);
  if not (v_is_owner or v_can_decide) then raise exception 'not in your scope'; end if;
  if v_req.status not in ('pending', 'approved') then raise exception 'this request is already %', v_req.status; end if;

  if v_req.status = 'approved' then
    select (now() at time zone t.timezone)::date into v_today from public.tenants t where t.id = v_req.tenant_id;
    if v_is_owner and not v_can_decide and v_req.start_date <= v_today then
      raise exception 'that leave has already started; ask an approver to cancel it';
    end if;
    select * into v_type from public.leave_types where id = v_req.leave_type_id;

    begin
      update public.shift_assignments
         set status = 'scheduled', cancelled_reason = null, leave_request_id = null
       where leave_request_id = p_request and tenant_id = v_req.tenant_id and status = 'cancelled';
    exception when exclusion_violation then
      raise exception 'A seat was refilled; resolve it in the roster first.';
    end;

    if v_type.bank_id is not null then
      select coalesce(sum(hours), 0) into v_net from public.leave_ledger
      where request_id = p_request and kind in ('use', 'reversal');
      if v_net < 0 then
        insert into public.leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, request_id, note)
        values (v_req.tenant_id, v_req.member_id, v_type.bank_id, 'reversal', -v_net, v_req.start_date, p_request,
                coalesce(v_note, 'Leave cancelled'));
      end if;
    end if;
  end if;

  update public.leave_requests
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now(),
         decision_note = coalesce(v_note, decision_note)
   where id = p_request;
end $$;
revoke execute on function app.cancel_leave(uuid, text) from public, anon;
grant execute on function app.cancel_leave(uuid, text) to authenticated;

-- Manual balance adjustment (opening balances, corrections, comp-time earned outside the system).
create or replace function app.adjust_leave(p_member uuid, p_bank uuid, p_hours numeric, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not app.has_permission_dept('leave.manage') then raise exception 'not allowed: leave.manage required'; end if;
  if length(coalesce(v_note, '')) < 5 then raise exception 'explain the adjustment (at least 5 characters)'; end if;
  if p_hours is null or p_hours = 0 then raise exception 'enter a non-zero number of hours'; end if;
  if not exists (select 1 from public.members where id = p_member and tenant_id = app.tenant_id()) then
    raise exception 'unknown member';
  end if;
  if not exists (select 1 from public.leave_banks where id = p_bank and tenant_id = app.tenant_id()) then
    raise exception 'unknown leave bank';
  end if;
  insert into public.leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, note)
  values (app.tenant_id(), p_member, p_bank, 'adjust', p_hours,
          (select (now() at time zone t.timezone)::date from public.tenants t where t.id = app.tenant_id()), v_note);
end $$;
revoke execute on function app.adjust_leave(uuid, uuid, numeric, text) from public, anon;
grant execute on function app.adjust_leave(uuid, uuid, numeric, text) to authenticated;

-- Requests the caller is allowed to decide.
create or replace function app.leave_requests_in_scope(p_status text default 'pending')
returns table (
  request_id uuid, member_id uuid, member_name text, leave_type text, start_date date,
  end_date date, hours numeric, reason text, status text, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.member_id, m.last_name || ', ' || m.first_name, lt.label, r.start_date, r.end_date,
         r.hours, r.reason, r.status, r.created_at
  from public.leave_requests r
  join public.members m on m.id = r.member_id
  join public.leave_types lt on lt.id = r.leave_type_id
  where r.tenant_id = app.tenant_id() and r.status = p_status and app.can_decide_leave(r.member_id)
  order by r.created_at desc
$$;
revoke execute on function app.leave_requests_in_scope(text) from public, anon;
grant execute on function app.leave_requests_in_scope(text) to authenticated;
