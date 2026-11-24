-- Security hardening from the Phase 0 review.

-- F2: the tenant claim is honored only while the caller has an ACTIVE membership in an
-- ACTIVE tenant. A suspended/removed user with an unexpired JWT sees nothing.
create or replace function app.tenant_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.tenant_id
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
    and m.user_id = auth.uid()
    and m.status = 'active'
$$;

-- Separated members hold no grants.
create or replace function app.my_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.members m
  where m.tenant_id = app.tenant_id() and m.user_id = auth.uid() and m.status <> 'separated'
$$;

-- F3: database-side checks for department-wide administration require a
-- department-scoped, unrestricted grant.
create or replace function app.has_permission_dept(perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.my_grants() g
                 where g.permission = perm and g.scope_kind = 'department' and g.scope_shift_id is null)
$$;
grant execute on function app.has_permission_dept(text) to authenticated, service_role;

do $$
declare r record;
begin
  for r in select * from (values
      ('tenant_settings', 'admin.tenant.manage'),
      ('org_unit_types', 'admin.org.manage'),
      ('org_units', 'admin.org.manage'),
      ('ranks', 'admin.org.manage'),
      ('shifts', 'admin.org.manage'),
      ('members', 'admin.members.manage'),
      ('member_assignments', 'admin.members.manage'),
      ('roles', 'admin.roles.manage'),
      ('role_permissions', 'admin.roles.manage'),
      ('role_grants', 'admin.roles.manage'),
      ('custom_field_defs', 'admin.custom_fields.manage')
    ) as v(tbl, perm)
  loop
    execute format('drop policy tenant_write on public.%I', r.tbl);
    execute format('create policy tenant_write on public.%I for all to authenticated
                    using (tenant_id = app.tenant_id() and app.has_permission_dept(%L))
                    with check (tenant_id = app.tenant_id() and app.has_permission_dept(%L))', r.tbl, r.perm, r.perm);
  end loop;
end $$;

drop policy tenants_admin_update on public.tenants;
create policy tenants_admin_update on public.tenants for update to authenticated
  using (id = app.tenant_id() and app.has_permission_dept('admin.tenant.manage'))
  with check (id = app.tenant_id());

drop policy audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('admin.audit.view'));

-- F3: no privilege escalation — you can only hand out permissions you hold department-wide.
create or replace function app.guard_privilege_escalation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then
    return new; -- platform/service operations (onboarding, templates)
  end if;
  if new.tenant_id is distinct from app.tenant_id() then
    return new; -- cross-tenant writes are rejected by RLS
  end if;
  if tg_table_name = 'role_permissions' then
    if not app.has_permission_dept(new.permission) then
      raise exception 'cannot grant permissions you do not hold: %', new.permission;
    end if;
  elsif exists (select 1 from public.role_permissions rp
                where rp.role_id = new.role_id and not app.has_permission_dept(rp.permission)) then
    raise exception 'cannot grant permissions you do not hold';
  end if;
  return new;
end $$;
create trigger role_permissions_no_escalation before insert or update on public.role_permissions
  for each row execute function app.guard_privilege_escalation();
create trigger role_grants_no_escalation before insert or update on public.role_grants
  for each row execute function app.guard_privilege_escalation();

-- F4: approval is one-way (draft → approved → retired).
create or replace function app.config_versions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved' and new.status = 'draft' then
    raise exception 'cannot return approved config to draft; create a new version';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'retired config cannot be reactivated; create a new version';
  end if;
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

drop policy tenant_write on public.config_versions;
drop policy tenant_update on public.config_versions;
create policy tenant_write on public.config_versions for insert to authenticated
  with check (tenant_id = app.tenant_id() and (status = 'draft' or app.has_permission_dept('admin.config.manage')));
create policy tenant_update on public.config_versions for update to authenticated
  using (tenant_id = app.tenant_id() and (status = 'draft' or app.has_permission_dept('admin.config.manage')))
  with check (tenant_id = app.tenant_id() and (status = 'draft' or app.has_permission_dept('admin.config.manage')));

-- F5: crashed jobs are reclaimed.
alter table public.jobs add column locked_at timestamptz;

-- F1/F6: invitations are explicit records accepted by the owner of the verified email.
create table public.member_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  email text not null,
  invited_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
alter table public.member_invites enable row level security;
revoke insert, update, delete on public.member_invites from authenticated;
create policy tenant_admin_read on public.member_invites for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('admin.members.manage'));
create trigger audit after insert or update or delete on public.member_invites
  for each row execute function app.audit_trigger();

drop function app.enqueue_invite(uuid);
drop function app.accept_invites();

create or replace function app.enqueue_invite(p_member uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_tenant_name text;
  v_id uuid;
begin
  if not app.has_permission_dept('admin.members.manage') then
    raise exception 'not allowed: admin.members.manage required';
  end if;
  select * into v_member from public.members where id = p_member and tenant_id = app.tenant_id();
  if v_member.id is null then raise exception 'unknown member'; end if;
  if v_member.email is null then raise exception 'member has no email address'; end if;
  if v_member.user_id is not null then raise exception 'member already has a login'; end if;
  select name into v_tenant_name from public.tenants where id = v_member.tenant_id;
  insert into public.member_invites (tenant_id, member_id, email)
  values (v_member.tenant_id, v_member.id, lower(v_member.email)) returning id into v_id;
  insert into public.jobs (tenant_id, kind, payload)
  values (v_member.tenant_id, 'invite-member', jsonb_build_object(
    'invite_id', v_id, 'tenant_id', v_member.tenant_id, 'tenant_name', v_tenant_name, 'email', lower(v_member.email)));
  return v_id;
end $$;
revoke execute on function app.enqueue_invite(uuid) from public, anon;
grant execute on function app.enqueue_invite(uuid) to authenticated;

-- Pending invitations addressed to the caller's verified email.
create or replace function app.my_invites()
returns table (id uuid, tenant_id uuid, tenant_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.tenant_id, t.name, i.created_at
  from public.member_invites i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  join auth.users u on u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = i.email
  where i.accepted_at is null and i.expires_at > now()
  order by i.created_at
$$;
revoke execute on function app.my_invites() from public, anon;
grant execute on function app.my_invites() to authenticated;

-- The invitee explicitly accepts ONE invitation. Links the member record to them.
create or replace function app.accept_invite(p_invite uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv public.member_invites;
begin
  select i.* into v_inv from public.member_invites i
  join auth.users u on u.id = auth.uid() and u.email_confirmed_at is not null and lower(u.email) = i.email
  where i.id = p_invite and i.accepted_at is null and i.expires_at > now();
  if v_inv.id is null then raise exception 'invitation not found'; end if;
  if exists (select 1 from public.members where id = v_inv.member_id and user_id is not null and user_id <> auth.uid()) then
    raise exception 'invitation not found';
  end if;

  insert into public.memberships (tenant_id, user_id, status) values (v_inv.tenant_id, auth.uid(), 'active')
  on conflict (tenant_id, user_id) do update set status = 'active'
    where public.memberships.status in ('invited', 'removed');
  update public.members set user_id = auth.uid() where id = v_inv.member_id and user_id is null;
  update public.member_invites set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  update public.profiles set active_tenant_id = v_inv.tenant_id where user_id = auth.uid() and active_tenant_id is null;
  return v_inv.tenant_id;
end $$;
revoke execute on function app.accept_invite(uuid) from public, anon;
grant execute on function app.accept_invite(uuid) to authenticated;
