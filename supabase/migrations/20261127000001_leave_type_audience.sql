-- Leave type audience: who may request a type for themselves.
--   member  = anyone with leave.request (crew leave: sick, vacation, jury duty, ...)
--   officer = only callers holding leave.approve or leave.manage (admin, discipline and officer-only codes)
-- Existing types stay 'member', so behaviour is unchanged until an administrator restricts a type.
-- Reads stay open to the tenant: members keep seeing the type on requests already made, and approvers,
-- limits and pay keep resolving labels. The rule is enforced where leave is requested (app.request_leave).

alter table public.leave_types
  add column audience text not null default 'member'
  constraint leave_types_audience_check check (audience in ('member', 'officer'));

-- May the caller request officer-only leave types?
create or replace function app.can_use_officer_leave() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission('leave.approve') or app.has_permission('leave.manage')
$$;
revoke execute on function app.can_use_officer_leave() from public, anon;
grant execute on function app.can_use_officer_leave() to authenticated, service_role;

-- Same as 20261124000018, plus: an officer-only type is "unknown" to callers who may not use it.
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
  where id = p_type and tenant_id = app.tenant_id() and archived_at is null
    and (audience = 'member' or app.can_use_officer_leave());
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
      raise exception 'insufficient balance: % h available, % h needed', trim_scale(round(v_balance - v_pending, 2)), trim_scale(v_hours);
    end if;
  end if;

  insert into public.leave_requests (tenant_id, member_id, leave_type_id, start_date, end_date, hours, reason)
  values (app.tenant_id(), v_member, p_type, p_start, p_end, v_hours, nullif(trim(p_reason), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.request_leave(uuid, date, date, text) from public, anon;
grant execute on function app.request_leave(uuid, date, date, text) to authenticated;
