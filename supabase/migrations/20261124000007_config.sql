-- Versioned, effective-dated configuration documents (pay rules, accrual policies, etc.).

create table public.config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  key text not null,
  version int not null,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  effective tstzrange not null,
  payload jsonb not null,
  change_note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  unique (tenant_id, kind, key, version),
  constraint config_versions_no_overlap
    exclude using gist (tenant_id with =, kind with =, key with =, effective with &&) where (status = 'approved')
);

alter table public.config_versions enable row level security;
create policy tenant_read on public.config_versions for select to authenticated
  using (tenant_id = app.tenant_id());
create policy tenant_write on public.config_versions for insert to authenticated
  with check (tenant_id = app.tenant_id() and (status = 'draft' or app.has_permission('admin.config.manage')));
create policy tenant_update on public.config_versions for update to authenticated
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id() and (status = 'draft' or app.has_permission('admin.config.manage')));

create or replace function app.config_versions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('approved','retired') and (new.payload is distinct from old.payload
      or new.kind is distinct from old.kind or new.key is distinct from old.key
      or new.version is distinct from old.version or lower(new.effective) is distinct from lower(old.effective)) then
    raise exception 'approved config is immutable; create a new version';
  end if;
  if new.status = 'approved' and old.status = 'draft' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end $$;
create trigger config_versions_guard before update on public.config_versions
  for each row execute function app.config_versions_guard();

create trigger audit after insert or update or delete on public.config_versions
  for each row execute function app.audit_trigger();
