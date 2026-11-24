-- Leave: banks, leave types, requests, and an append-only balance ledger.
-- All writes to requests and the ledger go through scope-checking functions (next migration).

create table public.leave_banks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  archived_at timestamptz,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  bank_id uuid,                                   -- null = no balance (e.g. FMLA, bereavement)
  requires_documentation boolean not null default false,
  lead_time_days int not null default 0 check (lead_time_days >= 0),
  counts_as_worked boolean not null default false,
  sort int not null default 0,
  archived_at timestamptz,
  unique (tenant_id, key),
  unique (tenant_id, id),
  foreign key (tenant_id, bank_id) references public.leave_banks(tenant_id, id)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  leave_type_id uuid not null,
  start_date date not null,
  end_date date not null,
  hours numeric(8,2) not null check (hours > 0),
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled')),
  reason text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint leave_requests_dates_check check (end_date >= start_date),
  unique (tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, leave_type_id) references public.leave_types(tenant_id, id),
  constraint leave_requests_member_no_overlap
    exclude using gist (member_id with =, daterange(start_date, end_date, '[]') with &&)
    where (status in ('pending','approved'))
);
create index leave_requests_member_idx on public.leave_requests (tenant_id, member_id, start_date);

-- Balance = sum of the ledger. Entries are never edited: corrections are new rows.
create table public.leave_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null,
  bank_id uuid not null,
  kind text not null check (kind in ('earn','use','reversal','adjust','expire','payout')),
  hours numeric(8,2) not null check (hours <> 0),   -- signed: earn +, use -, reversal +, expire -
  effective_date date not null,
  run_key text,                                       -- idempotency key for automated postings
  request_id uuid,
  policy_version int,
  note text,
  explain jsonb not null default '[]',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id) on delete cascade,
  foreign key (tenant_id, bank_id) references public.leave_banks(tenant_id, id),
  foreign key (tenant_id, request_id) references public.leave_requests(tenant_id, id)
);
create unique index leave_ledger_run_key on public.leave_ledger (tenant_id, member_id, bank_id, run_key)
  where run_key is not null;
create index leave_ledger_member_idx on public.leave_ledger (tenant_id, member_id, bank_id);

-- Shifts freed by approved leave stay linked to the request so cancelling the leave can restore them.
alter table public.shift_assignments add column leave_request_id uuid;
alter table public.shift_assignments add foreign key (tenant_id, leave_request_id)
  references public.leave_requests(tenant_id, id);
create index shift_assignments_leave_idx on public.shift_assignments (leave_request_id) where leave_request_id is not null;

create view public.leave_balances with (security_invoker = true) as
  select tenant_id, member_id, bank_id, sum(hours)::numeric(10,2) as hours
  from public.leave_ledger group by tenant_id, member_id, bank_id;
grant select on public.leave_balances to authenticated, service_role;

-- Write protection: requests and the ledger change only through definer functions.
revoke insert, update, delete, truncate on public.leave_requests from authenticated, anon;
revoke insert, update, delete, truncate on public.leave_ledger from authenticated, anon;
revoke update, delete, truncate on public.leave_ledger from service_role;

-- RLS
create or replace function app.can_view_all_leave() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission_dept('leave.view') or app.has_permission_dept('leave.manage')
$$;
grant execute on function app.can_view_all_leave() to authenticated, service_role;

alter table public.leave_banks enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_ledger enable row level security;

create policy tenant_read on public.leave_banks for select to authenticated
  using (tenant_id = app.tenant_id());
create policy tenant_write on public.leave_banks for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('leave.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission_dept('leave.manage'));
create policy tenant_read on public.leave_types for select to authenticated
  using (tenant_id = app.tenant_id());
create policy tenant_write on public.leave_types for all to authenticated
  using (tenant_id = app.tenant_id() and app.has_permission_dept('leave.manage'))
  with check (tenant_id = app.tenant_id() and app.has_permission_dept('leave.manage'));
create policy own_or_all_read on public.leave_requests for select to authenticated
  using (tenant_id = app.tenant_id() and (member_id = app.my_member_id() or app.can_view_all_leave()));
create policy own_or_all_read on public.leave_ledger for select to authenticated
  using (tenant_id = app.tenant_id() and (member_id = app.my_member_id() or app.can_view_all_leave()));

-- Audit everything except the ledger, which is its own append-only record.
create trigger audit after insert or update or delete on public.leave_banks
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.leave_types
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.leave_requests
  for each row execute function app.audit_trigger();

-- app.notify split: the permission check stays on the public entry point; definer functions
-- (leave decisions, workers) use notify_internal, which is not callable by API roles.
create or replace function app.notify_internal(p_member uuid, p_kind text, p_title text, p_body text, p_link text)
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
revoke execute on function app.notify_internal(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function app.notify(p_member uuid, p_kind text, p_title text, p_body text, p_link text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and p_member is distinct from app.my_member_id()
     and not app.has_permission('notifications.send') then
    raise exception 'not allowed: notifications.send required';
  end if;
  return app.notify_internal(p_member, p_kind, p_title, p_body, p_link);
end $$;
