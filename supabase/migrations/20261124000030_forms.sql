-- Forms: versioned definitions (custom-field types plus a simple show_if), append-only submissions that keep a copy of
-- the definition they answered, drawn/typed signatures, and officer approval decisions. SHA-256 hashes are computed in SQL
-- inside the function that inserts the row. All writes go through the functions below.

-- Field list validation ----------------------------------------------------------------------------------------------
create or replace function app.valid_form_fields(p_fields jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
  v_seen text[] := '{}';
  v_key text;
  v_type text;
  v_sf jsonb;
  o jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) not between 1 and 200 then return false; end if;
  for f in select * from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(f) <> 'object' then return false; end if;
    v_key := f->>'key';
    v_type := f->>'type';
    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,39}$' or v_key = any(v_seen) then return false; end if;
    if length(trim(coalesce(f->>'label', ''))) = 0 or length(f->>'label') > 200 then return false; end if;
    if v_type is null or v_type not in ('text','long_text','number','integer','boolean','date','select','multi_select','email','phone') then return false; end if;
    if f ? 'required' and jsonb_typeof(f->'required') <> 'boolean' then return false; end if;
    if v_type in ('select', 'multi_select') then
      if coalesce(jsonb_typeof(f->'options'), '') <> 'array' or jsonb_array_length(f->'options') = 0 then return false; end if;
      for o in select * from jsonb_array_elements(f->'options') loop
        if jsonb_typeof(o) <> 'object' or length(trim(coalesce(o->>'value', ''))) = 0 or length(trim(coalesce(o->>'label', ''))) = 0 then return false; end if;
      end loop;
    end if;
    v_sf := f->'show_if';
    if v_sf is not null and v_sf <> 'null'::jsonb then
      -- may only depend on an earlier field
      if jsonb_typeof(v_sf) <> 'object' or not (v_sf ? 'equals') or (v_sf->>'field') is null or not ((v_sf->>'field') = any(v_seen)) then return false; end if;
    end if;
    v_seen := v_seen || v_key;
  end loop;
  return true;
end $$;
grant execute on function app.valid_form_fields(jsonb) to authenticated, service_role;

