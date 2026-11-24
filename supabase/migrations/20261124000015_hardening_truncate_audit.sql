-- Hardening after Task 6 review.

-- 1. TRUNCATE bypasses RLS: client roles must never hold it on public tables.
do $$
declare r record;
begin
  for r in select c.oid::regclass as tbl from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('revoke truncate on table %s from anon, authenticated', r.tbl);
  end loop;
end $$;
-- Future tables created by the migration role. (supabase_admin's defaults cannot be
-- altered from here: postgres is not a member of supabase_admin; app tables are owned by postgres.)
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;

-- 2. Audit: seat_requirements has no id; record the seat it belongs to.
create or replace function app.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after  jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row    jsonb := coalesce(v_after, v_before);
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_after) k
    where v_after -> k is distinct from v_before -> k;
    if v_changed is null then
      return null; -- no-op update
    end if;
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, table_name, record_id, action, before, after, changed_fields, reason)
  values (
    coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid end),
    auth.uid(),
    tg_table_name,
    coalesce((v_row ->> 'id')::uuid,
             case when tg_table_name = 'seat_requirements' then (v_row ->> 'seat_id')::uuid end,
             (v_row ->> 'role_id')::uuid, (v_row ->> 'tenant_id')::uuid),
    lower(tg_op),
    v_before,
    v_after,
    v_changed,
    nullif(current_setting('app.reason', true), '')
  );
  return null;
end $$;

-- 3/4. shift_assignments: the override permission applies only when override_reason is
-- set or changed (so a plain roster editor can still cancel an overridden row), and
-- attribution/provenance columns cannot be spoofed.
drop policy tenant_insert on public.shift_assignments;
drop policy tenant_update on public.shift_assignments;
create policy tenant_insert on public.shift_assignments for insert to authenticated
  with check (tenant_id = app.tenant_id() and app.can_write_assignment('scheduling.roster.edit', seat_id));
create policy tenant_update on public.shift_assignments for update to authenticated
  using (tenant_id = app.tenant_id() and app.can_write_assignment('scheduling.roster.edit', seat_id))
  with check (tenant_id = app.tenant_id() and app.can_write_assignment('scheduling.roster.edit', seat_id));

create or replace function app.shift_assignments_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  elsif auth.uid() is not null then
    -- Provenance is frozen for end users only; service/superuser contexts (auth.uid() null),
    -- e.g. regeneration or data repair, may still correct these columns.
    new.created_by := old.created_by;
    new.source := old.source;
    new.pattern_version := old.pattern_version;
  end if;

  -- An override must be (re)approved when it is set, changed, or the overridden assignment
  -- moves to a different member, seat or time. Status-only changes (cancel) need roster.edit only.
  if auth.uid() is not null
     and new.override_reason is not null
     and (tg_op = 'INSERT'
          or new.override_reason is distinct from old.override_reason
          or (new.member_id, new.seat_id, new.during) is distinct from (old.member_id, old.seat_id, old.during))
     and not app.can_write_assignment('scheduling.qualification.override', new.seat_id) then
    raise exception 'qualification override requires permission';
  end if;
  return new;
end $$;
create trigger shift_assignments_guard before insert or update on public.shift_assignments
  for each row execute function app.shift_assignments_guard();
