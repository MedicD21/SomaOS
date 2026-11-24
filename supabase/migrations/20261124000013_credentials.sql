-- Credentials: tenant-defined credential types and per-member credentials.
-- Documents attach via the existing attachments table (entity = 'member_credential').

create table public.credential_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  validity jsonb not null,
  warn_days int[] not null default '{90,60,30,7}',
  status text not null default 'active' check (status in ('active','archived')),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create table public.member_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  type_id uuid not null,
  number text,
  issued_on date not null,
  expires_on date, -- null = non-expiring; computed by the app via credentialExpiry
  last_warned_days int,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, type_id) references public.credential_types(tenant_id, id)
);
create index member_credentials_member_idx on public.member_credentials (tenant_id, member_id);
create index member_credentials_expiry_idx on public.member_credentials (tenant_id, expires_on) where status = 'active';

alter table public.credential_types enable row level security;
alter table public.member_credentials enable row level security;

create policy tenant_read on public.credential_types for select to authenticated
  using (tenant_id = app.tenant_id());
create policy tenant_write on public.credential_types for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('scheduling.config.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission_dept('scheduling.config.manage'));

create policy member_read on public.member_credentials for select to authenticated
  using (tenant_id = app.tenant_id()
         and (member_id = app.my_member_id() or app.has_permission('credentials.view')));
create policy tenant_write on public.member_credentials for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission('credentials.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission('credentials.manage'));

create trigger audit after insert or update or delete on public.credential_types
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.member_credentials
  for each row execute function app.audit_trigger();

-- Lets schedulers check qualifications without HR read access to member_credentials.
create or replace function app.member_qualifications(p_members uuid[])
returns table (member_id uuid, type_id uuid, type_label text, expires_on date)
language sql stable security definer set search_path = '' as $$
  select c.member_id, c.type_id, t.label, c.expires_on
  from public.member_credentials c
  join public.credential_types t on t.tenant_id = c.tenant_id and t.id = c.type_id
  where app.has_permission('scheduling.roster.view')
    and c.tenant_id = app.tenant_id()
    and c.member_id = any (p_members)
    and c.status = 'active'
$$;
revoke execute on function app.member_qualifications(uuid[]) from public, anon;
grant execute on function app.member_qualifications(uuid[]) to authenticated;
