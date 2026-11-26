-- Training (Phase 4b), part 2: class sessions, audience, sign-up, append-only attendance and credential awards.
-- Every write goes through the functions below. training_attendance and training_awards are insert-only
-- (a trigger rejects update, delete and truncate, even for the table owner). Hours are a view over attendance.

-- How long after a session ends attendance can still be corrected by officers (department-wide
-- training.attendance.manage can always correct, with a reason in the note).
create or replace function app.training_correction_days() returns int
language sql immutable set search_path = '' as $$ select 30 $$;
revoke execute on function app.training_correction_days() from public, anon;
grant execute on function app.training_correction_days() to authenticated, service_role;

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  course_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  org_unit_id uuid,                                   -- null = department-wide
  location_text text check (location_text is null or length(location_text) <= 200),
  instructor_member_id uuid,
  capacity int check (capacity is null or capacity >= 1),
  assigned_only boolean not null default false,
  duration_hours numeric(5,2) not null check (duration_hours > 0 and duration_hours <= 48),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'completed', 'cancelled')),
  cancelled_reason text,
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, id),
  foreign key (tenant_id, course_id) references public.training_courses(tenant_id, id),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, instructor_member_id) references public.members(tenant_id, id)
);
create index training_sessions_start_idx on public.training_sessions (tenant_id, starts_at);

create table public.training_audience_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null,
  kind text not null check (kind in ('role', 'rank', 'shift', 'org_unit', 'member')),
  ref_id uuid not null,
  unique (session_id, kind, ref_id),
  foreign key (tenant_id, session_id) references public.training_sessions(tenant_id, id)
);

create table public.training_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null,
  member_id uuid not null,
  source text not null check (source in ('required', 'signed_up', 'added')),
  status text not null default 'enrolled' check (status in ('enrolled', 'waitlisted', 'withdrawn')),
  queued_at timestamptz not null default clock_timestamp(),   -- order of the waitlist
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (session_id, member_id),
  foreign key (tenant_id, session_id) references public.training_sessions(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
create index training_enrollments_member_idx on public.training_enrollments (tenant_id, member_id);

create table public.training_attendance (
  seq bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enrollment_id uuid not null,
  session_id uuid not null,
  member_id uuid not null,
  status text not null check (status in ('attended', 'partial', 'absent', 'excused')),
  hours numeric(5,2) not null check (hours >= 0 and hours <= 48),
  note text check (note is null or length(note) <= 300),
  marked_by uuid default auth.uid() references auth.users(id) on delete set null,
  marked_at timestamptz not null default clock_timestamp(),
  supersedes_id uuid references public.training_attendance(id),
  check (status in ('attended', 'partial') or hours = 0),
  foreign key (tenant_id, enrollment_id) references public.training_enrollments(tenant_id, id),
  foreign key (tenant_id, session_id) references public.training_sessions(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id)
);
create index training_attendance_enrollment_idx on public.training_attendance (enrollment_id, seq desc);
create index training_attendance_member_idx on public.training_attendance (tenant_id, member_id);

create table public.training_awards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null,
  member_id uuid not null,
  credential_id uuid not null,
  kind text not null check (kind in ('granted', 'renewed')),
  awarded_by uuid default auth.uid() references auth.users(id) on delete set null,
  awarded_at timestamptz not null default now(),
  unique (session_id, member_id),
  foreign key (tenant_id, session_id) references public.training_sessions(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id),
  foreign key (tenant_id, credential_id) references public.member_credentials(tenant_id, id)
);

create trigger forbid_mutation before update or delete on public.training_attendance for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.training_attendance for each statement execute function app.forbid_mutation();
create trigger forbid_mutation before update or delete on public.training_awards for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.training_awards for each statement execute function app.forbid_mutation();

revoke insert, update, delete, truncate on public.training_sessions, public.training_audience_rules, public.training_enrollments,
  public.training_attendance, public.training_awards from authenticated, anon;

-- Permission helpers -----------------------------------------------------------------------------------------
-- The session's org unit is null for department-wide sessions (then department-wide grants are needed).
create or replace function app.training_can_manage(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.training_sessions s where s.id = p_session and s.tenant_id = app.tenant_id()
                 and app.has_permission_unit('training.session.manage', s.org_unit_id))
