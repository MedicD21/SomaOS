-- Append-only audit log. Every tenant table attaches app.audit_trigger().

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid,                     -- no FK: audit rows outlive the records they describe
  occurred_at timestamptz not null default now(),
  actor_user_id uuid default auth.uid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert','update','delete')),
  before jsonb,
  after jsonb,
  changed_fields text[],
  reason text
);
create index audit_log_tenant_time_idx on public.audit_log (tenant_id, occurred_at desc);
create index audit_log_record_idx on public.audit_log (record_id);

alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('admin.audit.view'));

revoke insert, update, delete, truncate on public.audit_log from authenticated, service_role, anon;

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
    coalesce((v_row ->> 'id')::uuid, (v_row ->> 'role_id')::uuid, (v_row ->> 'tenant_id')::uuid),
    lower(tg_op),
    v_before,
    v_after,
    v_changed,
    nullif(current_setting('app.reason', true), '')
  );
  return null;
end $$;

-- Attach to all foundation tables.
do $$
declare t text;
begin
  foreach t in array array['tenants','tenant_settings','memberships','org_unit_types','org_units','ranks',
                           'shifts','members','member_assignments','roles','role_permissions','role_grants']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit_trigger()', t);
  end loop;
end $$;
