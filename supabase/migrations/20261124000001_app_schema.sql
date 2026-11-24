-- App schema: helper functions shared by all SomaOS tables.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

create extension if not exists ltree with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Active tenant from the JWT (set by the custom access token hook).
create or replace function app.tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;
grant execute on function app.tenant_id() to authenticated, service_role;