$$;
revoke execute on function app.training_can_manage(uuid) from public, anon;
grant execute on function app.training_can_manage(uuid) to authenticated, service_role;

-- May the caller see who is enrolled and their attendance? Managers, markers and compliance viewers at the unit,
-- and the assigned instructor.
create or replace function app.training_can_see_roster(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.training_sessions s
    where s.id = p_session and s.tenant_id = app.tenant_id()
      and (s.instructor_member_id = app.my_member_id()
           or app.has_permission_unit('training.session.manage', s.org_unit_id)
           or app.has_permission_unit('training.attendance.mark', s.org_unit_id)
           or app.has_permission_unit('training.attendance.manage', s.org_unit_id)
           or app.has_permission_unit('training.compliance.view', s.org_unit_id)))
$$;
revoke execute on function app.training_can_see_roster(uuid) from public, anon;
grant execute on function app.training_can_see_roster(uuid) to authenticated, service_role;

create or replace function app.training_can_mark(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.training_sessions s
    where s.id = p_session and s.tenant_id = app.tenant_id()
      and (s.instructor_member_id = app.my_member_id()
           or app.has_permission_unit('training.attendance.mark', s.org_unit_id)
           or app.has_permission_unit('training.attendance.manage', s.org_unit_id)))
$$;
revoke execute on function app.training_can_mark(uuid) from public, anon;
grant execute on function app.training_can_mark(uuid) to authenticated, service_role;

alter table public.training_sessions enable row level security;
alter table public.training_audience_rules enable row level security;
alter table public.training_enrollments enable row level security;
alter table public.training_attendance enable row level security;
alter table public.training_awards enable row level security;

-- Published sessions are readable department-wide (so members can sign up). Drafts are for managers at the unit and
-- the instructor only: members hold a department-wide view grant, so 'view' must not reveal drafts.
create policy training_read on public.training_sessions for select to authenticated
  using (tenant_id = app.tenant_id()
         and ((status <> 'draft' and app.has_permission('training.session.view'))
              or instructor_member_id = app.my_member_id()
              or app.has_permission_unit('training.session.manage', org_unit_id)));
create policy training_read on public.training_audience_rules for select to authenticated
  using (tenant_id = app.tenant_id() and app.training_can_see_roster(session_id));
create policy training_read on public.training_enrollments for select to authenticated
  using (tenant_id = app.tenant_id() and (member_id = app.my_member_id() or app.training_can_see_roster(session_id)));
create policy training_read on public.training_attendance for select to authenticated
  using (tenant_id = app.tenant_id() and (member_id = app.my_member_id() or app.training_can_see_roster(session_id)));
create policy training_read on public.training_awards for select to authenticated
  using (tenant_id = app.tenant_id() and (member_id = app.my_member_id() or app.training_can_see_roster(session_id)));

create trigger audit after insert or update or delete on public.training_sessions for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.training_audience_rules for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.training_enrollments for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.training_attendance for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.training_awards for each row execute function app.audit_trigger();

-- The newest attendance row per enrollment is the truth; earlier rows are history.
create view public.training_attendance_current with (security_invoker = true) as
  select distinct on (a.enrollment_id) a.*
  from public.training_attendance a
  order by a.enrollment_id, a.seq desc;

-- Hours earned, per attended or partial enrollment of a session that was not cancelled. Never cached.
create view public.training_hours with (security_invoker = true) as
  select a.tenant_id, a.member_id, c.category_id, a.session_id,
         (s.starts_at at time zone tn.timezone)::date as credited_on, a.hours
  from public.training_attendance_current a
  join public.training_sessions s on s.id = a.session_id
  join public.training_courses c on c.id = s.course_id
  join public.tenants tn on tn.id = a.tenant_id
  where a.status in ('attended', 'partial') and s.status <> 'cancelled';

grant select on public.training_attendance_current, public.training_hours to authenticated, service_role;

-- Internal helpers (not callable by API roles) -----------------------------------------------------------------
create or replace function app.training_when(p_session public.training_sessions) returns text
language sql stable security definer set search_path = '' as $$
  select to_char(p_session.starts_at at time zone t.timezone, 'Dy Mon DD HH24:MI') from public.tenants t where t.id = p_session.tenant_id
