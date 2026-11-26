-- Required reading: assign a published document version to an audience; members acknowledge (append-only);
-- daily reminders go through the notifications and jobs outbox. All writes through the functions below.

create table public.required_readings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null,
  version_id uuid not null,
  audience jsonb not null,                 -- {"all": true} or {"org_unit_ids": [...], "role_ids": [...]}
  due_on date,
  statement text not null check (length(trim(statement)) between 5 and 500),
  require_typed_name boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, document_id) references public.documents(tenant_id, id),
  foreign key (tenant_id, version_id) references public.document_versions(tenant_id, id)
);
create unique index required_readings_one_open on public.required_readings (version_id) where closed_at is null;

create table public.reading_assignees (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reading_id uuid not null,
  member_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (reading_id, member_id),
  foreign key (tenant_id, reading_id) references public.required_readings(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
create index reading_assignees_member_idx on public.reading_assignees (tenant_id, member_id);

create table public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reading_id uuid not null,
  member_id uuid not null,
  version_id uuid not null,                -- the published version the member acknowledged
  acknowledged_at timestamptz not null default now(),
  statement_text text not null,
  method text not null check (method in ('click', 'typed_name')),
  typed_name text,
  ack_hash text not null,
  unique (reading_id, member_id),
  foreign key (tenant_id, reading_id) references public.required_readings(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, version_id) references public.document_versions(tenant_id, id)
);

create table public.reading_reminders (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reading_id uuid not null,
  member_id uuid not null,
  sent_on date not null,
  kind text not null check (kind in ('assigned', 'before_7', 'due', 'overdue')),
  created_at timestamptz not null default now(),
  primary key (reading_id, member_id, kind, sent_on),
  foreign key (tenant_id, reading_id) references public.required_readings(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);

-- Insert-only: acknowledgements, assignees and reminders never change; a reading only ever gets closed.
create or replace function app.insert_only_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger append_only before update or delete on public.acknowledgements
  for each row execute function app.insert_only_guard();
create trigger append_only before update or delete on public.reading_assignees
  for each row execute function app.insert_only_guard();
create trigger append_only before update or delete on public.reading_reminders
  for each row execute function app.insert_only_guard();

create or replace function app.required_reading_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'required_readings is append-only'; end if;
  if (new.id, new.tenant_id, new.document_id, new.version_id, new.audience, new.due_on, new.statement, new.require_typed_name, new.created_at)
     is distinct from (old.id, old.tenant_id, old.document_id, old.version_id, old.audience, old.due_on, old.statement, old.require_typed_name, old.created_at)
     or old.closed_at is not null then
    raise exception 'required_readings is append-only';
  end if;
  return new;
end $$;
create trigger required_reading_guard before update or delete on public.required_readings
  for each row execute function app.required_reading_guard();

revoke insert, update, delete, truncate on public.required_readings, public.reading_assignees, public.acknowledgements, public.reading_reminders
  from authenticated, anon;

-- Members an audience resolves to: active members matching everyone, a unit (and its sub-units) or a current role grant.
create or replace function app.resolve_audience(p_tenant uuid, p_audience jsonb) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.members m
  where m.tenant_id = p_tenant and m.status <> 'separated'
    and (
      coalesce((p_audience->>'all')::boolean, false)
      or exists (
        select 1 from public.member_assignments a
        join public.org_units ou on ou.id = a.org_unit_id
        join public.org_units tgt on tgt.tenant_id = p_tenant
          and tgt.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_audience->'org_unit_ids', '[]'::jsonb)) x)
        where a.member_id = m.id and a.is_primary and a.effective @> current_date and ou.path operator(extensions.<@) tgt.path)
      or exists (
        select 1 from public.role_grants g
        where g.member_id = m.id and g.valid @> now()
          and g.role_id in (select x::uuid from jsonb_array_elements_text(coalesce(p_audience->'role_ids', '[]'::jsonb)) x))
    )
$$;
revoke execute on function app.resolve_audience(uuid, jsonb) from public, anon, authenticated;

create or replace function app.sha256_hex(p text) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
grant execute on function app.sha256_hex(text) to authenticated, service_role;

