-- Checklists (rig checks, drug-box count checks, station checks): versioned templates and immutable
-- completions. A completion stores a copy of the template version it answered, so editing a template
-- never changes history. Failed items are recorded only; nothing changes status automatically.

-- items: [{ "key": "tires", "label": "Tires and lights", "kind": "pass_fail|number|text", "required": true }]
create or replace function app.valid_checklist_items(p_items jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_item jsonb; v_keys text[] := '{}';
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then return false; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
       or length(coalesce(v_item ->> 'label', '')) not between 1 and 200
       or coalesce(v_item ->> 'kind', '') <> all (array['pass_fail', 'number', 'text'])
       or (v_item ? 'required' and jsonb_typeof(v_item -> 'required') is distinct from 'boolean') then
      return false;
    end if;
    if (v_item ->> 'key') = any (v_keys) then return false; end if;
    v_keys := v_keys || (v_item ->> 'key');
  end loop;
  return true;
end $$;

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(label) between 1 and 120),
  asset_type_id uuid,
  version int not null check (version >= 1),
  items jsonb not null check (app.valid_checklist_items(items)),
  log_failure boolean not null default true,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, key, version),
  unique (tenant_id, id),
  foreign key (tenant_id, asset_type_id) references public.asset_types(tenant_id, id)
);
create unique index checklist_templates_one_active on public.checklist_templates (tenant_id, key) where active;

create table public.checklist_completions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null,
  asset_id uuid,
  org_unit_id uuid,
  stock_location_id uuid,            -- the station / container the check was done at (FK added with inventory)
  completed_by uuid not null,
  completed_at timestamptz not null default clock_timestamp(),
  template_snapshot jsonb not null,
  answers jsonb not null,
  failed_count int not null default 0 check (failed_count >= 0),
  note text,
  foreign key (tenant_id, template_id) references public.checklist_templates(tenant_id, id),
  foreign key (tenant_id, asset_id) references public.assets(tenant_id, id),
  foreign key (tenant_id, org_unit_id) references public.org_units(tenant_id, id),
  foreign key (tenant_id, completed_by) references public.members(tenant_id, id)
);
create index checklist_completions_asset_idx on public.checklist_completions (tenant_id, asset_id, completed_at desc);
create index checklist_completions_member_idx on public.checklist_completions (tenant_id, completed_by, completed_at desc);

create trigger forbid_mutation before update or delete on public.checklist_completions
  for each row execute function app.forbid_mutation();
create trigger forbid_truncate before truncate on public.checklist_completions
  for each statement execute function app.forbid_mutation();

revoke insert, update, delete, truncate on public.checklist_templates, public.checklist_completions from authenticated, anon;

alter table public.checklist_templates enable row level security;
alter table public.checklist_completions enable row level security;

create policy template_read on public.checklist_templates for select to authenticated
  using (tenant_id = app.tenant_id()
         and (app.has_permission('inventory.check.perform') or app.has_permission('inventory.check.manage') or app.has_permission('inventory.asset.view')));
create policy completion_read on public.checklist_completions for select to authenticated
  using (tenant_id = app.tenant_id()
         and (completed_by = app.my_member_id() or app.has_permission('inventory.check.manage') or app.has_permission('inventory.asset.view')));

create trigger audit after insert or update or delete on public.checklist_templates for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.checklist_completions for each row execute function app.audit_trigger();

-- Saving creates version n+1 and retires the previous active version.
create or replace function app.save_checklist_template(p_key text, p_label text, p_asset_type uuid, p_items jsonb, p_log_failure boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_version int;
  v_id uuid;
begin
  if not app.has_permission_dept('inventory.check.manage') then raise exception 'not allowed: inventory.check.manage required'; end if;
  if coalesce(p_key, '') !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'Invalid checklist key'; end if;
  if v_label is null then raise exception 'Enter a name for the checklist'; end if;
  if not app.valid_checklist_items(p_items) then raise exception 'Checklist items are invalid: use 1 to 200 items with a unique key, a label and a kind'; end if;
  if p_asset_type is not null and not exists (select 1 from public.asset_types t where t.id = p_asset_type and t.tenant_id = v_tenant) then
    raise exception 'Unknown asset type';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':checklist:' || p_key, 0));
  select coalesce(max(version), 0) + 1 into v_version from public.checklist_templates where tenant_id = v_tenant and key = p_key;
  update public.checklist_templates set active = false where tenant_id = v_tenant and key = p_key and active;
  insert into public.checklist_templates (tenant_id, key, label, asset_type_id, version, items, log_failure)
  values (v_tenant, p_key, v_label, p_asset_type, v_version, p_items, coalesce(p_log_failure, true)) returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.save_checklist_template(text, text, uuid, jsonb, boolean) from public, anon;
