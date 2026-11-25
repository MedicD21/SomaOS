-- Leave limits: cap how many members may be on approved leave on the same day, per station subtree and/or
-- shift, optionally per leave type. Members may still request; approving past a limit needs an override.

create table public.leave_limits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null,
  scope_kind text not null check (scope_kind in ('department', 'org_unit')),
  org_unit_id uuid,
  shift_id uuid,
  leave_type_id uuid,                              -- null = any leave type
  max_concurrent int not null check (max_concurrent >= 0 and max_concurrent <= 1000),
  effective daterange not null check (not isempty(effective)),
  archived_at timestamptz,
  unique (tenant_id, id),
  constraint leave_limits_scope_check check ((scope_kind = 'org_unit') = (org_unit_id is not null)),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, shift_id) references public.shifts(tenant_id, id),
  foreign key (tenant_id, leave_type_id) references public.leave_types(tenant_id, id)
);
create index leave_limits_tenant_idx on public.leave_limits (tenant_id) where archived_at is null;

revoke delete, truncate on public.leave_limits from authenticated, anon;

alter table public.leave_limits enable row level security;
create policy tenant_read on public.leave_limits for select to authenticated
  using (tenant_id = app.tenant_id());
create policy tenant_write on public.leave_limits for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('leave.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission_dept('leave.manage'));

create trigger audit after insert or update or delete on public.leave_limits
  for each row execute function app.audit_trigger();

-- Where a member works today: primary assignment, else regular (standing) seat. At most one row; none when unplaced.
create or replace function app.member_placement(p_member uuid) returns table (shift_id uuid, path extensions.ltree)
language sql stable security definer set search_path = '' as $$
  select x.shift_id, x.path from (
    select 1 as pri, a.shift_id, ou.path
    from public.member_assignments a
    join public.tenants t on t.id = a.tenant_id
    left join public.org_units ou on ou.id = a.org_unit_id
    where a.member_id = p_member and a.tenant_id = app.tenant_id() and a.is_primary
      and a.effective @> (now() at time zone t.timezone)::date
    union all
    select 2, ss.platoon_shift_id, ou.path
    from public.standing_seats ss
    join public.tenants t on t.id = ss.tenant_id
    join public.seats st on st.id = ss.seat_id
    left join public.org_units ou on ou.id = st.org_unit_id
    where ss.member_id = p_member and ss.tenant_id = app.tenant_id()
      and ss.effective @> (now() at time zone t.timezone)::date
  ) x
  order by x.pri
  limit 1
$$;
revoke execute on function app.member_placement(uuid) from public, anon, authenticated;

-- For each day of the request and each limit that applies to this member: how many OTHER members in the same
-- scope already have approved leave that day, and whether approving this request would put the day over the limit.
create or replace function app.leave_limit_check(p_member uuid, p_start date, p_end date, p_type uuid)
returns table (day date, limit_id uuid, label text, max_concurrent int, on_leave int, over boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (app.can_decide_leave(p_member) or app.has_permission_dept('leave.manage')) then
    raise exception 'not in your scope';
  end if;
  return query
  select d.day, l.id, l.label, l.max_concurrent, c.n::int, (c.n + 1 > l.max_concurrent)
  from (select g::date as day from generate_series(p_start, p_end, interval '1 day') g) d
  cross join (
    select ll.*, ou.path as unit_path
    from public.leave_limits ll left join public.org_units ou on ou.id = ll.org_unit_id
    where ll.tenant_id = app.tenant_id() and ll.archived_at is null
      and (ll.leave_type_id is null or ll.leave_type_id = p_type)
  ) l
  left join lateral app.member_placement(p_member) me on true
  cross join lateral (
    select count(distinct r.member_id) as n
    from public.leave_requests r
    left join lateral app.member_placement(r.member_id) mp on true
    where r.tenant_id = app.tenant_id() and r.status = 'approved' and r.member_id <> p_member
      and d.day between r.start_date and r.end_date
      and (l.leave_type_id is null or r.leave_type_id = l.leave_type_id)
      and (l.shift_id is null or mp.shift_id = l.shift_id)
      and (l.scope_kind = 'department' or (mp.path is not null and mp.path operator(extensions.<@) l.unit_path))
  ) c
  where l.effective @> d.day
    and (l.shift_id is null or me.shift_id = l.shift_id)
    and (l.scope_kind = 'department' or (me.path is not null and me.path operator(extensions.<@) l.unit_path))
  order by d.day, l.label;
end $$;
revoke execute on function app.leave_limit_check(uuid, date, date, uuid) from public, anon;
grant execute on function app.leave_limit_check(uuid, date, date, uuid) to authenticated;

-- decide_leave: same as before, plus leave limits at approval with an optional override reason.
drop function app.decide_leave(uuid, boolean, text);
create or replace function app.decide_leave(p_request uuid, p_approve boolean, p_note text, p_override text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_req public.leave_requests;
  v_type public.leave_types;
  v_hours numeric;
  v_balance numeric;
  v_label text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_override text := nullif(trim(coalesce(p_override, '')), '');
  v_over record;
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

  -- Leave limits: refuse when any day would exceed a limit, unless a leave.manage holder overrides with a reason.
  select c.day, c.label, c.max_concurrent, c.on_leave into v_over
  from app.leave_limit_check(v_req.member_id, v_req.start_date, v_req.end_date, v_req.leave_type_id) c
  where c.over order by c.day limit 1;
  if v_over.day is not null then
    if v_override is null then
      raise exception 'leave limit: "%" allows at most % member(s) on leave on % (% already approved). A leave manager can approve it anyway with a reason.',
        v_over.label, v_over.max_concurrent, v_over.day, v_over.on_leave;
    end if;
    if length(v_override) < 5 then raise exception 'an override reason of at least 5 characters is required'; end if;
    if not app.has_permission_dept('leave.manage') then raise exception 'not allowed: overriding a leave limit needs leave.manage'; end if;
    v_note := coalesce(v_note || ' · ', '') || 'Limit override: ' || v_override;
  end if;

  if v_type.bank_id is not null
     and not coalesce((app.leave_policy(v_type.bank_id) ->> 'negativeAllowed')::boolean, false) then
    select coalesce(sum(hours), 0) into v_balance from public.leave_ledger
    where member_id = v_req.member_id and bank_id = v_type.bank_id;
    if v_hours > v_balance then
      raise exception 'insufficient balance: % h available, % h needed', trim_scale(round(v_balance, 2)), trim_scale(v_hours);
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
revoke execute on function app.decide_leave(uuid, boolean, text, text) from public, anon;
grant execute on function app.decide_leave(uuid, boolean, text, text) to authenticated;
