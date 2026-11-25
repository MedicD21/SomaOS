-- Training (Phase 4b), part 1: categories, courses and per-rank/role requirements.
-- Tenant configuration: archived, never deleted. Every write goes through the functions below (department-wide
-- training.course.manage); the tables have no direct write grants. Reads need training.course.view (or manage).

create or replace function app.training_can_read_catalog() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission('training.course.view') or app.has_permission('training.course.manage')
      or app.has_permission('training.compliance.view')
$$;
revoke execute on function app.training_can_read_catalog() from public, anon;
grant execute on function app.training_can_read_catalog() to authenticated, service_role;

create table public.training_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(trim(label)) between 1 and 80),
  external_code text check (external_code is null or length(external_code) <= 60),   -- free text, e.g. ISO-company
  archived_at timestamptz,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.training_courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(trim(label)) between 1 and 120),
  category_id uuid not null,
  default_hours numeric(5,2) not null default 1 check (default_hours > 0 and default_hours <= 999),
  credential_type_id uuid,
  completion_rule jsonb not null default '{"minHoursPct": 100}'
    check (jsonb_typeof(completion_rule) = 'object'
           and (completion_rule->>'minHoursPct') ~ '^[0-9]+(\.[0-9]+)?$'
           and (completion_rule->>'minHoursPct')::numeric between 0 and 100),
  description text check (description is null or length(description) <= 1000),
  archived_at timestamptz,
  unique (tenant_id, key),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references public.training_categories(tenant_id, id),
  foreign key (tenant_id, credential_type_id) references public.credential_types(tenant_id, id)
);