-- Answer validation: same rules and messages as custom values (required, type, options), plus show_if.
create or replace function app.validate_form_answers(p_fields jsonb, p_answers jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
  v_key text;
  v_type text;
  v_label text;
  v_val jsonb;
  v_sf jsonb;
  v_visible boolean;
  v_values text[];
  v_known text[] := '{}';
  k text;
  e jsonb;
  v_ok boolean;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers must be an object'; end if;
  for f in select * from jsonb_array_elements(p_fields) loop v_known := v_known || (f->>'key'); end loop;
  for k in select jsonb_object_keys(p_answers) loop
    if not (k = any(v_known)) then raise exception 'Unknown field "%"', k; end if;
  end loop;

  for f in select * from jsonb_array_elements(p_fields) loop
    v_key := f->>'key'; v_type := f->>'type'; v_label := f->>'label';
    v_val := p_answers->v_key;
    v_sf := f->'show_if';
    v_visible := v_sf is null or v_sf = 'null'::jsonb or (p_answers->(v_sf->>'field')) is not distinct from (v_sf->'equals');
    if not v_visible then
      if v_val is not null and v_val <> 'null'::jsonb then raise exception '% must be empty because it does not apply', v_label; end if;
      continue;
    end if;
    if v_val is null or v_val = 'null'::jsonb or (jsonb_typeof(v_val) = 'string' and length(trim(v_val #>> '{}')) = 0)
       or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0) then
      if coalesce((f->>'required')::boolean, false) then raise exception '% is required', v_label; end if;
      continue;
    end if;
    if v_type in ('select', 'multi_select') then
      select array_agg(o->>'value') into v_values from jsonb_array_elements(f->'options') o;
    end if;
    case v_type
      when 'text' then
        if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 500 then raise exception '% must be text of at most 500 characters', v_label; end if;
      when 'long_text' then
        if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 10000 then raise exception '% must be text of at most 10000 characters', v_label; end if;
      when 'number' then
        if jsonb_typeof(v_val) <> 'number' then raise exception '% must be a number', v_label; end if;
      when 'integer' then
        if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then raise exception '% must be a whole number', v_label; end if;
      when 'boolean' then
        if jsonb_typeof(v_val) <> 'boolean' then raise exception '% must be yes or no', v_label; end if;
      when 'date' then
        v_ok := jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$';
        if v_ok then
          begin perform (v_val #>> '{}')::date; exception when others then v_ok := false; end;
        end if;
        if not v_ok then raise exception '% must be a valid date (YYYY-MM-DD)', v_label; end if;
      when 'select' then
        if jsonb_typeof(v_val) <> 'string' or not ((v_val #>> '{}') = any(v_values)) then
          raise exception '% must be one of: %', v_label, array_to_string(v_values, ', '); end if;
      when 'multi_select' then
        if jsonb_typeof(v_val) <> 'array' then raise exception '% must be a list', v_label; end if;
        for e in select * from jsonb_array_elements(v_val) loop
          if jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any(v_values)) then
            raise exception '% must only contain: %', v_label, array_to_string(v_values, ', '); end if;
        end loop;
      when 'email' then
        if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% must be an email address', v_label; end if;
      when 'phone' then
        if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^[+\d][\d\s().-]{6,24}$' then raise exception '% must be a phone number', v_label; end if;
    end case;
  end loop;
end $$;
grant execute on function app.validate_form_answers(jsonb, jsonb) to authenticated, service_role;

-- Tables --------------------------------------------------------------------------------------------------------------
create table public.form_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  version int not null check (version > 0),
  label text not null check (length(trim(label)) between 1 and 200),
  description text check (description is null or length(description) <= 1000),
  fields jsonb not null check (app.valid_form_fields(fields)),
  requires_signature boolean not null default false,
  signature_statement text check (signature_statement is null or length(signature_statement) <= 500),
  approval text not null default 'none' check (approval in ('none', 'officer')),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, key, version),
  check (not requires_signature or length(trim(coalesce(signature_statement, ''))) >= 10)
);
create unique index form_definitions_one_published on public.form_definitions (tenant_id, key) where status = 'published';

create or replace function app.form_definition_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'form definitions are never deleted'; end if;
  if (new.id, new.tenant_id, new.key, new.version, new.label, new.description, new.fields, new.requires_signature, new.signature_statement, new.approval, new.created_at)
     is distinct from (old.id, old.tenant_id, old.key, old.version, old.label, old.description, old.fields, old.requires_signature, old.signature_statement, old.approval, old.created_at) then
    raise exception 'a form definition cannot be edited; save a new version instead';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status = 'published') or (old.status = 'published' and new.status = 'retired')) then
    raise exception 'invalid form status change';
  end if;
  return new;
end $$;
create trigger form_definition_guard before update or delete on public.form_definitions
  for each row execute function app.form_definition_guard();

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  definition_id uuid not null,
  org_unit_id uuid,                        -- the submitter's station when submitted
  member_id uuid not null,
  submitted_at timestamptz not null,
  definition_snapshot jsonb not null,      -- the definition exactly as answered
  answers jsonb not null,
  submission_hash text not null,
  corrects_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, definition_id) references public.form_definitions(tenant_id, id),
  foreign key (tenant_id, member_id) references public.members(tenant_id, id),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, corrects_id) references public.form_submissions(tenant_id, id)
);
create index form_submissions_member_idx on public.form_submissions (tenant_id, member_id, submitted_at desc);
create index form_submissions_unit_idx on public.form_submissions (tenant_id, org_unit_id);

create table public.form_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  submission_id uuid not null,
  signer_member_id uuid not null,
  method text not null check (method in ('drawn', 'typed')),
  typed_name text,
  image_png text check (image_png is null or length(image_png) <= 400000),   -- base64 PNG of a drawn signature
  statement_text text not null,
  signed_at timestamptz not null,
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  signature_hash text not null,
  foreign key (tenant_id, submission_id) references public.form_submissions(tenant_id, id),
  foreign key (tenant_id, signer_member_id) references public.members(tenant_id, id),
  check ((method = 'typed' and typed_name is not null) or (method = 'drawn' and image_png is not null))
);
create index form_signatures_submission_idx on public.form_signatures (tenant_id, submission_id);

