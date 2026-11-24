-- Tenant-isolated file storage: private bucket, path prefix = tenant id, attachment index.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-files', 'tenant-files', false, 26214400, array[
  'application/pdf','image/png','image/jpeg','image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv','text/plain'])
on conflict (id) do nothing;

-- Object names: <tenant_id>/<entity>/<entity_id>/<uuid>-<file name>
create or replace function app.object_tenant(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;
grant execute on function app.object_tenant(text) to authenticated, service_role;

create policy tenant_files_read on storage.objects for select to authenticated
  using (bucket_id = 'tenant-files' and app.object_tenant(name) = app.tenant_id() and app.has_permission('files.view'));
create policy tenant_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-files' and app.object_tenant(name) = app.tenant_id() and app.has_permission('files.upload'));

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  object_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  sensitivity text check (sensitivity in ('PHI','HR','MEDICAL','CJI')),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  constraint attachments_path_in_tenant check (app.object_tenant(object_path) = tenant_id)
);
create index attachments_entity_idx on public.attachments (entity, entity_id);

alter table public.attachments enable row level security;
create policy tenant_read on public.attachments for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('files.view'));
create policy tenant_insert on public.attachments for insert to authenticated
  with check (tenant_id = app.tenant_id() and app.has_permission('files.upload'));
revoke update, delete on public.attachments from authenticated;

create trigger audit after insert or update or delete on public.attachments
  for each row execute function app.audit_trigger();
