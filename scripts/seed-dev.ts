/**
 * Local development seed: "Demo Fire Rescue" (career template) with a dev admin.
 * DEV ONLY — never run against a hosted database.
 *   email: admin@soma.local   password: somadev123!
 */
import postgres from 'postgres';
import { TEMPLATES, applyTemplate } from '@soma/templates';
import { credentialExpiry } from '@soma/schedule-engine';

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

type Tx = postgres.TransactionSql;

const ISSUED_ON = '2026-01-15';
const STANDING_FROM = '2026-01-01';

/** Station 1 -> Engine 1 / Medic 1 org units, created only when absent. Returns unit ids. */
async function ensureUnits(tx: Tx, tenantId: string): Promise<{ engine1: string; medic1: string }> {
  const find = async (name: string): Promise<string | undefined> =>
    (await tx<{ id: string }[]>`select id from org_units where tenant_id = ${tenantId} and name = ${name}`)[0]?.id;
  const make = async (typeKey: string, name: string, parentId: string | null): Promise<string> =>
    (await tx<{ id: string }[]>`
      insert into org_units (tenant_id, type_id, parent_id, name)
      select ${tenantId}, t.id, ${parentId}, ${name} from org_unit_types t
      where t.tenant_id = ${tenantId} and t.key = ${typeKey} returning id`)[0]!.id;
  const station = (await find('Station 1')) ?? (await make('station', 'Station 1', null));
  return {
    engine1: (await find('Engine 1')) ?? (await make('unit', 'Engine 1', station)),
    medic1: (await find('Medic 1')) ?? (await make('unit', 'Medic 1', station)),
  };
}

type SeatDef = { label: string; sort: number; minRank?: string; acting?: boolean; groups: string[][] };

async function ensureSeat(tx: Tx, tenantId: string, orgUnitId: string, def: SeatDef): Promise<string> {
  const existing = await tx<{ id: string }[]>`
    select id from seats where tenant_id = ${tenantId} and org_unit_id = ${orgUnitId} and label = ${def.label}`;
  if (existing[0]) return existing[0].id;
  const [seat] = await tx<{ id: string }[]>`
    insert into seats (tenant_id, org_unit_id, label, sort, min_rank_id, acting_allowed)
    values (${tenantId}, ${orgUnitId}, ${def.label}, ${def.sort},
            (select id from ranks where tenant_id = ${tenantId} and key = ${def.minRank ?? ''}), ${def.acting ?? false})
    returning id`;
  for (const [i, anyOf] of def.groups.entries()) {
    for (const key of anyOf) {
      await tx`insert into seat_requirements (tenant_id, seat_id, group_no, credential_type_id)
               select ${tenantId}, ${seat!.id}, ${i + 1}, id from credential_types
               where tenant_id = ${tenantId} and key = ${key}`;
    }
  }
  return seat!.id;
}

type Person = {
  id: string;
  seatId: string;
  shift: 'a' | 'b' | 'c';
  kelly: number;
  /** [credential type key, days from today (tenant tz) until it expires]; omitted days = 2 years from issue. */
  creds: [string, number?][];
};

async function giveCredential(tx: Tx, tenantId: string, tz: string, memberId: string, key: string, daysLeft?: number) {
  const [type] = await tx<{ id: string; validity: Parameters<typeof credentialExpiry>[0] }[]>`
    select id, validity from credential_types where tenant_id = ${tenantId} and key = ${key}`;
  const has = await tx`select 1 from member_credentials
                       where member_id = ${memberId} and type_id = ${type!.id} and status = 'active'`;
  if (has.length) return;
  if (daysLeft === undefined) {
    const expires = credentialExpiry(type!.validity, ISSUED_ON);
    await tx`insert into member_credentials (tenant_id, member_id, type_id, number, issued_on, expires_on)
             values (${tenantId}, ${memberId}, ${type!.id}, ${'DEMO-' + key.toUpperCase()}, ${ISSUED_ON}, ${expires})`;
    return;
  }
  await tx`
    insert into member_credentials (tenant_id, member_id, type_id, number, issued_on, expires_on)
    select ${tenantId}, ${memberId}, ${type!.id}, ${'DEMO-' + key.toUpperCase()},
           d - interval '2 years', d
    from (select ((now() at time zone ${tz})::date + ${daysLeft}::int) as d) x`;
}