create table public.form_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  submission_id uuid not null,
  step int not null default 1,
  decision text not null check (decision in ('approved', 'rejected', 'returned', 'void')),
  decided_by uuid default auth.uid() references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  note text check (note is null or length(note) <= 500),
  foreign key (tenant_id, submission_id) references public.form_submissions(tenant_id, id)
);
create unique index form_decisions_one_terminal on public.form_decisions (submission_id, step);

create trigger append_only before update or delete on public.form_submissions
  for each row execute function app.insert_only_guard();
create trigger append_only before update or delete on public.form_signatures
  for each row execute function app.insert_only_guard();
create trigger append_only before update or delete on public.form_decisions
  for each row execute function app.insert_only_guard();

revoke insert, update, delete, truncate on public.form_definitions, public.form_submissions, public.form_signatures, public.form_decisions
  from authenticated, anon;

-- Access ------------------------------------------------------------------------------------------------------------
create or replace function app.can_approve_at(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_unit is null then app.has_permission_dept('forms.approve')
              else app.has_permission_at('forms.approve', p_unit) end
$$;
revoke execute on function app.can_approve_at(uuid) from public, anon;
grant execute on function app.can_approve_at(uuid) to authenticated, service_role;

alter table public.form_definitions enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_signatures enable row level security;
alter table public.form_decisions enable row level security;
create policy definition_read on public.form_definitions for select to authenticated
  using (tenant_id = app.tenant_id()
         and ((status <> 'draft' and (app.has_permission('forms.submit') or app.has_permission('forms.approve')
                                      or app.has_permission('forms.view_all') or app.has_permission_dept('forms.manage')))
              or app.has_permission_dept('forms.manage')));
create policy submission_read on public.form_submissions for select to authenticated
  using (tenant_id = app.tenant_id()
         and (member_id = app.my_member_id() or app.has_permission_dept('forms.view_all') or app.can_approve_at(org_unit_id)));
create policy signature_read on public.form_signatures for select to authenticated
  using (tenant_id = app.tenant_id() and exists (select 1 from public.form_submissions s where s.id = form_signatures.submission_id));
create policy decision_read on public.form_decisions for select to authenticated
  using (tenant_id = app.tenant_id() and exists (select 1 from public.form_submissions s where s.id = form_decisions.submission_id));

create trigger audit after insert or update or delete on public.form_definitions
  for each row execute function app.audit_trigger();
create trigger audit after insert on public.form_submissions
  for each row execute function app.audit_trigger();
create trigger audit after insert on public.form_decisions
  for each row execute function app.audit_trigger();

create view public.form_status with (security_invoker = true) as
  select s.id as submission_id, s.tenant_id,
         coalesce((select d.decision from public.form_decisions d where d.submission_id = s.id order by d.step desc, d.decided_at desc limit 1), 'submitted') as status
  from public.form_submissions s;
grant select on public.form_status to authenticated, service_role;

-- Definitions ----------------------------------------------------------------------------------------------------------
create or replace function app.save_form_definition(p_key text, p_label text, p_description text, p_fields jsonb, p_requires_signature boolean,
                                                    p_statement text, p_approval text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_key text := trim(coalesce(p_key, ''));
  v_ver int;
  v_id uuid;
begin
  if not app.has_permission_dept('forms.manage') then raise exception 'not allowed: forms.manage required'; end if;
  if v_key !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'The form key must be lowercase letters, digits and underscores'; end if;
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'Enter a form name'; end if;
  if not app.valid_form_fields(p_fields) then raise exception 'The form fields are not valid'; end if;
  if coalesce(p_approval, 'none') not in ('none', 'officer') then raise exception 'Unknown approval type'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || v_key, 0));
  select coalesce(max(version), 0) + 1 into v_ver from public.form_definitions where tenant_id = v_tenant and key = v_key;
  insert into public.form_definitions (tenant_id, key, version, label, description, fields, requires_signature, signature_statement, approval)
  values (v_tenant, v_key, v_ver, trim(p_label), nullif(trim(coalesce(p_description, '')), ''), p_fields, coalesce(p_requires_signature, false),
          nullif(trim(coalesce(p_statement, '')), ''), coalesce(p_approval, 'none'))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.save_form_definition(text, text, text, jsonb, boolean, text, text) from public, anon;