create or replace function app.is_assignee(p_reading uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reading_assignees a
                 where a.reading_id = p_reading and a.tenant_id = app.tenant_id() and a.member_id = app.my_member_id())
$$;
revoke execute on function app.is_assignee(uuid) from public, anon;
grant execute on function app.is_assignee(uuid) to authenticated, service_role;

create or replace function app.can_report_member(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_member = app.my_member_id() or app.grant_covers_member('sog.report', p_member) or app.has_permission_dept('sog.assign')
$$;
revoke execute on function app.can_report_member(uuid) from public, anon;
grant execute on function app.can_report_member(uuid) to authenticated, service_role;

alter table public.required_readings enable row level security;
alter table public.reading_assignees enable row level security;
alter table public.acknowledgements enable row level security;
alter table public.reading_reminders enable row level security;
create policy reading_read on public.required_readings for select to authenticated
  using (tenant_id = app.tenant_id()
         and (app.is_assignee(id) or app.has_permission('sog.report') or app.has_permission_dept('sog.assign')));
create policy assignee_read on public.reading_assignees for select to authenticated
  using (tenant_id = app.tenant_id() and app.can_report_member(member_id));
create policy reminder_read on public.reading_reminders for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('sog.assign'));
create policy ack_read on public.acknowledgements for select to authenticated
  using (tenant_id = app.tenant_id() and app.can_report_member(member_id));

create trigger audit after insert or update or delete on public.required_readings
  for each row execute function app.audit_trigger();
create trigger audit after insert on public.acknowledgements
  for each row execute function app.audit_trigger();

create view public.reading_status with (security_invoker = true) as
  select r.id as reading_id, r.tenant_id, r.document_id, r.version_id, r.due_on, a.member_id,
         k.acknowledged_at, (k.id is null and r.closed_at is null and r.due_on < app.today()) as overdue
  from public.required_readings r
  join public.reading_assignees a on a.reading_id = r.id
  left join public.acknowledgements k on k.reading_id = r.id and k.member_id = a.member_id;
grant select on public.reading_status to authenticated, service_role;

