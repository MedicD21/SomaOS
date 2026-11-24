-- Payroll close: freeze a pay period's calculated numbers, post the comp time it earned to the leave
-- ledger, and lock the period. Reopening reverses the comp credit. Writes only through the functions below.

create table public.pay_period_closes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_start date not null,
  period_end date not null,                       -- exclusive
  status text not null default 'closed' check (status in ('closed', 'reopened')),
  snapshot jsonb not null,                        -- the calculated period, exactly as it was closed
  comp_posted jsonb not null default '[]',        -- [{member_id, bank_id, hours}] credited to the leave ledger
  closed_by uuid default auth.uid() references auth.users(id) on delete set null,
  closed_at timestamptz not null default now(),
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  check (period_end > period_start),
  check ((status = 'closed') = (reopened_at is null)),
  unique (tenant_id, id),
  constraint pay_period_closes_no_overlap
    exclude using gist (tenant_id with =, daterange(period_start, period_end) with &&) where (status = 'closed')
);
create index pay_period_closes_tenant_idx on public.pay_period_closes (tenant_id, period_start);

revoke insert, update, delete, truncate on public.pay_period_closes from authenticated, anon;

alter table public.pay_period_closes enable row level security;
create policy closes_read on public.pay_period_closes for select to authenticated
  using (tenant_id = app.tenant_id() and app.can_view_pay());

create trigger audit after insert or update or delete on public.pay_period_closes
  for each row execute function app.audit_trigger();

-- Is this date inside a closed pay period? (Any department member's writes check it, so it is definer.)
create or replace function app.is_date_closed(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pay_period_closes c
                 where c.tenant_id = app.tenant_id() and c.status = 'closed'
                   and p_date >= c.period_start and p_date < c.period_end)
$$;
revoke execute on function app.is_date_closed(date) from public, anon;
grant execute on function app.is_date_closed(date) to authenticated, service_role;

-- Close a period. p_comp is [{member_id, bank_key, hours}] (comp time earned, already calculated by the pay
-- engine); each row is credited to that member's bank on the last day of the period.
create or replace function app.close_pay_period(p_start date, p_end date, p_snapshot jsonb, p_comp jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id uuid;
  v_row record;
  v_bank uuid;
  v_hours numeric;
  v_posted jsonb := '[]'::jsonb;
begin
  if not app.has_permission_dept('pay.manage') then raise exception 'not allowed: pay.manage required'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'invalid pay period'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'missing pay period snapshot'; end if;
  if p_comp is null or jsonb_typeof(p_comp) is distinct from 'array' then raise exception 'comp credits must be a list'; end if;
  if exists (select 1 from public.pay_period_closes c
             where c.tenant_id = v_tenant and c.status = 'closed'
               and daterange(c.period_start, c.period_end) && daterange(p_start, p_end)) then
    raise exception 'That pay period overlaps a closed period';
  end if;

  insert into public.pay_period_closes (tenant_id, period_start, period_end, snapshot)
  values (v_tenant, p_start, p_end, p_snapshot) returning id into v_id;

  for v_row in select (e->>'member_id')::uuid as member_id, e->>'bank_key' as bank_key, (e->>'hours')::numeric as hours
               from jsonb_array_elements(p_comp) e loop
    v_hours := round(coalesce(v_row.hours, 0), 2);
    continue when v_hours <= 0;
    select b.id into v_bank from public.leave_banks b where b.tenant_id = v_tenant and b.key = v_row.bank_key;
    if v_bank is null then raise exception 'Unknown leave bank "%" for comp time', v_row.bank_key; end if;
    if not exists (select 1 from public.members m where m.id = v_row.member_id and m.tenant_id = v_tenant) then
      raise exception 'unknown member in comp credits';
    end if;
    insert into public.leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, run_key, note)
    values (v_tenant, v_row.member_id, v_bank, 'earn', v_hours, p_end - 1, 'comp:' || v_id,
            'Comp time earned ' || p_start || ' to ' || (p_end - 1));
    v_posted := v_posted || jsonb_build_object('member_id', v_row.member_id, 'bank_id', v_bank, 'hours', v_hours);
  end loop;

  update public.pay_period_closes set comp_posted = v_posted where id = v_id;
  return v_id;
end $$;
revoke execute on function app.close_pay_period(date, date, jsonb, jsonb) from public, anon;
grant execute on function app.close_pay_period(date, date, jsonb, jsonb) to authenticated;

-- Reopen a closed period: its comp credit is reversed (once) and the period is unlocked.
create or replace function app.reopen_pay_period(p_close uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_close public.pay_period_closes;
  v_row record;
begin
  if not app.has_permission_dept('pay.manage') then raise exception 'not allowed: pay.manage required'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'explain why the period is reopened (at least 5 characters)'; end if;
  select * into v_close from public.pay_period_closes where id = p_close and tenant_id = v_tenant for update;
  if not found then raise exception 'unknown pay period close'; end if;
  if v_close.status <> 'closed' then raise exception 'That pay period is already reopened'; end if;

  for v_row in select (e->>'member_id')::uuid as member_id, (e->>'bank_id')::uuid as bank_id, (e->>'hours')::numeric as hours
               from jsonb_array_elements(v_close.comp_posted) e loop
    insert into public.leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, run_key, note)
    values (v_tenant, v_row.member_id, v_row.bank_id, 'reversal', -v_row.hours,
            (select (now() at time zone t.timezone)::date from public.tenants t where t.id = v_tenant),
            'comp-reversal:' || v_close.id,
            'Comp time reversed: pay period ' || v_close.period_start || ' reopened');
  end loop;

  update public.pay_period_closes
     set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = v_reason
   where id = v_close.id;
end $$;
revoke execute on function app.reopen_pay_period(uuid, text) from public, anon;
grant execute on function app.reopen_pay_period(uuid, text) to authenticated;