grant execute on function app.save_form_definition(text, text, text, jsonb, boolean, text, text) to authenticated;

create or replace function app.publish_form_definition(p_definition uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_def public.form_definitions;
begin
  if not app.has_permission_dept('forms.manage') then raise exception 'not allowed: forms.manage required'; end if;
  select * into v_def from public.form_definitions where id = p_definition and tenant_id = app.tenant_id();
  if v_def.id is null then raise exception 'unknown form'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_def.tenant_id::text || ':' || v_def.key, 0));
  select * into v_def from public.form_definitions where id = p_definition;
  if v_def.status <> 'draft' then raise exception 'Only a draft version can be published'; end if;
  update public.form_definitions set status = 'retired' where tenant_id = v_def.tenant_id and key = v_def.key and status = 'published';
  update public.form_definitions set status = 'published', published_at = now() where id = v_def.id;
end $$;
revoke execute on function app.publish_form_definition(uuid) from public, anon;
grant execute on function app.publish_form_definition(uuid) to authenticated;

create or replace function app.retire_form(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_permission_dept('forms.manage') then raise exception 'not allowed: forms.manage required'; end if;
  update public.form_definitions set status = 'retired' where tenant_id = app.tenant_id() and key = p_key and status = 'published';
  if not found then raise exception 'That form is not published'; end if;
end $$;
revoke execute on function app.retire_form(text) from public, anon;
grant execute on function app.retire_form(text) to authenticated;

-- Submissions ----------------------------------------------------------------------------------------------------------
create or replace function app.iso_utc(p timestamptz) returns text
language sql immutable set search_path = '' as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
grant execute on function app.iso_utc(timestamptz) to authenticated, service_role;

create or replace function app.submission_hash_of(p_tenant uuid, p_definition uuid, p_version text, p_member uuid, p_at timestamptz, p_answers jsonb)
returns text language sql immutable set search_path = '' as $$
  select app.sha256_hex(concat_ws('|', p_tenant, p_definition, p_version, p_member, app.iso_utc(p_at), p_answers::text))
$$;
grant execute on function app.submission_hash_of(uuid, uuid, text, uuid, timestamptz, jsonb) to authenticated, service_role;

create or replace function app.signature_hash_of(p_submission_hash text, p_signer uuid, p_at timestamptz, p_method text, p_statement text, p_image text)
returns text language sql immutable set search_path = '' as $$
  select app.sha256_hex(concat_ws('|', p_submission_hash, p_signer, app.iso_utc(p_at), p_method, p_statement, coalesce(app.sha256_hex(p_image), '')))
$$;
grant execute on function app.signature_hash_of(text, uuid, timestamptz, text, text, text) to authenticated, service_role;

-- p_signature: {"method": "typed", "typed_name": "..."} or {"method": "drawn", "image_png": "<base64>"}.
create or replace function app.submit_form(p_definition uuid, p_answers jsonb, p_signature jsonb, p_corrects uuid, p_ip text, p_user_agent text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_me public.members;
  v_def public.form_definitions;
  v_unit uuid;
  v_now timestamptz := clock_timestamp();
  v_id uuid := gen_random_uuid();
  v_hash text;
  v_method text;
  v_typed text;
  v_image text;
  v_ip inet;
  v_orig public.form_submissions;
  v_officer uuid;
begin
  if not app.has_permission('forms.submit') then raise exception 'not allowed: forms.submit required'; end if;
  select * into v_me from public.members where id = app.my_member_id() and tenant_id = v_tenant;
  if v_me.id is null then raise exception 'not a member of this department'; end if;
  select * into v_def from public.form_definitions where id = p_definition and tenant_id = v_tenant;
  if v_def.id is null then raise exception 'unknown form'; end if;
  if v_def.status <> 'published' then raise exception 'That form is not open for submissions'; end if;
  perform app.validate_form_answers(v_def.fields, p_answers);

  if p_corrects is not null then
    select * into v_orig from public.form_submissions where id = p_corrects and tenant_id = v_tenant;
    if v_orig.id is null or v_orig.member_id <> v_me.id then raise exception 'You can only correct your own submission'; end if;
    if (select d.key from public.form_definitions d where d.id = v_orig.definition_id) <> v_def.key then raise exception 'A correction must use the same form'; end if;
    if exists (select 1 from public.form_decisions where submission_id = p_corrects and decision = 'void') then raise exception 'That submission was voided'; end if;
    if exists (select 1 from public.form_submissions where corrects_id = p_corrects) then raise exception 'That submission was already corrected'; end if;
  end if;

  -- The submitter's station: primary assignment, else regular seat.
  select x.unit into v_unit from (
    select 1 as pri, a.org_unit_id as unit from public.member_assignments a
      where a.member_id = v_me.id and a.tenant_id = v_tenant and a.is_primary and a.effective @> app.today()
    union all
    select 2, st.org_unit_id from public.standing_seats ss join public.seats st on st.id = ss.seat_id
      where ss.member_id = v_me.id and ss.tenant_id = v_tenant and ss.effective @> app.today()
    order by 1 limit 1) x;

  v_hash := app.submission_hash_of(v_tenant, v_def.id, v_def.version::text, v_me.id, v_now, p_answers);
  insert into public.form_submissions (id, tenant_id, definition_id, org_unit_id, member_id, submitted_at, definition_snapshot, answers, submission_hash, corrects_id)
  values (v_id, v_tenant, v_def.id, v_unit, v_me.id, v_now,
          jsonb_build_object('id', v_def.id, 'key', v_def.key, 'version', v_def.version, 'label', v_def.label, 'fields', v_def.fields,
                             'requires_signature', v_def.requires_signature, 'signature_statement', v_def.signature_statement, 'approval', v_def.approval),
          p_answers, v_hash, p_corrects);

  if v_def.requires_signature then
    if p_signature is null or jsonb_typeof(p_signature) <> 'object' then raise exception 'This form must be signed'; end if;
    v_method := p_signature->>'method';
    v_typed := nullif(trim(coalesce(p_signature->>'typed_name', '')), '');
    v_image := nullif(p_signature->>'image_png', '');
    if v_method = 'typed' then
      if v_typed is null or lower(regexp_replace(v_typed, '\s+', ' ', 'g')) <> lower(v_me.first_name || ' ' || v_me.last_name) then
        raise exception 'Type your full name exactly as it appears on your member record to sign';
      end if;
      v_image := null;
    elsif v_method = 'drawn' then
      if v_image is null or v_image !~ '^[A-Za-z0-9+/]+=*$' or length(v_image) < 200 then raise exception 'Draw your signature to sign'; end if;
      v_typed := null;
    else
      raise exception 'Choose how to sign';
    end if;
    begin v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet; exception when others then v_ip := null; end;
    insert into public.form_signatures (tenant_id, submission_id, signer_member_id, method, typed_name, image_png, statement_text, signed_at, ip, user_agent, signature_hash)
    values (v_tenant, v_id, v_me.id, v_method, v_typed, v_image, v_def.signature_statement, v_now, v_ip, left(p_user_agent, 400),
            app.signature_hash_of(v_hash, v_me.id, v_now, v_method, v_def.signature_statement, v_image));
  end if;

  if v_def.approval = 'officer' then
    for v_officer in
      select distinct g.member_id from public.role_grants g
      join public.role_permissions rp on rp.role_id = g.role_id and rp.permission = 'forms.approve'
      left join public.org_units gou on gou.id = g.scope_org_unit_id
      left join public.org_units su on su.id = v_unit
      where g.tenant_id = v_tenant and g.valid @> now() and g.member_id <> v_me.id
        and (g.scope_kind = 'department' or (g.scope_kind = 'org_unit' and su.path is not null and su.path operator(extensions.<@) gou.path))
    loop
      perform app.notify_internal(v_officer, 'form-approval', 'Form waiting for your approval: ' || v_def.label,
        v_me.first_name || ' ' || v_me.last_name || ' submitted a ' || v_def.label || '.', '/forms/submissions/' || v_id);
    end loop;
  end if;
  return v_id;
end $$;
revoke execute on function app.submit_form(uuid, jsonb, jsonb, uuid, text, text) from public, anon;
grant execute on function app.submit_form(uuid, jsonb, jsonb, uuid, text, text) to authenticated;

create or replace function app.decide_form(p_submission uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_s public.form_submissions;
  v_def public.form_definitions;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_decision not in ('approved', 'rejected', 'returned') then raise exception 'Choose approve, reject or return'; end if;
  select * into v_s from public.form_submissions where id = p_submission and tenant_id = v_tenant;
  if v_s.id is null then raise exception 'unknown submission'; end if;
  select * into v_def from public.form_definitions where id = v_s.definition_id;
  if v_def.approval <> 'officer' then raise exception 'That form does not need approval'; end if;
  if v_s.member_id = app.my_member_id() then raise exception 'not in your scope: you cannot decide your own submission'; end if;
  if not app.can_approve_at(v_s.org_unit_id) then raise exception 'not in your scope: approving needs forms.approve at the submitter''s station'; end if;
  if exists (select 1 from public.form_decisions where submission_id = p_submission) then raise exception 'That submission already has a decision'; end if;
  if p_decision <> 'approved' and length(coalesce(v_note, '')) < 5 then raise exception 'Explain the decision (at least 5 characters)'; end if;
  insert into public.form_decisions (tenant_id, submission_id, decision, note) values (v_tenant, p_submission, p_decision, v_note);
  perform app.notify_internal(v_s.member_id, 'form-decision', v_def.label || ' ' || p_decision,
    'Your ' || v_def.label || ' was ' || p_decision || case when v_note is not null then ': ' || v_note else '.' end, '/forms/submissions/' || p_submission);
end $$;
revoke execute on function app.decide_form(uuid, text, text) from public, anon;
grant execute on function app.decide_form(uuid, text, text) to authenticated;

create or replace function app.void_form(p_submission uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_s public.form_submissions;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_s from public.form_submissions where id = p_submission and tenant_id = v_tenant;
  if v_s.id is null then raise exception 'unknown submission'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'Explain why it is void (at least 5 characters)'; end if;
  if exists (select 1 from public.form_decisions where submission_id = p_submission and decision = 'void')
     and (app.has_permission_dept('forms.manage') or v_s.member_id = app.my_member_id()) then
    raise exception 'That submission is already void';
  end if;
  if not (app.has_permission_dept('forms.manage')
          or (v_s.member_id = app.my_member_id() and not exists (select 1 from public.form_decisions where submission_id = p_submission))) then
    raise exception 'not allowed: only the submitter, before any decision, or a forms manager can void a submission';
  end if;
  insert into public.form_decisions (tenant_id, submission_id, step, decision, note)
  values (v_tenant, p_submission, coalesce((select max(step) from public.form_decisions where submission_id = p_submission), 0) + 1, 'void', v_reason);
end $$;
revoke execute on function app.void_form(uuid, text) from public, anon;
grant execute on function app.void_form(uuid, text) to authenticated;

-- Recomputes the stored hashes. Runs as the caller, so it only works on submissions they may see.
create or replace function app.verify_submission(p_submission uuid) returns table (ok boolean, submission_ok boolean, signatures_ok boolean)
language plpgsql stable set search_path = '' as $$
declare
  s public.form_submissions;
  v_sub boolean;
  v_sigs boolean;
begin
  select * into s from public.form_submissions where id = p_submission;
  if s.id is null then return; end if;
  v_sub := s.submission_hash = app.submission_hash_of(s.tenant_id, s.definition_id, s.definition_snapshot->>'version', s.member_id, s.submitted_at, s.answers);
  select coalesce(bool_and(g.signature_hash = app.signature_hash_of(s.submission_hash, g.signer_member_id, g.signed_at, g.method, g.statement_text, g.image_png)), true)
    into v_sigs from public.form_signatures g where g.submission_id = s.id;
  return query select v_sub and v_sigs, v_sub, v_sigs;
end $$;
grant execute on function app.verify_submission(uuid) to authenticated, service_role;
