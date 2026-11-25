-- Training (Phase 4b), part 3: optional roster assignments, compliance inputs and the reminder log.

-- Roster link ------------------------------------------------------------------------------------------------
create table public.training_session_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null,
  assignment_id uuid not null,
  created_at timestamptz not null default now(),
  unique (assignment_id),
  foreign key (tenant_id, session_id) references public.training_sessions(tenant_id, id),
  foreign key (tenant_id, assignment_id) references public.shift_assignments(tenant_id, id)
);
create index training_session_assignments_session_idx on public.training_session_assignments (session_id);

create trigger forbid_mutation before update or delete on public.training_session_assignments for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.training_session_assignments for each statement execute function app.forbid_mutation();
revoke insert, update, delete, truncate on public.training_session_assignments from authenticated, anon;
alter table public.training_session_assignments enable row level security;
create policy training_read on public.training_session_assignments for select to authenticated
  using (tenant_id = app.tenant_id() and app.training_can_see_roster(session_id));
create trigger audit after insert or update or delete on public.training_session_assignments for each row execute function app.audit_trigger();

-- Put enrolled members on the roster as seatless training assignments. The roster's own overlap constraint decides
-- conflicts: a member who is already scheduled is skipped with a reason, never overridden.
create or replace function app.schedule_training_assignments(p_session uuid, p_members uuid[], p_during tstzrange default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.training_sessions;
  v_during tstzrange;
  v_member uuid;
  v_id uuid;
  v_created uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id();
  if s.id is null then raise exception 'unknown training session'; end if;
  if not app.training_can_manage(p_session) then raise exception 'not allowed: you cannot manage training at this unit'; end if;
  if not app.has_permission_dept('scheduling.roster.edit') then raise exception 'not allowed: scheduling.roster.edit required to use the roster'; end if;
  if s.status <> 'scheduled' then raise exception 'Only a scheduled session can be put on the roster'; end if;
  v_during := coalesce(p_during, tstzrange(s.starts_at, s.ends_at));
  if isempty(v_during) then raise exception 'The roster time is empty'; end if;

  foreach v_member in array coalesce(p_members, '{}') loop
    if not exists (select 1 from public.training_enrollments e where e.session_id = p_session and e.member_id = v_member and e.status = 'enrolled') then
      v_skipped := v_skipped || jsonb_build_object('member_id', v_member, 'reason', 'Not enrolled in this session');
      continue;
    end if;
    if exists (select 1 from public.training_session_assignments l
               join public.shift_assignments a on a.id = l.assignment_id
               where l.session_id = p_session and a.member_id = v_member and a.status = 'scheduled') then
      v_skipped := v_skipped || jsonb_build_object('member_id', v_member, 'reason', 'Already on the roster for this session');
      continue;
    end if;
    begin
      insert into public.shift_assignments (tenant_id, member_id, seat_id, during, type, source, explain)
      values (app.tenant_id(), v_member, null, v_during, 'training', 'manual',
              jsonb_build_array(jsonb_build_object('rule', 'training.session', 'message', 'Training: ' || s.title,
                                                   'data', jsonb_build_object('session_id', p_session))))
      returning id into v_id;
      insert into public.training_session_assignments (tenant_id, session_id, assignment_id) values (app.tenant_id(), p_session, v_id);
      v_created := v_created || v_id;
    exception when exclusion_violation then
      v_skipped := v_skipped || jsonb_build_object('member_id', v_member, 'reason', 'Already scheduled during that time');
    end;
  end loop;
  return jsonb_build_object('created', to_jsonb(v_created), 'skipped', v_skipped);
end $$;
revoke execute on function app.schedule_training_assignments(uuid, uuid[], tstzrange) from public, anon;
grant execute on function app.schedule_training_assignments(uuid, uuid[], tstzrange) to authenticated;

-- Cancelling a session or withdrawing now also cancels that session's own scheduled roster rows (nothing else).
create or replace function app.cancel_training_session(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; v_member uuid; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id() for update;
  if s.id is null then raise exception 'unknown training session'; end if;
  if not app.training_can_manage(p_session) then raise exception 'not allowed: you cannot manage training at this unit'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain why the session is cancelled (at least 5 characters)'; end if;
  if s.status not in ('draft', 'scheduled') then raise exception 'That session can no longer be cancelled'; end if;
  update public.training_sessions set status = 'cancelled', cancelled_reason = v_reason where id = p_session;
  update public.shift_assignments a set status = 'cancelled', cancelled_reason = 'Training session cancelled'
   where a.status = 'scheduled' and a.id in (select l.assignment_id from public.training_session_assignments l where l.session_id = p_session);
  for v_member in select member_id from public.training_enrollments where session_id = p_session and status in ('enrolled', 'waitlisted') loop
    perform app.notify_internal(v_member, 'training', 'Training cancelled: ' || s.title, v_reason, '/training/' || p_session);
  end loop;
end $$;

create or replace function app.withdraw_training(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.training_sessions;
  me uuid := app.my_member_id();
  e public.training_enrollments;
  v_next public.training_enrollments;
begin
  if me is null then raise exception 'not a member of this department'; end if;
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id() for update;
  if s.id is null then raise exception 'unknown training session'; end if;
  if s.starts_at <= now() then raise exception 'That session has already started'; end if;
  select * into e from public.training_enrollments where session_id = p_session and member_id = me and status in ('enrolled', 'waitlisted') for update;
  if e.id is null then raise exception 'You are not signed up for that session'; end if;
  update public.training_enrollments set status = 'withdrawn' where id = e.id;
  update public.shift_assignments a set status = 'cancelled', cancelled_reason = 'Withdrew from training'
   where a.status = 'scheduled' and a.member_id = me
     and a.id in (select l.assignment_id from public.training_session_assignments l where l.session_id = p_session);
  if e.status = 'enrolled' and s.status = 'scheduled'
     and (s.capacity is null or (select count(*) from public.training_enrollments x where x.session_id = p_session and x.status = 'enrolled') < s.capacity) then
    select * into v_next from public.training_enrollments x where x.session_id = p_session and x.status = 'waitlisted'
      order by x.queued_at, x.id limit 1 for update;
    if v_next.id is not null then
      update public.training_enrollments set status = 'enrolled' where id = v_next.id;
      perform app.notify_internal(v_next.member_id, 'training', 'You are in: ' || s.title,
        'A place opened up for ' || app.training_when(s) || '.', '/training/' || p_session);
    end if;
  end if;
end $$;

-- Compliance inputs ---------------------------------------------------------------------------------------------
-- May the caller see this member's training compliance? Themselves, department-wide viewers, or viewers at the unit
-- where the member is primarily assigned.
create or replace function app.training_can_view_member(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_member = app.my_member_id()
      or app.has_permission_dept('training.compliance.view')
      or exists (select 1 from public.member_assignments a
                 where a.member_id = p_member and a.tenant_id = app.tenant_id() and a.is_primary and a.effective @> current_date
                   and app.has_permission_at('training.compliance.view', a.org_unit_id))
$$;
revoke execute on function app.training_can_view_member(uuid) from public, anon;
grant execute on function app.training_can_view_member(uuid) to authenticated, service_role;

-- Members the caller may see (optionally only those primarily assigned under a unit), with rank and current role ids.
create or replace function app.training_compliance_members(p_unit uuid default null)
returns table (member_id uuid, name text, rank_id uuid, role_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select m.id, m.last_name || ', ' || m.first_name, m.rank_id,
         coalesce((select array_agg(distinct g.role_id) from public.role_grants g where g.member_id = m.id and g.valid @> now()), '{}')
  from public.members m
  where m.tenant_id = app.tenant_id() and m.status <> 'separated' and app.training_can_view_member(m.id)
    and (p_unit is null or exists (select 1 from public.member_assignments a
                                   join public.org_units ou on ou.id = a.org_unit_id
                                   join public.org_units root on root.id = p_unit
                                   where a.member_id = m.id and a.is_primary and a.effective @> current_date
                                     and ou.path operator(extensions.<@) root.path))
  order by m.last_name, m.first_name
$$;
revoke execute on function app.training_compliance_members(uuid) from public, anon;
grant execute on function app.training_compliance_members(uuid) to authenticated;

-- Hours earned by those members (only members the caller may see are returned).
create or replace function app.training_compliance_hours(p_members uuid[])
returns table (member_id uuid, category_id uuid, credited_on date, hours numeric)
language sql stable security definer set search_path = '' as $$
  select h.member_id, h.category_id, h.credited_on, h.hours
  from public.training_hours h
  where h.tenant_id = app.tenant_id() and h.member_id = any (p_members) and app.training_can_view_member(h.member_id)
$$;
revoke execute on function app.training_compliance_hours(uuid[]) from public, anon;
grant execute on function app.training_compliance_hours(uuid[]) to authenticated;

-- Reminder log (written by the worker) -----------------------------------------------------------------------------
create table public.training_reminder_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  kind text not null check (kind in ('requirement', 'session', 'digest')),
  ref_id uuid not null,                   -- requirement id, session id, or (digest) the officer's member id
  level text not null,                    -- due_soon / overdue / 24h / the digest date
  window_end date,
  sent_at timestamptz not null default now(),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
create unique index training_reminder_once on public.training_reminder_log
  (tenant_id, member_id, kind, ref_id, level, coalesce(window_end, '0001-01-01'::date));

revoke insert, update, delete, truncate on public.training_reminder_log from authenticated, anon;
alter table public.training_reminder_log enable row level security;
create policy training_read on public.training_reminder_log for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('training.compliance.view'));
create trigger audit after insert or update or delete on public.training_reminder_log for each row execute function app.audit_trigger();
