-- Open shifts: an officer posts an unfilled seat and time; members claim it; an officer at that station
-- approves one claim, which creates the assignment. Writes only through the functions below, which check
-- scope in SQL; the roster's overlap constraints are the conflict check on approval.

create table public.open_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  seat_id uuid not null,
  during tstzrange not null check (not isempty(during)),
  type text not null check (type in ('regular', 'overtime')),
  reason text not null check (length(reason) >= 5),
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  filled_assignment_id uuid,
  cancelled_reason text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, seat_id) references public.seats(tenant_id, id),
  foreign key (tenant_id, filled_assignment_id) references public.shift_assignments(tenant_id, id),
  constraint open_shifts_seat_no_overlap exclude using gist (seat_id with =, during with &&) where (status = 'open')
);
create index open_shifts_tenant_idx on public.open_shifts (tenant_id, status);

create table public.open_shift_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  open_shift_id uuid not null,
  member_id uuid not null,
  note text check (note is null or length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn', 'superseded')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  override_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, open_shift_id) references public.open_shifts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
create unique index open_shift_claims_one_pending on public.open_shift_claims (open_shift_id, member_id) where status = 'pending';
create index open_shift_claims_member_idx on public.open_shift_claims (tenant_id, member_id, status);

revoke insert, update, delete, truncate on public.open_shifts, public.open_shift_claims from authenticated, anon;

create or replace function app.open_shift_seat(p_open uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select o.seat_id from public.open_shifts o where o.id = p_open and o.tenant_id = app.tenant_id()
$$;
revoke execute on function app.open_shift_seat(uuid) from public, anon;
grant execute on function app.open_shift_seat(uuid) to authenticated, service_role;

alter table public.open_shifts enable row level security;
alter table public.open_shift_claims enable row level security;
create policy open_read on public.open_shifts for select to authenticated
  using (tenant_id = app.tenant_id()
         and (app.has_permission('scheduling.openshift.claim') or app.can_write_assignment('scheduling.roster.edit', seat_id)));
create policy claim_read on public.open_shift_claims for select to authenticated
  using (tenant_id = app.tenant_id()
         and (member_id = app.my_member_id()
              or app.can_write_assignment('scheduling.roster.edit', app.open_shift_seat(open_shift_id))));

create trigger audit after insert or update or delete on public.open_shifts
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.open_shift_claims
  for each row execute function app.audit_trigger();

create or replace function app.post_open_shift(p_seat uuid, p_start timestamptz, p_end timestamptz, p_type text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_during tstzrange;
  v_id uuid;
begin
  if not app.can_write_assignment('scheduling.roster.edit', p_seat) then
    raise exception 'not in your scope: posting needs roster edit at that station';
  end if;
  if not exists (select 1 from public.seats s where s.id = p_seat and s.tenant_id = v_tenant and s.status = 'active') then
    raise exception 'That seat is not available';
  end if;
  if p_type is null or p_type not in ('regular', 'overtime') then raise exception 'Open shifts can only use the regular or overtime work type'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'The end must be after the start'; end if;
  if p_start <= now() then raise exception 'Only upcoming times can be posted'; end if;
  if p_end - p_start > interval '48 hours' then raise exception 'An open shift can be at most 48 hours'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain the open shift (at least 5 characters)'; end if;
  v_during := tstzrange(p_start, p_end);
  if exists (select 1 from public.shift_assignments a
             where a.seat_id = p_seat and a.status = 'scheduled' and a.during && v_during) then
    raise exception 'That seat is already filled for that time';
  end if;
  if exists (select 1 from public.open_shifts o where o.seat_id = p_seat and o.status = 'open' and o.during && v_during) then
    raise exception 'That seat and time is already posted as an open shift';
  end if;
  insert into public.open_shifts (tenant_id, seat_id, during, type, reason)
  values (v_tenant, p_seat, v_during, p_type, v_reason) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.post_open_shift(uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function app.post_open_shift(uuid, timestamptz, timestamptz, text, text) to authenticated;

create or replace function app.cancel_open_shift(p_open uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.open_shifts;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_c record;
begin
  select * into v_o from public.open_shifts where id = p_open and tenant_id = app.tenant_id() for update;
  if v_o.id is null then raise exception 'unknown open shift'; end if;
  if not app.can_write_assignment('scheduling.roster.edit', v_o.seat_id) then
    raise exception 'not in your scope: cancelling needs roster edit at that station';
  end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain the cancellation (at least 5 characters)'; end if;
  if v_o.status <> 'open' then raise exception 'That open shift is no longer open'; end if;
  update public.open_shifts set status = 'cancelled', cancelled_reason = v_reason, updated_at = now() where id = v_o.id;
  for v_c in select id, member_id from public.open_shift_claims where open_shift_id = v_o.id and status = 'pending' loop
    update public.open_shift_claims set status = 'withdrawn' where id = v_c.id;
    perform app.notify_internal(v_c.member_id, 'open_shift', 'Open shift cancelled', 'An open shift you claimed was cancelled.', '/open-shifts');
  end loop;
end $$;
revoke execute on function app.cancel_open_shift(uuid, text) from public, anon;
grant execute on function app.cancel_open_shift(uuid, text) to authenticated;

create or replace function app.claim_open_shift(p_open uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.my_member_id();
  v_o public.open_shifts;
  v_id uuid;
begin
  if not app.has_permission('scheduling.openshift.claim') then raise exception 'not allowed: scheduling.openshift.claim required'; end if;
  if v_me is null then raise exception 'not a member of this department'; end if;
  select * into v_o from public.open_shifts where id = p_open and tenant_id = app.tenant_id();
  if v_o.id is null or v_o.status <> 'open' or lower(v_o.during) <= now() then raise exception 'That open shift is no longer open'; end if;
  if exists (select 1 from public.shift_assignments a
             where a.member_id = v_me and a.status = 'scheduled' and a.type <> 'kelly' and a.during && v_o.during) then
    raise exception 'You are already scheduled during that time';
  end if;
  if exists (select 1 from public.open_shift_claims c where c.open_shift_id = p_open and c.member_id = v_me and c.status = 'pending') then
    raise exception 'You already have a claim on this shift';
  end if;
  insert into public.open_shift_claims (tenant_id, open_shift_id, member_id, note)
  values (v_o.tenant_id, p_open, v_me, nullif(trim(coalesce(p_note, '')), '')) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.claim_open_shift(uuid, text) from public, anon;
grant execute on function app.claim_open_shift(uuid, text) to authenticated;

create or replace function app.withdraw_claim(p_claim uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c public.open_shift_claims;
begin
  select * into v_c from public.open_shift_claims where id = p_claim and tenant_id = app.tenant_id() for update;
  if v_c.id is null then raise exception 'unknown claim'; end if;
  if v_c.member_id is distinct from app.my_member_id() then raise exception 'only the member who claimed it can withdraw the claim'; end if;
  if v_c.status <> 'pending' then raise exception 'This claim is already decided'; end if;
  update public.open_shift_claims set status = 'withdrawn' where id = v_c.id;
end $$;
revoke execute on function app.withdraw_claim(uuid) from public, anon;
grant execute on function app.withdraw_claim(uuid) to authenticated;

-- Approve (creating the assignment) or deny a claim. p_override waives a qualification block and needs
-- scheduling.qualification.override at the seat's unit; p_acting records that the claimant fills it as acting.
create or replace function app.decide_claim(p_claim uuid, p_approve boolean, p_note text, p_override text default null, p_acting boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.open_shift_claims;
  v_o public.open_shifts;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_override text := nullif(trim(coalesce(p_override, '')), '');
  v_asg uuid;
  v_other record;
begin
  select * into v_c from public.open_shift_claims where id = p_claim and tenant_id = app.tenant_id() for update;
  if v_c.id is null then raise exception 'unknown claim'; end if;
  select * into v_o from public.open_shifts where id = v_c.open_shift_id for update;
  if v_c.member_id is not distinct from app.my_member_id()
     or not app.can_write_assignment('scheduling.roster.edit', v_o.seat_id) then
    raise exception 'not in your scope: deciding needs roster edit at the station, and not for your own claim';
  end if;
  if v_c.status <> 'pending' then raise exception 'This claim is no longer pending'; end if;

  if not p_approve then
    update public.open_shift_claims set status = 'denied', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = v_c.id;
    perform app.notify_internal(v_c.member_id, 'open_shift', 'Open shift claim denied', 'Your claim on an open shift was not approved.', '/open-shifts');
    return;
  end if;

  if v_o.status <> 'open' or lower(v_o.during) <= now() then raise exception 'That open shift is no longer open'; end if;
  if v_override is not null then
    if length(v_override) < 5 then raise exception 'an override reason of at least 5 characters is required'; end if;
    if not app.can_write_assignment('scheduling.qualification.override', v_o.seat_id) then
      raise exception 'not in your scope: overriding needs qualification override at the station';
    end if;
  end if;

  insert into public.shift_assignments (tenant_id, member_id, seat_id, during, type, source, acting, override_reason, explain)
  values (v_o.tenant_id, v_c.member_id, v_o.seat_id, v_o.during, v_o.type, 'manual', coalesce(p_acting, false), v_override,
          jsonb_build_array(jsonb_build_object('rule', 'open_shift', 'message', 'Filled from an open shift')))
  returning id into v_asg;

  update public.open_shifts set status = 'filled', filled_assignment_id = v_asg, updated_at = now() where id = v_o.id;
  update public.open_shift_claims
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, override_reason = v_override
   where id = v_c.id;
  perform app.notify_internal(v_c.member_id, 'open_shift', 'Open shift claim approved', 'You were approved for an open shift. It is on your schedule.', '/schedule');
  for v_other in select id, member_id from public.open_shift_claims where open_shift_id = v_o.id and status = 'pending' and id <> v_c.id loop
    update public.open_shift_claims set status = 'superseded' where id = v_other.id;
    perform app.notify_internal(v_other.member_id, 'open_shift', 'Open shift filled', 'An open shift you claimed was filled by someone else.', '/open-shifts');
  end loop;
end $$;
revoke execute on function app.decide_claim(uuid, boolean, text, text, boolean) from public, anon;
grant execute on function app.decide_claim(uuid, boolean, text, text, boolean) to authenticated;