-- Internal: create a reading, its assignees and the "assigned" notification. Callers check permission.
create or replace function app.create_reading(p_tenant uuid, p_version uuid, p_audience jsonb, p_due_on date, p_statement text, p_require_typed boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ver public.document_versions;
  v_doc public.documents;
  v_id uuid;
  v_today date;
  v_member uuid;
begin
  select * into v_ver from public.document_versions where id = p_version and tenant_id = p_tenant;
  select * into v_doc from public.documents where id = v_ver.document_id;
  select (now() at time zone t.timezone)::date into v_today from public.tenants t where t.id = p_tenant;
  insert into public.required_readings (tenant_id, document_id, version_id, audience, due_on, statement, require_typed_name)
  values (p_tenant, v_ver.document_id, p_version, p_audience, coalesce(p_due_on, v_today + 14),
          coalesce(nullif(trim(coalesce(p_statement, '')), ''), 'I have read and understand this document.'), coalesce(p_require_typed, false))
  returning id into v_id;
  insert into public.reading_assignees (tenant_id, reading_id, member_id)
  select p_tenant, v_id, m from app.resolve_audience(p_tenant, p_audience) m;
  for v_member in select member_id from public.reading_assignees where reading_id = v_id loop
    insert into public.reading_reminders (tenant_id, reading_id, member_id, sent_on, kind) values (p_tenant, v_id, v_member, v_today, 'assigned');
    perform app.notify_internal(v_member, 'reading-assigned', 'New required reading: ' || v_doc.title,
      'Please read ' || v_doc.title || ' (' || v_ver.label || ') and acknowledge it.', '/sogs');
  end loop;
  return v_id;
end $$;
revoke execute on function app.create_reading(uuid, uuid, jsonb, date, text, boolean) from public, anon, authenticated;

create or replace function app.assign_reading(p_version uuid, p_audience jsonb, p_due_on date, p_statement text, p_require_typed boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_ver public.document_versions;
  v_today date := app.today();
begin
  if not app.has_permission_dept('sog.assign') then raise exception 'not allowed: sog.assign required'; end if;
  select * into v_ver from public.document_versions where id = p_version and tenant_id = v_tenant;
  if v_ver.id is null then raise exception 'unknown version'; end if;
  if v_ver.status <> 'published' then raise exception 'Only a published version can be assigned'; end if;
  if p_audience is null or jsonb_typeof(p_audience) <> 'object'
     or not (coalesce((p_audience->>'all')::boolean, false)
             or jsonb_array_length(coalesce(p_audience->'org_unit_ids', '[]'::jsonb)) > 0
             or jsonb_array_length(coalesce(p_audience->'role_ids', '[]'::jsonb)) > 0) then
    raise exception 'Choose who should read it';
  end if;
  if not exists (select 1 from app.resolve_audience(v_tenant, p_audience)) then raise exception 'No active members match that audience'; end if;
  if p_due_on is not null and p_due_on < v_today then raise exception 'The due date cannot be in the past'; end if;
  if exists (select 1 from public.required_readings where version_id = p_version and closed_at is null) then
    raise exception 'That version already has an open reading';
  end if;
  return app.create_reading(v_tenant, p_version, p_audience, p_due_on, p_statement, p_require_typed);
end $$;
revoke execute on function app.assign_reading(uuid, jsonb, date, text, boolean) from public, anon;
grant execute on function app.assign_reading(uuid, jsonb, date, text, boolean) to authenticated;

create or replace function app.close_reading(p_reading uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_permission_dept('sog.assign') then raise exception 'not allowed: sog.assign required'; end if;
  update public.required_readings set closed_at = now() where id = p_reading and tenant_id = app.tenant_id() and closed_at is null;
  if not found then raise exception 'unknown reading'; end if;
end $$;
revoke execute on function app.close_reading(uuid) from public, anon;
grant execute on function app.close_reading(uuid) to authenticated;

-- A major version replaces the previous version's open reading with a new one for the same audience.
create or replace function app.reopen_reading_for_version(p_prev uuid, p_new uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.required_readings;
  v_tenant uuid;
begin
  select * into v_prev from public.required_readings where version_id = p_prev order by created_at desc limit 1;
  if v_prev.id is null then return null; end if;
  v_tenant := v_prev.tenant_id;
  update public.required_readings set closed_at = now() where version_id = p_prev and closed_at is null;
  return app.create_reading(v_tenant, p_new, v_prev.audience, null, v_prev.statement, v_prev.require_typed_name);
end $$;
revoke execute on function app.reopen_reading_for_version(uuid, uuid) from public, anon, authenticated;

create or replace function app.acknowledge_reading(p_reading uuid, p_typed_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_me public.members;
  v_r public.required_readings;
  v_rv public.document_versions;
  v_current uuid;
  v_typed text := nullif(trim(coalesce(p_typed_name, '')), '');
  v_method text := 'click';
  v_at timestamptz := now();
  v_id uuid := gen_random_uuid();
begin
  if not app.has_permission('sog.acknowledge') then raise exception 'not allowed: sog.acknowledge required'; end if;
  select * into v_me from public.members where id = app.my_member_id() and tenant_id = v_tenant;
  if v_me.id is null then raise exception 'not a member of this department'; end if;
  select * into v_r from public.required_readings where id = p_reading and tenant_id = v_tenant;
  if v_r.id is null or not exists (select 1 from public.reading_assignees where reading_id = p_reading and member_id = v_me.id) then
    raise exception 'That reading is not assigned to you';
  end if;
  if exists (select 1 from public.acknowledgements where reading_id = p_reading and member_id = v_me.id) then
    raise exception 'You have already acknowledged this reading';
  end if;
  if v_r.closed_at is not null then raise exception 'That reading is closed'; end if;
  select * into v_rv from public.document_versions where id = v_r.version_id;
  select id into v_current from public.document_versions where document_id = v_r.document_id and status = 'published';
  if v_current is null or exists (select 1 from public.document_versions v where v.document_id = v_r.document_id
                                    and v.version_no > v_rv.version_no and v.status in ('published', 'superseded') and v.major) then
    raise exception 'A newer version was published; read that instead';
  end if;
  if v_r.require_typed_name then
    if v_typed is null or lower(v_typed) <> lower(v_me.first_name || ' ' || v_me.last_name) then
      raise exception 'Type your full name exactly as it appears on your member record';
    end if;
    v_method := 'typed_name';
  end if;
  insert into public.acknowledgements (id, tenant_id, reading_id, member_id, version_id, acknowledged_at, statement_text, method, typed_name, ack_hash)
  values (v_id, v_tenant, p_reading, v_me.id, v_current, v_at, v_r.statement, v_method, case when v_method = 'typed_name' then v_typed end,
          app.sha256_hex(concat_ws('|', v_tenant, p_reading, v_current, v_me.id,
                                   to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), v_r.statement)));
  return v_id;
end $$;
revoke execute on function app.acknowledge_reading(uuid, text) from public, anon;
grant execute on function app.acknowledge_reading(uuid, text) to authenticated;

-- Adds members who joined the audience after assignment (nothing is ever removed). Internal.
create or replace function app.sync_reading_assignees(p_reading uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_r public.required_readings; v_n int;
begin
  select * into v_r from public.required_readings where id = p_reading and closed_at is null;
  if v_r.id is null then return 0; end if;
  insert into public.reading_assignees (tenant_id, reading_id, member_id)
  select v_r.tenant_id, v_r.id, m from app.resolve_audience(v_r.tenant_id, v_r.audience) m
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function app.sync_reading_assignees(uuid) from public, anon, authenticated;

-- Daily job: reminders at assignment, 7 days before due, on the due date, then every 7 days overdue. Each is logged once per
-- (reading, member, kind, day), so a rerun never double-sends; acknowledged and separated members get none.
-- Callable by the service role (all departments) or a department-wide sog.assign holder (their department).
create or replace function app.send_reading_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_r record;
  v_a record;
  v_today date;
  v_kind text;
  v_sent int := 0;
  v_rows int;
  v_title text;
begin
  if auth.uid() is not null and not app.has_permission_dept('sog.assign') then raise exception 'not allowed: sog.assign required'; end if;
  for v_r in select r.*, d.title, v.label from public.required_readings r
             join public.documents d on d.id = r.document_id
             join public.document_versions v on v.id = r.version_id
             where r.closed_at is null and v.status = 'published'
               and (auth.uid() is null or r.tenant_id = app.tenant_id()) loop
    perform app.sync_reading_assignees(v_r.id);
    select (now() at time zone t.timezone)::date into v_today from public.tenants t where t.id = v_r.tenant_id;
    for v_a in select a.member_id from public.reading_assignees a
               join public.members m on m.id = a.member_id and m.status <> 'separated'
               where a.reading_id = v_r.id
                 and not exists (select 1 from public.acknowledgements k where k.reading_id = v_r.id and k.member_id = a.member_id) loop
      v_kind := null;
      if not exists (select 1 from public.reading_reminders x where x.reading_id = v_r.id and x.member_id = v_a.member_id and x.kind = 'assigned') then
        v_kind := 'assigned';
      elsif v_r.due_on is not null and v_r.due_on - v_today = 7 then v_kind := 'before_7';
      elsif v_r.due_on is not null and v_r.due_on = v_today then v_kind := 'due';
      elsif v_r.due_on is not null and v_today > v_r.due_on
            and not exists (select 1 from public.reading_reminders x where x.reading_id = v_r.id and x.member_id = v_a.member_id
                            and x.kind = 'overdue' and x.sent_on > v_today - 7) then v_kind := 'overdue';
      end if;
      continue when v_kind is null;
      insert into public.reading_reminders (tenant_id, reading_id, member_id, sent_on, kind)
      values (v_r.tenant_id, v_r.id, v_a.member_id, v_today, v_kind) on conflict do nothing;
      get diagnostics v_rows = row_count;
      continue when v_rows = 0;
      v_title := case v_kind
        when 'assigned' then 'New required reading: ' || v_r.title
        when 'before_7' then 'Required reading due in 7 days: ' || v_r.title
        when 'due' then 'Required reading due today: ' || v_r.title
        else 'Required reading is overdue: ' || v_r.title end;
      perform app.notify_internal(v_a.member_id, 'reading-reminder', v_title,
        'Please read ' || v_r.title || ' (' || v_r.label || ') and acknowledge it.', '/sogs');
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end $$;
revoke execute on function app.send_reading_reminders() from public, anon;
grant execute on function app.send_reading_reminders() to authenticated, service_role;