$$;
revoke execute on function app.training_when(public.training_sessions) from public, anon, authenticated;

create or replace function app.training_audience_ref_ok(p_kind text, p_ref uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'role' then exists (select 1 from public.roles r where r.id = p_ref and r.tenant_id = app.tenant_id())
    when 'rank' then exists (select 1 from public.ranks r where r.id = p_ref and r.tenant_id = app.tenant_id())
    when 'shift' then exists (select 1 from public.shifts r where r.id = p_ref and r.tenant_id = app.tenant_id())
    when 'org_unit' then exists (select 1 from public.org_units r where r.id = p_ref and r.tenant_id = app.tenant_id())
    when 'member' then exists (select 1 from public.members r where r.id = p_ref and r.tenant_id = app.tenant_id())
    else false end
$$;
revoke execute on function app.training_audience_ref_ok(text, uuid) from public, anon, authenticated;

-- Members who match any audience rule of the session right now (active members only).
create or replace function app.training_audience_members(p_session uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct m.id
  from public.training_audience_rules r
  join public.members m on m.tenant_id = r.tenant_id and m.status <> 'separated'
  where r.session_id = p_session and r.tenant_id = app.tenant_id()
    and (
      (r.kind = 'member' and m.id = r.ref_id)
      or (r.kind = 'rank' and m.rank_id = r.ref_id)
      or (r.kind = 'role' and exists (select 1 from public.role_grants g
                                       where g.member_id = m.id and g.role_id = r.ref_id and g.valid @> now()))
      or (r.kind = 'shift' and exists (select 1 from public.member_assignments a
                                        where a.member_id = m.id and a.is_primary and a.shift_id = r.ref_id and a.effective @> current_date))
      or (r.kind = 'org_unit' and exists (select 1 from public.member_assignments a
                                           join public.org_units ou on ou.id = a.org_unit_id
                                           join public.org_units root on root.id = r.ref_id
                                           where a.member_id = m.id and a.is_primary and a.effective @> current_date
                                             and ou.path operator(extensions.<@) root.path)))
$$;
revoke execute on function app.training_audience_members(uuid) from public, anon, authenticated;

-- Session functions ------------------------------------------------------------------------------------------
-- p_audience is [{kind, ref_id}]. The session starts as a draft.
create or replace function app.create_training_session(
  p_course uuid, p_title text, p_starts timestamptz, p_ends timestamptz, p_unit uuid, p_location text,
  p_instructor uuid, p_capacity int, p_assigned_only boolean, p_duration numeric, p_notes text, p_audience jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_rule record;
  v_course public.training_courses;
begin
  if not app.has_permission_unit('training.session.manage', p_unit) then
    raise exception 'not allowed: you cannot manage training at this unit';
  end if;
  select * into v_course from public.training_courses c where c.id = p_course and c.tenant_id = app.tenant_id();
  if v_course.id is null then raise exception 'unknown training course'; end if;
  if v_course.archived_at is not null then raise exception 'That training course is archived'; end if;
  if p_audience is not null and jsonb_typeof(p_audience) <> 'array' then raise exception 'the audience must be a list'; end if;

  insert into public.training_sessions (tenant_id, course_id, title, starts_at, ends_at, org_unit_id, location_text,
                                        instructor_member_id, capacity, assigned_only, duration_hours, notes)
  values (app.tenant_id(), p_course, trim(p_title), p_starts, p_ends, p_unit, nullif(trim(coalesce(p_location, '')), ''),
          p_instructor, p_capacity, coalesce(p_assigned_only, false), coalesce(p_duration, v_course.default_hours),
          nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;

  for v_rule in select e->>'kind' as kind, (e->>'ref_id')::uuid as ref_id from jsonb_array_elements(coalesce(p_audience, '[]'::jsonb)) e loop
    if not app.training_audience_ref_ok(v_rule.kind, v_rule.ref_id) then
      raise exception 'unknown audience entry';
    end if;
    insert into public.training_audience_rules (tenant_id, session_id, kind, ref_id)
    values (app.tenant_id(), v_id, v_rule.kind, v_rule.ref_id) on conflict do nothing;
  end loop;
  return v_id;
end $$;
revoke execute on function app.create_training_session(uuid, text, timestamptz, timestamptz, uuid, text, uuid, int, boolean, numeric, text, jsonb) from public, anon;
grant execute on function app.create_training_session(uuid, text, timestamptz, timestamptz, uuid, text, uuid, int, boolean, numeric, text, jsonb) to authenticated;

-- Enrol every audience member who is not already on the list. Returns how many were added.
create or replace function app.training_enrol_audience(p_session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  s public.training_sessions;
  v_member uuid;
  v_added int := 0;
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id();
  for v_member in select * from app.training_audience_members(p_session) loop
    insert into public.training_enrollments (tenant_id, session_id, member_id, source)
    values (app.tenant_id(), p_session, v_member, 'required') on conflict (session_id, member_id) do nothing;
    if found then
      v_added := v_added + 1;
      perform app.notify_internal(v_member, 'training', 'Required training: ' || s.title,
        'You are required to attend on ' || app.training_when(s) || '.', '/training/' || p_session);
    end if;
  end loop;
  return v_added;
end $$;
revoke execute on function app.training_enrol_audience(uuid) from public, anon, authenticated;

create or replace function app.publish_training_session(p_session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id() for update;
  if s.id is null then raise exception 'unknown training session'; end if;
  if not app.training_can_manage(p_session) then raise exception 'not allowed: you cannot manage training at this unit'; end if;
  if s.status <> 'draft' then raise exception 'Only a draft session can be published'; end if;
  if exists (select 1 from public.training_courses c where c.id = s.course_id and c.archived_at is not null) then
    raise exception 'That training course is archived';
  end if;
  update public.training_sessions set status = 'scheduled' where id = p_session;
  return app.training_enrol_audience(p_session);
end $$;
revoke execute on function app.publish_training_session(uuid) from public, anon;
grant execute on function app.publish_training_session(uuid) to authenticated;

-- Add anyone who now matches the audience; nobody is ever removed.
create or replace function app.refresh_training_required(p_session uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id();
  if s.id is null then raise exception 'unknown training session'; end if;
  if not app.training_can_manage(p_session) then raise exception 'not allowed: you cannot manage training at this unit'; end if;
  if s.status <> 'scheduled' then raise exception 'Only a scheduled session has a required list'; end if;
  return app.training_enrol_audience(p_session);
end $$;
revoke execute on function app.refresh_training_required(uuid) from public, anon;
grant execute on function app.refresh_training_required(uuid) to authenticated;

create or replace function app.reschedule_training_session(p_session uuid, p_starts timestamptz, p_ends timestamptz, p_location text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions; v_member uuid;
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id() for update;
  if s.id is null then raise exception 'unknown training session'; end if;
  if not app.training_can_manage(p_session) then raise exception 'not allowed: you cannot manage training at this unit'; end if;
  if s.status not in ('draft', 'scheduled') then raise exception 'That session can no longer be changed'; end if;
  if p_ends <= p_starts then raise exception 'The end must be after the start'; end if;
  update public.training_sessions set starts_at = p_starts, ends_at = p_ends, location_text = nullif(trim(coalesce(p_location, '')), '')
   where id = p_session returning * into s;
  if s.status = 'scheduled' then
    for v_member in select member_id from public.training_enrollments where session_id = p_session and status in ('enrolled', 'waitlisted') loop
      perform app.notify_internal(v_member, 'training', 'Training changed: ' || s.title,
        'It is now ' || app.training_when(s) || '.', '/training/' || p_session);
    end loop;
  end if;
end $$;
revoke execute on function app.reschedule_training_session(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function app.reschedule_training_session(uuid, timestamptz, timestamptz, text) to authenticated;

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
  for v_member in select member_id from public.training_enrollments where session_id = p_session and status in ('enrolled', 'waitlisted') loop
    perform app.notify_internal(v_member, 'training', 'Training cancelled: ' || s.title, v_reason, '/training/' || p_session);
  end loop;
end $$;
revoke execute on function app.cancel_training_session(uuid, text) from public, anon;
grant execute on function app.cancel_training_session(uuid, text) to authenticated;

-- Sign-up ------------------------------------------------------------------------------------------------------
-- Returns 'enrolled' or 'waitlisted'.
create or replace function app.sign_up_training(p_session uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.training_sessions;
  me uuid := app.my_member_id();
  e public.training_enrollments;
  v_status text;
begin
  if me is null then raise exception 'not a member of this department'; end if;
  if not app.has_permission('training.session.view') then raise exception 'not allowed: training.session.view required'; end if;
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id() for update;
  if s.id is null then raise exception 'unknown training session'; end if;
  if s.status <> 'scheduled' then raise exception 'That session is not open for sign-up'; end if;
  if s.assigned_only then raise exception 'That session is by assignment only'; end if;
  if s.starts_at <= now() then raise exception 'That session has already started'; end if;
  select * into e from public.training_enrollments where session_id = p_session and member_id = me;
  if e.id is not null and e.status <> 'withdrawn' then raise exception 'You are already signed up for that session'; end if;
  v_status := case when s.capacity is not null
                    and (select count(*) from public.training_enrollments x where x.session_id = p_session and x.status = 'enrolled') >= s.capacity
                   then 'waitlisted' else 'enrolled' end;
  if e.id is null then
    insert into public.training_enrollments (tenant_id, session_id, member_id, source, status)
    values (app.tenant_id(), p_session, me, 'signed_up', v_status);
  else
    update public.training_enrollments set status = v_status, source = 'signed_up', queued_at = clock_timestamp() where id = e.id;
  end if;
  return v_status;
end $$;
revoke execute on function app.sign_up_training(uuid) from public, anon;
grant execute on function app.sign_up_training(uuid) to authenticated;

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
revoke execute on function app.withdraw_training(uuid) from public, anon;
grant execute on function app.withdraw_training(uuid) to authenticated;

create or replace function app.add_training_attendee(p_session uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id();
  if s.id is null then raise exception 'unknown training session'; end if;
  if not app.training_can_manage(p_session) then raise exception 'not allowed: you cannot manage training at this unit'; end if;
  if s.status not in ('draft', 'scheduled', 'completed') then raise exception 'That session can no longer be changed'; end if;
  if not exists (select 1 from public.members m where m.id = p_member and m.tenant_id = app.tenant_id() and m.status <> 'separated') then
    raise exception 'unknown member';
  end if;
  insert into public.training_enrollments (tenant_id, session_id, member_id, source, status)
  values (app.tenant_id(), p_session, p_member, 'added', 'enrolled')
  on conflict (session_id, member_id) do update set status = 'enrolled' where public.training_enrollments.status <> 'enrolled';
end $$;
revoke execute on function app.add_training_attendee(uuid, uuid) from public, anon;
grant execute on function app.add_training_attendee(uuid, uuid) to authenticated;

-- Attendance (insert-only) ---------------------------------------------------------------------------------------
create or replace function app.mark_training_attendance(p_enrollment uuid, p_status text, p_hours numeric, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e public.training_enrollments;
  s public.training_sessions;
  me uuid := app.my_member_id();
  v_hours numeric;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_prev uuid;
  v_id uuid;
begin
  select * into e from public.training_enrollments where id = p_enrollment and tenant_id = app.tenant_id();
  if e.id is null then raise exception 'unknown enrollment'; end if;
  select * into s from public.training_sessions where id = e.session_id;
  if e.member_id = me and not app.has_permission_dept('training.attendance.manage') then
    raise exception 'not allowed: you cannot mark your own attendance';
  end if;
  if not app.training_can_mark(e.session_id) then raise exception 'not allowed: you cannot mark attendance for this session'; end if;
  if s.status not in ('scheduled', 'completed') then raise exception 'That session is not open for attendance'; end if;
  if e.status <> 'enrolled' then raise exception 'Only enrolled members can be marked'; end if;
  if s.starts_at > now() then raise exception 'The session has not started yet'; end if;
  if s.ends_at < now() - make_interval(days => app.training_correction_days()) and not app.has_permission_dept('training.attendance.manage') then
    raise exception 'The correction window for that session has closed';
  end if;
  if p_status not in ('attended', 'partial', 'absent', 'excused') then raise exception 'unknown attendance status'; end if;
  if p_status = 'attended' then
    v_hours := coalesce(p_hours, s.duration_hours);
  elsif p_status = 'partial' then
    if p_hours is null or p_hours <= 0 then raise exception 'Enter the hours attended for a partial attendance'; end if;
    if length(coalesce(v_note, '')) < 5 then raise exception 'Add a note explaining the partial attendance (at least 5 characters)'; end if;
    v_hours := p_hours;
  else
    v_hours := 0;
  end if;
  if v_hours > s.duration_hours then raise exception 'Hours cannot be more than the session length'; end if;

  select a.id into v_prev from public.training_attendance a where a.enrollment_id = p_enrollment order by a.seq desc limit 1;
  insert into public.training_attendance (tenant_id, enrollment_id, session_id, member_id, status, hours, note, supersedes_id)
  values (app.tenant_id(), p_enrollment, e.session_id, e.member_id, p_status, round(v_hours, 2), v_note, v_prev)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.mark_training_attendance(uuid, text, numeric, text) from public, anon;
grant execute on function app.mark_training_attendance(uuid, text, numeric, text) to authenticated;

-- Completion: mark the session done and grant or renew the course's credential for each qualifying attendee.
-- p_awards = [{member_id, issued_on, expires_on}], with expiry computed by the server from the credential type's
-- validity rule. Idempotent: a member already awarded for this session is skipped.
create or replace function app.complete_training_session(p_session uuid, p_awards jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.training_sessions;
  c public.training_courses;
  v_min numeric;
  a record;
  att record;
  v_kind text;
  v_cred uuid;
  v_done int := 0;
begin
  select * into s from public.training_sessions where id = p_session and tenant_id = app.tenant_id() for update;
  if s.id is null then raise exception 'unknown training session'; end if;
  if not app.training_can_manage(p_session) then raise exception 'not allowed: you cannot manage training at this unit'; end if;
  if s.status not in ('scheduled', 'completed') then raise exception 'Only a scheduled session can be completed'; end if;
  if s.starts_at > now() then raise exception 'The session has not started yet'; end if;
  select * into c from public.training_courses where id = s.course_id;

  if c.credential_type_id is not null and p_awards is not null and jsonb_typeof(p_awards) = 'array' and jsonb_array_length(p_awards) > 0 then
    if not app.has_permission_dept('credentials.manage') then raise exception 'not allowed: credentials.manage required to award credentials'; end if;
    v_min := (c.completion_rule->>'minHoursPct')::numeric / 100.0 * s.duration_hours;
    for a in select (e->>'member_id')::uuid as member_id, (e->>'issued_on')::date as issued_on, nullif(e->>'expires_on', '')::date as expires_on
             from jsonb_array_elements(p_awards) e loop
      continue when exists (select 1 from public.training_awards w where w.session_id = p_session and w.member_id = a.member_id);
      select cur.status, cur.hours into att from public.training_attendance_current cur where cur.session_id = p_session and cur.member_id = a.member_id;
      if att.status is null or att.status not in ('attended', 'partial') or att.hours < v_min then
        raise exception '% did not complete the required hours for this course',
          (select m.first_name || ' ' || m.last_name from public.members m where m.id = a.member_id);
      end if;
      if a.expires_on is not null and a.expires_on < a.issued_on then raise exception 'the expiry cannot be before the issue date'; end if;
      v_kind := case when exists (select 1 from public.member_credentials x where x.member_id = a.member_id and x.type_id = c.credential_type_id)
                     then 'renewed' else 'granted' end;
      insert into public.member_credentials (tenant_id, member_id, type_id, issued_on, expires_on)
      values (app.tenant_id(), a.member_id, c.credential_type_id, a.issued_on, a.expires_on) returning id into v_cred;
      insert into public.training_awards (tenant_id, session_id, member_id, credential_id, kind)
      values (app.tenant_id(), p_session, a.member_id, v_cred, v_kind);
      perform app.notify_internal(a.member_id, 'training', 'Credential ' || v_kind || ': ' || c.label,
        'Completed ' || s.title || '.', '/training/' || p_session);
      v_done := v_done + 1;
    end loop;
  end if;

  update public.training_sessions set status = 'completed' where id = p_session and status = 'scheduled';
  return v_done;
end $$;
revoke execute on function app.complete_training_session(uuid, jsonb) from public, anon;
grant execute on function app.complete_training_session(uuid, jsonb) to authenticated;
