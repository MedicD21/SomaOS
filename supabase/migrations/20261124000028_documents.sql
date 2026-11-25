-- Document library: folders (with an optional view permission), documents (SOGs and policies are documents with a
-- kind), and immutable versions that point at one attachment. Writes only through the functions below.

create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  view_permission text check (view_permission is null or view_permission ~ '^[a-z_]+\.[a-z_.]+$'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, parent_id) references public.document_folders(tenant_id, id),
  check (parent_id is distinct from id)
);
create unique index document_folders_name_key on public.document_folders
  (tenant_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  folder_id uuid not null,
  kind text not null default 'document' check (kind in ('document', 'sog', 'policy')),
  title text not null check (length(trim(title)) between 1 and 200),
  number text check (number is null or length(number) <= 40),
  owner_member_id uuid,
  requires_ack boolean not null default false,
  review_every_months int check (review_every_months is null or review_every_months between 1 and 120),
  archived_at timestamptz,
  archived_reason text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, folder_id) references public.document_folders(tenant_id, id),
  foreign key (tenant_id, owner_member_id) references public.members(tenant_id, id)
);
create unique index documents_number_key on public.documents (tenant_id, lower(number)) where number is not null;
create index documents_folder_idx on public.documents (tenant_id, folder_id);

create table public.document_versions (
  id uuid primary key,                      -- the id used in the attachment's entity_id
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null,
  version_no int not null check (version_no > 0),
  label text not null check (length(trim(label)) between 1 and 40),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  attachment_id uuid not null,
  change_note text check (change_note is null or length(change_note) <= 500),
  effective_from date,
  major boolean not null default false,     -- chosen by the publisher; major versions re-require acknowledgement
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  superseded_at timestamptz,
  superseded_by uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (document_id, version_no),
  unique (attachment_id),
  foreign key (tenant_id, document_id) references public.documents(tenant_id, id)
);
create unique index document_versions_one_published on public.document_versions (document_id) where status = 'published';

-- Versions are immutable except for forward status moves and their dates; never deleted.
create or replace function app.document_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'document versions are never deleted'; end if;
  if (new.id, new.tenant_id, new.document_id, new.version_no, new.label, new.attachment_id, new.change_note, new.created_at)
     is distinct from (old.id, old.tenant_id, old.document_id, old.version_no, old.label, old.attachment_id, old.change_note, old.created_at) then
    raise exception 'a document version cannot be edited; add a new version instead';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status = 'published') or (old.status = 'published' and new.status = 'superseded')) then
    raise exception 'invalid document version status change';
  end if;
  if old.status <> 'draft'
     and (new.effective_from is distinct from old.effective_from or new.published_at is distinct from old.published_at
          or new.published_by is distinct from old.published_by or new.major is distinct from old.major) then
    raise exception 'a published version cannot be changed';
  end if;
  if old.status = 'superseded' then raise exception 'a superseded version cannot be changed'; end if;
  return new;
end $$;
create trigger document_version_guard before update or delete on public.document_versions
  for each row execute function app.document_version_guard();

revoke insert, update, delete, truncate on public.document_folders, public.documents, public.document_versions from authenticated, anon;

-- A folder is visible when it and every ancestor either has no view permission or the caller holds it
-- department-wide; documents.manage sees everything. Archived folders stay readable.
create or replace function app.can_view_folder(p_folder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission_dept('documents.manage')
      or (app.has_permission('documents.view')
          and not exists (
            with recursive up as (
              select f.id, f.parent_id, f.view_permission from public.document_folders f
              where f.id = p_folder and f.tenant_id = app.tenant_id()
              union all
              select f.id, f.parent_id, f.view_permission from public.document_folders f join up on f.id = up.parent_id
            )
            select 1 from up where up.view_permission is not null and not app.has_permission_dept(up.view_permission)))
$$;
revoke execute on function app.can_view_folder(uuid) from public, anon;
grant execute on function app.can_view_folder(uuid) to authenticated, service_role;

create or replace function app.can_view_document(p_document uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documents d where d.id = p_document and d.tenant_id = app.tenant_id()
                 and app.can_view_folder(d.folder_id))
$$;
revoke execute on function app.can_view_document(uuid) from public, anon;
grant execute on function app.can_view_document(uuid) to authenticated, service_role;

alter table public.document_folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
create policy folder_read on public.document_folders for select to authenticated
  using (tenant_id = app.tenant_id() and app.can_view_folder(id));
create policy document_read on public.documents for select to authenticated
  using (tenant_id = app.tenant_id() and app.can_view_folder(folder_id));
create policy version_read on public.document_versions for select to authenticated
  using (tenant_id = app.tenant_id() and app.can_view_document(document_id)
         and (status <> 'draft' or app.has_permission_dept('documents.manage')));

create trigger audit after insert or update or delete on public.document_folders
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.documents
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.document_versions
  for each row execute function app.audit_trigger();

-- Document files follow the version row's visibility (never widened by files.view alone). The uploader can see
-- their own file in the moment between upload and adding the version.
drop policy tenant_read on public.attachments;
create policy tenant_read on public.attachments for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('files.view')
         and (sensitivity is null
              or (entity = 'member_credential'
                  and exists (select 1 from public.member_credentials mc where mc.id = attachments.entity_id))
              or (entity <> 'member_credential' and app.has_permission_dept('admin.members.view')))
         and (entity <> 'document_version'
              or uploaded_by = auth.uid()
              or exists (select 1 from public.document_versions v where v.id = attachments.entity_id)));

