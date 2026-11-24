-- Per-tenant custom field registry. Values live in each entity's `custom` jsonb column.

create table public.custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity text not null check (entity in ('member','org_unit')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  type text not null check (type in ('text','long_text','number','integer','boolean','date','select','multi_select','email','phone')),
  options jsonb,
  required boolean not null default false,
  sensitivity text check (sensitivity in ('PHI','HR','MEDICAL','CJI')),
  sort int not null default 0,
  archived_at timestamptz,
  unique (tenant_id, entity, key)
);

alter table public.custom_field_defs enable row level security;
create policy tenant_read on public.custom_field_defs for select to authenticated
  using (tenant_id = app.tenant_id());
create policy tenant_write on public.custom_field_defs for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('admin.custom_fields.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission('admin.custom_fields.manage'));

create trigger audit after insert or update or delete on public.custom_field_defs
  for each row execute function app.audit_trigger();
