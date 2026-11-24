/**
 * Local development seed: "Demo Fire Rescue" (career template) with a dev admin.
 * DEV ONLY — never run against a hosted database.
 *   email: admin@soma.local   password: somadev123!
 */
import postgres from 'postgres';
import { TEMPLATES, applyTemplate } from '@soma/templates';

const DB_URL = process.env.SOMA_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!/127\.0\.0\.1|localhost/.test(DB_URL)) throw new Error('seed-dev refuses to run against a non-local database');

export const DEV_USERS = [
  { email: 'admin@soma.local', password: 'somadev123!', first: 'Dana', last: 'Admin' },
  { email: 'member@soma.local', password: 'somadev123!', first: 'Riley', last: 'Medic' },
];

async function upsertAuthUser(sql: postgres.Sql, email: string, password: string): Promise<string> {
  const existing = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (existing[0]) return existing[0].id;
  const [u] = await sql<{ id: string }[]>`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${email},
      extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    returning id`;
  await sql`
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), ${u!.id}, ${u!.id}, 'email',
      ${sql.json({ sub: u!.id, email, email_verified: true })}, now(), now(), now())`;
  return u!.id;
}

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      const found = await tx<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
      const tenantId =
        found[0]?.id ??
        (await tx<{ id: string }[]>`
          select app.create_tenant('Demo Fire Rescue', 'demo-fire-rescue', 'America/New_York', 'career', 'FL') as id`)[0]!.id;
      const [admin, member] = DEV_USERS;
      const adminId = await upsertAuthUser(tx as unknown as postgres.Sql, admin!.email, admin!.password);
      await applyTemplate(tx, tenantId, TEMPLATES['career-3-platoon'], {
        userId: adminId, firstName: admin!.first, lastName: admin!.last,
      });
      const memberId = await upsertAuthUser(tx as unknown as postgres.Sql, member!.email, member!.password);
      await tx`insert into memberships (tenant_id, user_id) values (${tenantId}, ${memberId}) on conflict do nothing`;
      await tx`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
               values (${tenantId}, ${memberId}, ${member!.first}, ${member!.last}, 'career_full_time')
               on conflict (tenant_id, user_id) where user_id is not null do nothing`;
      await tx`
        insert into role_grants (tenant_id, member_id, role_id, scope_kind)
        select ${tenantId}, m.id, r.id, 'department' from members m, roles r
        where m.tenant_id = ${tenantId} and m.user_id = ${memberId} and r.tenant_id = ${tenantId} and r.key = 'member'
          and not exists (select 1 from role_grants g where g.member_id = m.id and g.role_id = r.id)`;
      await tx`update profiles set active_tenant_id = ${tenantId} where user_id = ${memberId} and active_tenant_id is null`;
    });
    console.log('Seeded Demo Fire Rescue. Login: admin@soma.local / somadev123!');
  } finally {
    await sql.end();
  }
}

await main();
