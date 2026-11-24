-- Actual time: hours worked beyond (or instead of) the schedule, recorded after the fact by an officer
-- covering the member, or by payroll. Entries are never edited: a mistake is voided and re-entered.

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  work_date date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 48),
  type text not null check (type in ('regular','overtime','trade','holdover','callback','acting','training','detail')),
  reason text not null check (length(reason) >= 5),
  status text not null default 'active' check (status in ('active', 'void')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  check ((status = 'void') = (voided_at is not null)),
  unique (tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
create index time_entries_member_idx on public.time_entries (tenant_id, member_id, work_date);
create index time_entries_date_idx on public.time_entries (tenant_id, work_date) where status = 'active';

revoke insert, update, delete, truncate on public.time_entries from authenticated, anon;

-- Does the caller hold p_perm with a grant covering this member's current station and shift?
-- Same rule as leave approval: department scope covers anyone; an org-unit grant covers the member's
-- primary assignment (else standing seat) inside that subtree; a shift-limited grant needs the same shift.
-- Nobody is covered by their own grant.
create or replace function app.grant_covers_member(p_perm text, p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_member is distinct from app.my_member_id()
    and exists (
      select 1
      from app.my_grants() g
      left join lateral (
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
      ) pa on true
      where g.permission = p_perm
        and (g.scope_shift_id is null or g.scope_shift_id = pa.shift_id)
        and (g.scope_kind = 'department'
             or (g.scope_kind = 'org_unit' and pa.path is not null
                 and pa.path operator(extensions.<@) g.scope_path::extensions.ltree)))
$$;
revoke execute on function app.grant_covers_member(text, uuid) from public, anon;
grant execute on function app.grant_covers_member(text, uuid) to authenticated, service_role;

-- May the caller record or void time for this member? Roster editors covering the member, or payroll
-- (department-wide pay.manage). Never for oneself.
create or replace function app.can_edit_time(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_member is distinct from app.my_member_id()
    and (app.grant_covers_member('scheduling.roster.edit', p_member) or app.has_permission_dept('pay.manage'))
$$;
revoke execute on function app.can_edit_time(uuid) from public, anon;
grant execute on function app.can_edit_time(uuid) to authenticated, service_role;

alter table public.time_entries enable row level security;
create policy time_read on public.time_entries for select to authenticated
  using (tenant_id = app.tenant_id()
         and (member_id = app.my_member_id() or app.can_view_pay() or app.can_edit_time(member_id)));

create trigger audit after insert or update or delete on public.time_entries
  for each row execute function app.audit_trigger();

create or replace function app.add_time_entry(p_member uuid, p_date date, p_hours numeric, p_type text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if not exists (select 1 from public.members m where m.id = p_member and m.tenant_id = app.tenant_id()) then
    raise exception 'unknown member';
  end if;
  if not app.can_edit_time(p_member) then raise exception 'not allowed: you cannot record time for this member'; end if;
  if p_date is null then raise exception 'choose the date worked'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 48 then raise exception 'hours must be more than 0 and at most 48'; end if;
  if p_type is null or p_type not in ('regular','overtime','trade','holdover','callback','acting','training','detail') then
    raise exception 'unknown work type';
  end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain the time (at least 5 characters)'; end if;
  if app.is_date_closed(p_date) then raise exception 'That pay period is closed'; end if;

  insert into public.time_entries (tenant_id, member_id, work_date, hours, type, reason)
  values (app.tenant_id(), p_member, p_date, round(p_hours, 2), p_type, v_reason) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.add_time_entry(uuid, date, numeric, text, text) from public, anon;
grant execute on function app.add_time_entry(uuid, date, numeric, text, text) to authenticated;

create or replace function app.void_time_entry(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_entry public.time_entries;
begin
  select * into v_entry from public.time_entries where id = p_id and tenant_id = app.tenant_id() for update;
  if not found then raise exception 'unknown time entry'; end if;
  if not app.can_edit_time(v_entry.member_id) then raise exception 'not allowed: you cannot change time for this member'; end if;
  if v_entry.status = 'void' then raise exception 'That time entry is already void'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain why the entry is void (at least 5 characters)'; end if;
  if app.is_date_closed(v_entry.work_date) then raise exception 'That pay period is closed'; end if;

  update public.time_entries
     set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason
   where id = v_entry.id;
end $$;
revoke execute on function app.void_time_entry(uuid, text) from public, anon;
grant execute on function app.void_time_entry(uuid, text) to authenticated;