async function seedRoster(tx: Tx, tenantId: string): Promise<void> {
  const tz = (await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`)[0]!.timezone;
  const units = await ensureUnits(tx, tenantId);
  const emtOrPm = ['emt', 'paramedic'];
  const officer = await ensureSeat(tx, tenantId, units.engine1, {
    label: 'Officer', sort: 1, minRank: 'lieutenant', acting: true, groups: [emtOrPm],
  });
  const driver = await ensureSeat(tx, tenantId, units.engine1, {
    label: 'Driver', sort: 2, groups: [['driver_operator'], emtOrPm],
  });
  const ffpm = await ensureSeat(tx, tenantId, units.engine1, { label: 'FF/PM', sort: 3, groups: [['paramedic']] });
  const medicPm = await ensureSeat(tx, tenantId, units.medic1, { label: 'Paramedic', sort: 1, groups: [['paramedic']] });
  const medicEmt = await ensureSeat(tx, tenantId, units.medic1, { label: 'EMT/Paramedic', sort: 2, groups: [emtOrPm] });

  const roleSets = {
    officer: { rank: 'lieutenant', seat: officer, kelly: 0, creds: [['emt'], ['cpr']] as Person['creds'] },
    driver: { rank: 'driver_engineer', seat: driver, kelly: 1, creds: [['emt'], ['driver_operator'], ['cpr']] as Person['creds'] },
    ffpm: { rank: 'ff_paramedic', seat: ffpm, kelly: 2, creds: [['paramedic'], ['cpr']] as Person['creds'] },
  };
  const demo: { first: string; last: string; shift: 'a' | 'b' | 'c'; role: keyof typeof roleSets; expiring?: boolean }[] = [
    { first: 'Alex', last: 'Ashford', shift: 'a', role: 'officer' },
    { first: 'Avery', last: 'Archer', shift: 'a', role: 'driver' },
    { first: 'Aiden', last: 'Akers', shift: 'a', role: 'ffpm' },
    { first: 'Blake', last: 'Brandt', shift: 'b', role: 'officer' },
    { first: 'Bailey', last: 'Boone', shift: 'b', role: 'driver' },
    { first: 'Casey', last: 'Expiring', shift: 'b', role: 'ffpm', expiring: true },
    { first: 'Cameron', last: 'Cole', shift: 'c', role: 'officer' },
    { first: 'Carmen', last: 'Cruz', shift: 'c', role: 'driver' },
    { first: 'Corey', last: 'Chen', shift: 'c', role: 'ffpm' },
  ];

  const people: Person[] = [];
  for (const [i, d] of demo.entries()) {
    const def = roleSets[d.role];
    const empNo = `DEMO-${String(i + 1).padStart(2, '0')}`;
    await tx`insert into members (tenant_id, employee_number, first_name, last_name, employment_type, rank_id)
             values (${tenantId}, ${empNo}, ${d.first}, ${d.last}, 'career_full_time',
                     (select id from ranks where tenant_id = ${tenantId} and key = ${def.rank}))
             on conflict (tenant_id, employee_number) do nothing`;
    const [m] = await tx<{ id: string }[]>`select id from members where tenant_id = ${tenantId} and employee_number = ${empNo}`;
    const creds: Person['creds'] = d.expiring ? [['paramedic', 20], ['cpr']] : def.creds;
    people.push({ id: m!.id, seatId: def.seat, shift: d.shift, kelly: def.kelly, creds });
  }

  // The dev logins ride Medic 1 on platoon A.
  const logins = [
    { email: DEV_USERS[1]!.email, rank: 'ff_paramedic', seatId: medicPm, kelly: 0, creds: [['paramedic'], ['cpr']] as Person['creds'] },
    { email: DEV_USERS[0]!.email, rank: 'ff_emt', seatId: medicEmt, kelly: 1, creds: [['emt'], ['cpr']] as Person['creds'] },
  ];
  for (const l of logins) {
    const [m] = await tx<{ id: string }[]>`
      select m.id from members m join auth.users u on u.id = m.user_id
      where m.tenant_id = ${tenantId} and u.email = ${l.email}`;
    await tx`update members set rank_id = (select id from ranks where tenant_id = ${tenantId} and key = ${l.rank})
             where id = ${m!.id} and rank_id is null`;
    people.push({ id: m!.id, seatId: l.seatId, shift: 'a', kelly: l.kelly, creds: l.creds });
  }

  for (const p of people) {
    for (const [key, days] of p.creds) await giveCredential(tx, tenantId, tz, p.id, key, days);
    await tx`
      insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, kelly_group, effective)
      select ${tenantId}, ${p.id}, ${p.seatId}, s.id, ${p.kelly}, daterange(${STANDING_FROM}::date, null)
      from shifts s where s.tenant_id = ${tenantId} and s.key = ${p.shift}
        and not exists (select 1 from standing_seats x where x.member_id = ${p.id})`;
  }
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
      // Demo hourly rates so the pay preview shows dollars (only for members with no rate yet).
      await tx`
        insert into member_pay_rates (tenant_id, member_id, hourly_rate, effective, note)
        select m.tenant_id, m.id, case when m.last_name = 'Medic' then 31.25 else 38.00 end, '[2026-01-01,)'::daterange, 'Demo rate'
        from members m
        where m.tenant_id = ${tenantId} and m.user_id is not null
          and not exists (select 1 from member_pay_rates r where r.member_id = m.id)`;
      // Demo opening balances so leave can be tried straight away (only for members with no ledger yet).
      await tx`
        insert into leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date, note)
        select m.tenant_id, m.id, b.id, 'adjust', v.hours, current_date, 'Demo opening balance'
        from members m
        cross join (values ('vacation', 120::numeric), ('sick', 96::numeric)) v(key, hours)
        join leave_banks b on b.tenant_id = m.tenant_id and b.key = v.key
        where m.tenant_id = ${tenantId} and m.user_id is not null
          and not exists (select 1 from leave_ledger l where l.member_id = m.id and l.bank_id = b.id)`;
      await seedRoster(tx, tenantId);
    });
    console.log('Seeded Demo Fire Rescue. Login: admin@soma.local / somadev123!');
  } finally {
    await sql.end();
  }
}

await main();
