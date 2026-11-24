-- Task 11 review fixes.

-- A. Superseded generated shifts. When a pattern version or a standing seat changes, future
-- generated shifts are marked 'superseded' (not 'cancelled'): they release their
-- (member, start) generation slot so regeneration can recreate a shift with the same start.
-- User-cancelled generated rows keep blocking resurrection.
alter table public.shift_assignments drop constraint shift_assignments_status_check;
alter table public.shift_assignments add constraint shift_assignments_status_check
  check (status in ('scheduled','cancelled','superseded'));

drop index public.shift_assignments_generated_key;
create unique index shift_assignments_generated_key on public.shift_assignments (member_id, lower(during))
  where source = 'generated' and status <> 'superseded';

-- B. Sensitive attachments (e.g. HR credential documents) are visible only to callers who may
-- read the record they belong to, not to every files.view holder.
drop policy tenant_read on public.attachments;
create policy tenant_read on public.attachments for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('files.view')
         and (sensitivity is null
              -- runs under the caller's RLS: credentials.view (department) or the member's own record
              or (entity = 'member_credential'
                  and exists (select 1 from public.member_credentials mc where mc.id = attachments.entity_id))
              or (entity <> 'member_credential' and app.has_permission_dept('admin.members.view'))));

-- True when an attachments row records this object (ignores RLS; reveals existence only).
create or replace function app.attachment_recorded(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.attachments a where a.object_path = p_path)
$$;
revoke execute on function app.attachment_recorded(text) from public, anon;
grant execute on function app.attachment_recorded(text) to authenticated, service_role;

-- Objects are readable through their (RLS-checked) attachment row. The uploader may also see
-- their own object in the moment between the storage insert and the attachments insert.
drop policy tenant_files_read on storage.objects;
create policy tenant_files_read on storage.objects for select to authenticated
  using (bucket_id = 'tenant-files' and app.object_tenant(name) = app.tenant_id() and app.has_permission('files.view')
         and (exists (select 1 from public.attachments a where a.object_path = storage.objects.name)
              or (owner_id = auth.uid()::text and not app.attachment_recorded(name))));