grant execute on function app.save_checklist_template(text, text, uuid, jsonb, boolean) to authenticated;

-- Complete a checklist as the caller's own member. p_answers is { itemKey: "pass"|"fail" | number | "text" }.
create or replace function app.complete_checklist(
  p_template uuid, p_asset uuid, p_answers jsonb, p_note text,
  p_org_unit uuid default null, p_stock_location uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.tenant_id();
  v_me uuid := app.my_member_id();
  v_t public.checklist_templates;
  v_a public.assets;
  v_unit uuid := p_org_unit;
  v_item jsonb;
  v_ans jsonb;
  v_key text;
  v_fail int := 0;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
  v_snapshot jsonb;
begin
  if v_me is null then raise exception 'not a member of this department'; end if;
  select * into v_t from public.checklist_templates where id = p_template and tenant_id = v_tenant;
  if v_t.id is null then raise exception 'Unknown checklist'; end if;
  if not v_t.active then raise exception 'This checklist has a newer version; reload and answer the current one'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers must be an object'; end if;

  if p_asset is not null then
    select * into v_a from public.assets where id = p_asset and tenant_id = v_tenant;
    if v_a.id is null then raise exception 'Unknown asset'; end if;
    if v_a.status = 'retired' or v_a.archived_at is not null then raise exception 'This asset is retired; it cannot be checked'; end if;
    if v_t.asset_type_id is not null and v_t.asset_type_id <> v_a.type_id then raise exception 'This checklist is for a different type of asset'; end if;
    v_unit := v_a.org_unit_id;
  elsif v_unit is not null and not exists (select 1 from public.org_units o where o.id = v_unit and o.tenant_id = v_tenant) then
    raise exception 'Unknown location';
  end if;
  if not app.has_permission_unit('inventory.check.perform', v_unit) then raise exception 'not allowed: you cannot complete checks at this location'; end if;

  for v_key in select jsonb_object_keys(p_answers) loop
    if not exists (select 1 from jsonb_array_elements(v_t.items) i where i ->> 'key' = v_key) then
      raise exception 'Unknown checklist item: %', v_key;
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(v_t.items) loop
    v_ans := p_answers -> (v_item ->> 'key');
    if v_ans is null or v_ans = 'null'::jsonb or v_ans = '""'::jsonb then
      if coalesce((v_item ->> 'required')::boolean, false) then raise exception 'Answer every required item: %', v_item ->> 'label'; end if;
      continue;
    end if;
    case v_item ->> 'kind'
      when 'pass_fail' then
        if v_ans not in ('"pass"'::jsonb, '"fail"'::jsonb) then raise exception 'Answer pass or fail: %', v_item ->> 'label'; end if;
        if v_ans = '"fail"'::jsonb then v_fail := v_fail + 1; end if;
      when 'number' then
        if jsonb_typeof(v_ans) <> 'number' then raise exception 'Enter a number: %', v_item ->> 'label'; end if;
      else
        if jsonb_typeof(v_ans) <> 'string' or length(v_ans #>> '{}') > 500 then raise exception 'Enter text (up to 500 characters): %', v_item ->> 'label'; end if;
    end case;
  end loop;

  v_snapshot := jsonb_build_object('key', v_t.key, 'label', v_t.label, 'version', v_t.version, 'items', v_t.items);
  insert into public.checklist_completions (tenant_id, template_id, asset_id, org_unit_id, stock_location_id, completed_by, template_snapshot, answers, failed_count, note)
  values (v_tenant, v_t.id, p_asset, v_unit, p_stock_location, v_me, v_snapshot, p_answers, v_fail, v_note) returning id into v_id;

  if p_asset is not null and (v_t.log_failure or v_fail = 0) then
    insert into public.asset_events (tenant_id, asset_id, kind, note, data)
    values (v_tenant, p_asset, 'check',
            v_t.label || case when v_fail = 0 then ': all items passed' else ': ' || v_fail || ' item(s) failed' end,
            jsonb_build_object('completion_id', v_id, 'failed_count', v_fail));
  end if;
  return v_id;
end $$;
revoke execute on function app.complete_checklist(uuid, uuid, jsonb, text, uuid, uuid) from public, anon;
grant execute on function app.complete_checklist(uuid, uuid, jsonb, text, uuid, uuid) to authenticated;