create table public.training_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 120),
  category_id uuid not null,
  rank_id uuid,
  role_id uuid,
  required_hours numeric(6,2) not null check (required_hours > 0 and required_hours <= 9999),
  span jsonb not null check (coalesce(    -- a missing field is NULL, which a CHECK would accept: fail closed instead
    jsonb_typeof(span) = 'object' and (
      span->>'kind' = 'calendar_year'
      or (span->>'kind' = 'rolling_months' and (span->>'months') ~ '^[0-9]+$' and (span->>'months')::int between 1 and 120)
      or (span->>'kind' = 'fixed_cycle' and (span->>'month') ~ '^[0-9]+$' and (span->>'month')::int between 1 and 12
          and (span->>'day') ~ '^[0-9]+$' and (span->>'day')::int between 1 and 31
          and (span->>'years') ~ '^[0-9]+$' and (span->>'years')::int between 1 and 10)
    ), false)),
  effective_from date not null,
  effective_to date,                                     -- inclusive; null = open ended
  archived_at timestamptz,
  unique (tenant_id, id),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (tenant_id, category_id) references public.training_categories(tenant_id, id),
  foreign key (tenant_id, rank_id) references public.ranks(tenant_id, id),
  foreign key (tenant_id, role_id) references public.roles(tenant_id, id),
  -- One requirement per category, rank and role at a time (null rank/role = everyone).
  constraint training_requirements_no_overlap exclude using gist (
    tenant_id with =, category_id with =,
    (coalesce(rank_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (daterange(effective_from, effective_to, '[]')) with &&
  ) where (archived_at is null)
);
create index training_requirements_category_idx on public.training_requirements (tenant_id, category_id);

revoke insert, update, delete, truncate on public.training_categories, public.training_courses, public.training_requirements
  from authenticated, anon;

alter table public.training_categories enable row level security;
alter table public.training_courses enable row level security;
alter table public.training_requirements enable row level security;

create policy training_read on public.training_categories for select to authenticated
  using (tenant_id = app.tenant_id() and app.training_can_read_catalog());
create policy training_read on public.training_courses for select to authenticated
  using (tenant_id = app.tenant_id() and app.training_can_read_catalog());
create policy training_read on public.training_requirements for select to authenticated
  using (tenant_id = app.tenant_id() and app.training_can_read_catalog());

create trigger audit after insert or update or delete on public.training_categories for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.training_courses for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.training_requirements for each row execute function app.audit_trigger();

create or replace function app.training_need_manager() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission_dept('training.course.manage') then
    raise exception 'not allowed: training.course.manage required';
  end if;
end $$;
revoke execute on function app.training_need_manager() from public, anon, authenticated;

-- Create (p_id null) or update a category.
create or replace function app.save_training_category(p_id uuid, p_key text, p_label text, p_external_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.training_need_manager();
  if p_id is null then
    insert into public.training_categories (tenant_id, key, label, external_code)
    values (app.tenant_id(), p_key, trim(p_label), nullif(trim(coalesce(p_external_code, '')), '')) returning id into v_id;
  else
    update public.training_categories set label = trim(p_label), external_code = nullif(trim(coalesce(p_external_code, '')), '')
     where id = p_id and tenant_id = app.tenant_id() returning id into v_id;
    if v_id is null then raise exception 'unknown training category'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function app.save_training_category(uuid, text, text, text) from public, anon;
grant execute on function app.save_training_category(uuid, text, text, text) to authenticated;

create or replace function app.archive_training_category(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.training_need_manager();
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'explain why (at least 5 characters)'; end if;
  update public.training_categories set archived_at = now() where id = p_id and tenant_id = app.tenant_id() and archived_at is null;
  if not found then raise exception 'unknown training category'; end if;
end $$;
revoke execute on function app.archive_training_category(uuid, text) from public, anon;
grant execute on function app.archive_training_category(uuid, text) to authenticated;

-- Create (p_id null) or update a course.
create or replace function app.save_training_course(
  p_id uuid, p_key text, p_label text, p_category uuid, p_default_hours numeric,
  p_credential_type uuid, p_min_hours_pct numeric, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_rule jsonb := jsonb_build_object('minHoursPct', coalesce(p_min_hours_pct, 100));
begin
  perform app.training_need_manager();
  if exists (select 1 from public.training_categories c where c.id = p_category and c.tenant_id = app.tenant_id() and c.archived_at is not null) then
    raise exception 'That training category is archived';
  end if;
  if p_id is null then
    insert into public.training_courses (tenant_id, key, label, category_id, default_hours, credential_type_id, completion_rule, description)
    values (app.tenant_id(), p_key, trim(p_label), p_category, p_default_hours, p_credential_type, v_rule, nullif(trim(coalesce(p_description, '')), ''))
    returning id into v_id;
  else
    update public.training_courses
       set label = trim(p_label), category_id = p_category, default_hours = p_default_hours,
           credential_type_id = p_credential_type, completion_rule = v_rule, description = nullif(trim(coalesce(p_description, '')), '')
     where id = p_id and tenant_id = app.tenant_id() and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'unknown or archived training course'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function app.save_training_course(uuid, text, text, uuid, numeric, uuid, numeric, text) from public, anon;
grant execute on function app.save_training_course(uuid, text, text, uuid, numeric, uuid, numeric, text) to authenticated;

create or replace function app.archive_training_course(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.training_need_manager();
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'explain why (at least 5 characters)'; end if;
  update public.training_courses set archived_at = now() where id = p_id and tenant_id = app.tenant_id() and archived_at is null;
  if not found then raise exception 'unknown training course'; end if;
end $$;
revoke execute on function app.archive_training_course(uuid, text) from public, anon;
grant execute on function app.archive_training_course(uuid, text) to authenticated;

-- Add a requirement effective from p_from. An open-ended requirement for the same category, rank and role that
-- started earlier is ended the day before; any other overlap is refused.
create or replace function app.save_training_requirement(
  p_label text, p_category uuid, p_rank uuid, p_role uuid, p_hours numeric, p_window jsonb, p_from date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  perform app.training_need_manager();
  if p_from is null then raise exception 'choose when the requirement takes effect'; end if;
  if exists (select 1 from public.training_categories c where c.id = p_category and c.tenant_id = app.tenant_id() and c.archived_at is not null) then
    raise exception 'That training category is archived';
  end if;
  -- End the earlier open-ended version of this same requirement.
  update public.training_requirements r set effective_to = p_from - 1
   where r.tenant_id = app.tenant_id() and r.archived_at is null and r.category_id = p_category
     and coalesce(r.rank_id, v_zero) = coalesce(p_rank, v_zero) and coalesce(r.role_id, v_zero) = coalesce(p_role, v_zero)
     and r.effective_to is null and r.effective_from < p_from;
  begin
    insert into public.training_requirements (tenant_id, label, category_id, rank_id, role_id, required_hours, span, effective_from)
    values (app.tenant_id(), trim(p_label), p_category, p_rank, p_role, p_hours, p_window, p_from) returning id into v_id;
  exception when exclusion_violation then
    raise exception 'That requirement overlaps another for the same category, rank and role';
  end;
  return v_id;
end $$;
revoke execute on function app.save_training_requirement(text, uuid, uuid, uuid, numeric, jsonb, date) from public, anon;
grant execute on function app.save_training_requirement(text, uuid, uuid, uuid, numeric, jsonb, date) to authenticated;

create or replace function app.archive_training_requirement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.training_need_manager();
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'explain why (at least 5 characters)'; end if;
  update public.training_requirements set archived_at = now() where id = p_id and tenant_id = app.tenant_id() and archived_at is null;
  if not found then raise exception 'unknown training requirement'; end if;
end $$;
revoke execute on function app.archive_training_requirement(uuid, text) from public, anon;
grant execute on function app.archive_training_requirement(uuid, text) to authenticated;