-- The department's local date (tenant timezone).
create or replace function app.today() returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone t.timezone)::date from public.tenants t where t.id = app.tenant_id()
$$;
revoke execute on function app.today() from public, anon;
grant execute on function app.today() to authenticated, service_role;

-- Folders ----------------------------------------------------------------------------------------------
create or replace function app.save_folder(p_id uuid, p_parent uuid, p_name text, p_view_permission text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_name text := trim(coalesce(p_name, ''));
  v_perm text := nullif(trim(coalesce(p_view_permission, '')), '');
  v_id uuid := p_id;
begin
  if not app.has_permission_dept('documents.manage') then raise exception 'not allowed: documents.manage required'; end if;
  if length(v_name) = 0 then raise exception 'Enter a folder name'; end if;
  if p_parent is not null and not exists (select 1 from public.document_folders where id = p_parent and tenant_id = v_tenant) then
    raise exception 'unknown folder';
  end if;
  if v_id is null then
    insert into public.document_folders (tenant_id, parent_id, name, view_permission)
    values (v_tenant, p_parent, v_name, v_perm) returning id into v_id;
  else
    if not exists (select 1 from public.document_folders where id = v_id and tenant_id = v_tenant) then raise exception 'unknown folder'; end if;
    -- A folder cannot be moved under itself or one of its own sub-folders.
    if p_parent is not null and exists (
      with recursive up as (
        select f.id, f.parent_id from public.document_folders f where f.id = p_parent and f.tenant_id = v_tenant
        union all select f.id, f.parent_id from public.document_folders f join up on f.id = up.parent_id)
      select 1 from up where up.id = v_id) then
      raise exception 'A folder cannot be moved under itself';
    end if;
    update public.document_folders set parent_id = p_parent, name = v_name, view_permission = v_perm where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function app.save_folder(uuid, uuid, text, text) from public, anon;
grant execute on function app.save_folder(uuid, uuid, text, text) to authenticated;

-- Documents ---------------------------------------------------------------------------------------------
create or replace function app.create_document(p_folder uuid, p_kind text, p_title text, p_number text, p_requires_ack boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id uuid;
begin
  if not app.has_permission_dept('documents.manage') then raise exception 'not allowed: documents.manage required'; end if;
  if not exists (select 1 from public.document_folders where id = p_folder and tenant_id = v_tenant and archived_at is null) then
    raise exception 'unknown folder';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Enter a title'; end if;
  insert into public.documents (tenant_id, folder_id, kind, title, number, requires_ack, owner_member_id)
  values (v_tenant, p_folder, coalesce(p_kind, 'document'), trim(p_title), nullif(trim(coalesce(p_number, '')), ''),
          coalesce(p_requires_ack, false), app.my_member_id())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.create_document(uuid, text, text, text, boolean) from public, anon;
grant execute on function app.create_document(uuid, text, text, text, boolean) to authenticated;

-- Adds a draft version for a file already uploaded with entity 'document_version' (its entity_id becomes the version id).
create or replace function app.add_document_version(p_document uuid, p_attachment uuid, p_label text, p_change_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_doc public.documents;
  v_att public.attachments;
  v_no int;
begin
  if not app.has_permission_dept('documents.manage') then raise exception 'not allowed: documents.manage required'; end if;
  select * into v_doc from public.documents where id = p_document and tenant_id = v_tenant for update;
  if v_doc.id is null then raise exception 'unknown document'; end if;
  if v_doc.archived_at is not null then raise exception 'That document is archived'; end if;
  select * into v_att from public.attachments where id = p_attachment and tenant_id = v_tenant;
  if v_att.id is null or v_att.entity <> 'document_version' then raise exception 'Upload the file first'; end if;
  if exists (select 1 from public.document_versions where attachment_id = p_attachment or id = v_att.entity_id) then
    raise exception 'That file is already used by a version';
  end if;
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'Enter a version label, for example 2.0'; end if;
  select coalesce(max(version_no), 0) + 1 into v_no from public.document_versions where document_id = p_document;
  insert into public.document_versions (id, tenant_id, document_id, version_no, label, attachment_id, change_note)
  values (v_att.entity_id, v_tenant, p_document, v_no, trim(p_label), p_attachment, nullif(trim(coalesce(p_change_note, '')), ''));
  return v_att.entity_id;
end $$;
revoke execute on function app.add_document_version(uuid, uuid, text, text) from public, anon;
grant execute on function app.add_document_version(uuid, uuid, text, text) to authenticated;

-- Publishes a draft version: supersedes the previous published version in the same transaction. p_major
-- (the publisher's choice) re-requires acknowledgement when the document needs it.
create or replace function app.publish_document_version(p_version uuid, p_effective_from date, p_major boolean, p_backdate_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_ver public.document_versions;
  v_doc public.documents;
  v_today date := app.today();
  v_eff date;
  v_prev public.document_versions;
begin
  if not app.has_permission_dept('documents.publish') then raise exception 'not allowed: documents.publish required'; end if;
  select * into v_ver from public.document_versions where id = p_version and tenant_id = v_tenant;
  if v_ver.id is null then raise exception 'unknown version'; end if;
  -- Serialise publishes per document, then re-read the version under the lock.
  select * into v_doc from public.documents where id = v_ver.document_id for update;
  select * into v_ver from public.document_versions where id = p_version;
  if v_ver.status <> 'draft' then raise exception 'Only a draft version can be published'; end if;
  if v_doc.archived_at is not null then raise exception 'That document is archived'; end if;
  v_eff := coalesce(p_effective_from, v_today);
  if v_eff < v_today then
    if not app.has_permission_dept('documents.backdate') then raise exception 'not allowed: documents.backdate required for an earlier effective date'; end if;
    if length(trim(coalesce(p_backdate_reason, ''))) < 5 then raise exception 'Explain the earlier effective date (at least 5 characters)'; end if;
    perform set_config('app.reason', trim(p_backdate_reason), true);
  end if;

  select * into v_prev from public.document_versions where document_id = v_doc.id and status = 'published';
  if v_prev.id is not null then
    update public.document_versions set status = 'superseded', superseded_at = now(), superseded_by = auth.uid() where id = v_prev.id;
  end if;
  update public.document_versions
     set status = 'published', effective_from = v_eff, published_at = now(), published_by = auth.uid(), major = coalesce(p_major, false)
   where id = v_ver.id;

  -- A major version of a document that needs acknowledgement opens a new reading for the previous audience.
  if coalesce(p_major, false) and v_doc.requires_ack and v_prev.id is not null then
    perform app.reopen_reading_for_version(v_prev.id, v_ver.id);
  end if;
  return v_ver.id;
end $$;
revoke execute on function app.publish_document_version(uuid, date, boolean, text) from public, anon;
grant execute on function app.publish_document_version(uuid, date, boolean, text) to authenticated;

create or replace function app.archive_document(p_document uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not app.has_permission_dept('documents.manage') then raise exception 'not allowed: documents.manage required'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'Explain why it is archived (at least 5 characters)'; end if;
  update public.documents set archived_at = now(), archived_reason = v_reason
   where id = p_document and tenant_id = app.tenant_id() and archived_at is null;
  if not found then raise exception 'unknown document'; end if;
end $$;
revoke execute on function app.archive_document(uuid, text) from public, anon;
grant execute on function app.archive_document(uuid, text) to authenticated;

-- The published version per document (and any version taking effect later), as the caller can see it.
create view public.current_documents with (security_invoker = true) as
  select d.id as document_id, d.tenant_id, d.folder_id, d.kind, d.title, d.number, d.requires_ack,
         v.id as version_id, v.label, v.effective_from, v.attachment_id, v.published_at,
         (v.effective_from > app.today()) as upcoming
  from public.documents d
  join public.document_versions v on v.document_id = d.id and v.status = 'published'
  where d.archived_at is null;
grant select on public.current_documents to authenticated, service_role;
