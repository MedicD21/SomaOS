import { execSync } from 'node:child_process';
import { sql } from './db';

/** Fresh seeded DB, plus a second department for member@soma.local (tenant switching). */
export default async function globalSetup(): Promise<void> {
  execSync('pnpm db:reset', { cwd: '../..', stdio: 'inherit' });
  const [t] = await sql<{ id: string }[]>`
    select app.create_tenant('Second County EMS', 'second-county-ems', 'America/Chicago', 'county_ems', 'TX') as id`;
  const [u] = await sql<{ id: string }[]>`select id from auth.users where email = 'member@soma.local'`;
  await sql`insert into memberships (tenant_id, user_id) values (${t!.id}, ${u!.id})`;
  await sql`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
            values (${t!.id}, ${u!.id}, 'Riley', 'Medic', 'per_diem')`;
  await sql.end();
}
