-- Scheduling: seats (with credential requirements), standing seat assignments and
-- concrete shift assignments with database-enforced double-booking protection.

create table public.seats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  org_unit_id uuid not null,
  label text not null,
  sort int not null default 0,
  required boolean not null default true,
  min_rank_id uuid,
  acting_allowed boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  unique (tenant_id, id),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, min_rank_id) references public.ranks(tenant_id, id)
);
create index seats_org_unit_idx on public.seats (tenant_id, org_unit_id);

-- Rows sharing a group_no are any-of; distinct groups are all-of.
create table public.seat_requirements (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  seat_id uuid not null,
  group_no int not null,
  credential_type_id uuid not null,
  primary key (seat_id, group_no, credential_type_id),
  foreign key (tenant_id, seat_id) references public.seats(tenant_id, id) on delete cascade,
  foreign key (tenant_id, credential_type_id) references public.credential_types(tenant_id, id)
);

create table public.standing_seats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  seat_id uuid not null,
  platoon_shift_id uuid not null,
  kelly_group int check (kelly_group between 0 and 29),
  effective daterange not null check (not isempty(effective)),
  unique (tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, seat_id) references public.seats(tenant_id, id),
  foreign key (tenant_id, platoon_shift_id) references public.shifts(tenant_id, id),
  constraint standing_seats_member_no_overlap
    exclude using gist (member_id with =, effective with &&)
);
create index standing_seats_seat_idx on public.standing_seats (tenant_id, seat_id);

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  seat_id uuid,
  during tstzrange not null check (not isempty(during)),
  type text not null check (type in ('regular','overtime','trade','holdover','callback','acting',
                                     'training','detail','kelly')),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  source text not null check (source in ('generated','manual')),
  pattern_version int,
  acting boolean not null default false,
  override_reason text,
  explain jsonb not null default '[]',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_reason text,
  unique (tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, seat_id) references public.seats(tenant_id, id),
  -- Kelly days carry no seat; every other type needs one, except training/detail (off-seat work).
  constraint shift_assignments_seat_shape check ((type = 'kelly') = (seat_id is null) or type in ('training','detail')),
  -- A kelly day does not occupy the member (they may pick up overtime on it).
  constraint shift_assignments_member_no_overlap
    exclude using gist (member_id with =, during with &&) where (status = 'scheduled' and type <> 'kelly'),
  constraint shift_assignments_seat_no_overlap
    exclude using gist (seat_id with =, during with &&) where (status = 'scheduled' and seat_id is not null)
);
-- Idempotent generation; includes cancelled rows so regeneration does not resurrect them.
create unique index shift_assignments_generated_key on public.shift_assignments (member_id, lower(during))
  where source = 'generated';
create index shift_assignments_tenant_during_idx on public.shift_assignments using gist (tenant_id, during);

-- Scope-aware permission check (F3): true when the caller holds `perm` department-wide or
-- through an org_unit grant whose subtree contains p_org_unit. Shift restrictions are
-- enforced by the application, not here.
create or replace function app.has_permission_at(perm text, p_org_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from app.my_grants() g
    join public.org_units ou on ou.id = p_org_unit and ou.tenant_id = app.tenant_id()
    where g.permission = perm
      and (g.scope_kind = 'department'
           or (g.scope_kind = 'org_unit'
               and ou.path operator(extensions.<@) g.scope_path::extensions.ltree)))
$$;
revoke execute on function app.has_permission_at(text, uuid) from public, anon;
grant execute on function app.has_permission_at(text, uuid) to authenticated, service_role;

create or replace function app.seat_org_unit(p_seat uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.org_unit_id from public.seats s where s.id = p_seat and s.tenant_id = app.tenant_id()
$$;
revoke execute on function app.seat_org_unit(uuid) from public, anon;
grant execute on function app.seat_org_unit(uuid) to authenticated, service_role;

-- Roster write check for one row: seat rows need scope over the seat's station; seatless
-- rows (kelly, off-seat training/detail) need department scope.
create or replace function app.can_write_assignment(perm text, p_seat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_seat is null then app.has_permission_dept(perm)
              else app.has_permission_at(perm, app.seat_org_unit(p_seat)) end
$$;
revoke execute on function app.can_write_assignment(text, uuid) from public, anon;
grant execute on function app.can_write_assignment(text, uuid) to authenticated, service_role;

alter table public.seats enable row level security;
alter table public.seat_requirements enable row level security;
alter table public.standing_seats enable row level security;
alter table public.shift_assignments enable row level security;

-- Config tables: tenant read; department-wide scheduling.config.manage to write.
do $$
declare t text;
begin
  foreach t in array array['seats','seat_requirements','standing_seats'] loop
    execute format('create policy tenant_read on public.%I for select to authenticated
                    using (tenant_id = app.tenant_id())', t);
    execute format('create policy tenant_insert on public.%I for insert to authenticated
                    with check (tenant_id = app.tenant_id() and app.has_permission_dept(%L))',
                   t, 'scheduling.config.manage');
    execute format('create policy tenant_update on public.%I for update to authenticated
                    using (tenant_id = app.tenant_id() and app.has_permission_dept(%L))
                    with check (tenant_id = app.tenant_id() and app.has_permission_dept(%L))',
                   t, 'scheduling.config.manage', 'scheduling.config.manage');
  end loop;
end $$;
-- Requirement rows are replaced when an admin edits a seat's requirements.
create policy tenant_delete on public.seat_requirements for delete to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('scheduling.config.manage'));

create policy tenant_read on public.shift_assignments for select to authenticated
  using (tenant_id = app.tenant_id());
create policy tenant_insert on public.shift_assignments for insert to authenticated
  with check (tenant_id = app.tenant_id()
              and app.can_write_assignment('scheduling.roster.edit', seat_id)
              and (override_reason is null
                   or app.can_write_assignment('scheduling.qualification.override', seat_id)));
create policy tenant_update on public.shift_assignments for update to authenticated
  using (tenant_id = app.tenant_id() and app.can_write_assignment('scheduling.roster.edit', seat_id))
  with check (tenant_id = app.tenant_id()
              and app.can_write_assignment('scheduling.roster.edit', seat_id)
              and (override_reason is null
                   or app.can_write_assignment('scheduling.qualification.override', seat_id)));

-- No hard deletes: archive seats, end standing seats, cancel assignments.
revoke delete on public.seats, public.standing_seats, public.shift_assignments from authenticated;
revoke truncate on public.seats, public.seat_requirements, public.standing_seats, public.shift_assignments
  from authenticated, anon;

create trigger audit after insert or update or delete on public.seats
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.seat_requirements
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.standing_seats
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.shift_assignments
  for each row execute function app.audit_trigger();
