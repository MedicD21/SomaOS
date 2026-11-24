-- In-app notifications, per-member channel preferences, a background job outbox,
-- and member invitations.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
create index notifications_member_idx on public.notifications (member_id, created_at desc);

alter table public.notifications enable row level security;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy own_read on public.notifications for select to authenticated
  using (tenant_id = app.tenant_id() and member_id = app.my_member_id());
create policy own_mark_read on public.notifications for update to authenticated
  using (tenant_id = app.tenant_id() and member_id = app.my_member_id());

create table public.notification_prefs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  kind text not null,
  channels text[] not null check (channels <@ array['in_app','email']),
  primary key (member_id, kind),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade
);
alter table public.notification_prefs enable row level security;
create policy own_prefs on public.notification_prefs for all to authenticated
  using (tenant_id = app.tenant_id() and member_id = app.my_member_id())
  with check (tenant_id = app.tenant_id() and member_id = app.my_member_id());

-- Job outbox processed by apps/worker. Not visible to tenants at all.
create table public.jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_pending_idx on public.jobs (run_after) where status = 'pending';
alter table public.jobs enable row level security;
revoke all on public.jobs from authenticated, anon;

-- Notify a member (in-app, plus email job when enabled and an address is known).
create or replace function app.notify(p_member uuid, p_kind text, p_title text, p_body text, p_link text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_channels text[];
  v_email text;
  v_id uuid;
begin
  select * into v_member from public.members where id = p_member;
  if v_member.id is null or (app.tenant_id() is not null and v_member.tenant_id <> app.tenant_id()) then
    raise exception 'unknown member';
  end if;
  if auth.uid() is not null and p_member is distinct from app.my_member_id()
     and not app.has_permission('notifications.send') then
    raise exception 'not allowed: notifications.send required';
  end if;

  insert into public.notifications (tenant_id, member_id, kind, title, body, link)
  values (v_member.tenant_id, p_member, p_kind, p_title, p_body, p_link) returning id into v_id;

  select channels into v_channels from public.notification_prefs where member_id = p_member and kind = p_kind;
  v_channels := coalesce(v_channels, array['in_app','email']);
  v_email := coalesce(v_member.email, (select u.email from auth.users u where u.id = v_member.user_id));
  if 'email' = any(v_channels) and v_email is not null then
    insert into public.jobs (tenant_id, kind, payload)
    values (v_member.tenant_id, 'send-email',
            jsonb_build_object('to', v_email, 'subject', p_title, 'text', coalesce(p_body, '') ||
              case when p_link is not null then E'\n\n' || p_link else '' end));
  end if;
  return v_id;
end $$;
revoke execute on function app.notify(uuid, text, text, text, text) from public, anon;
grant execute on function app.notify(uuid, text, text, text, text) to authenticated, service_role;

-- Queue a sign-in invitation for a member (worker sends it via Supabase Auth).
create or replace function app.enqueue_invite(p_member uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_id bigint;
begin
  if not app.has_permission('admin.members.manage') then
    raise exception 'not allowed: admin.members.manage required';
  end if;
  select * into v_member from public.members where id = p_member and tenant_id = app.tenant_id();
  if v_member.id is null then raise exception 'unknown member'; end if;
  if v_member.email is null then raise exception 'member has no email address'; end if;
  insert into public.jobs (tenant_id, kind, payload)
  values (v_member.tenant_id, 'invite-member',
          jsonb_build_object('tenant_id', v_member.tenant_id, 'member_id', v_member.id, 'email', v_member.email))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.enqueue_invite(uuid) from public, anon;
grant execute on function app.enqueue_invite(uuid) to authenticated;

-- Called after sign-in: activates the caller's pending invitations.
create or replace function app.accept_invites()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  update public.memberships set status = 'active' where user_id = auth.uid() and status = 'invited';
  get diagnostics v_count = row_count;
  update public.profiles p set active_tenant_id = (
      select m.tenant_id from public.memberships m where m.user_id = auth.uid() and m.status = 'active' order by m.created_at limit 1)
    where p.user_id = auth.uid() and p.active_tenant_id is null;
  return v_count;
end $$;
revoke execute on function app.accept_invites() from public, anon;
grant execute on function app.accept_invites() to authenticated;
