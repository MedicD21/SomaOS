import { afterAll, describe, expect, it } from 'vitest';
import { can as evaluate, toGrants, type MyGrantRow } from '@soma/auth';
import { expandPattern, isKellyShift, localDateOf, type ShiftPattern } from '@soma/schedule-engine';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { generateRoster } from '@/server/scheduling/generate';
import { approvePatternDraft, savePatternDraft } from '@/server/scheduling/patterns';
import { cancelAssignment, type Can } from '@/server/scheduling/roster';
import { changeStandingSeat } from '@/server/scheduling/standing';

afterAll(() => closeTestDb());

const TZ = 'America/New_York';
// A future window so "future" generated rows exist regardless of today's date.
const FROM = '2027-01-04';
const SWITCH = '2027-01-10';
const TO = '2027-02-15';
const today = () => localDateOf(new Date(), TZ);

type Demo = { tenantId: string; userId: string };

async function demo(tx: Tx): Promise<Demo> {
  const [row] = await tx<Demo[]>`
    select t.id as "tenantId", u.id as "userId"
    from tenants t, auth.users u where t.slug = 'demo-fire-rescue' and u.email = 'admin@soma.local'`;
  if (!row) throw new Error('Demo Fire Rescue is not seeded; run supabase db reset && pnpm db:seed');
  return row;
}

async function asDeptAdmin<T>(tx: Tx, d: Demo, fn: (can: Can) => Promise<T>): Promise<T> {
  return asUser(tx, { sub: d.userId, tenant_id: d.tenantId }, async () => {
    const grants = toGrants(await tx<MyGrantRow[]>`select * from app.my_grants()`);
    const [me] = await tx<{ id: string }[]>`select app.my_member_id() as id`;
    return fn((permission, target) => evaluate(grants, me!.id, permission, target, new Date()).allowed);
  });
}

async function memberByEmail(tx: Tx, email: string): Promise<string> {
  const [m] = await tx<{ id: string }[]>`
    select m.id from members m join auth.users u on u.id = m.user_id
    join tenants t on t.id = m.tenant_id where u.email = ${email} and t.slug = 'demo-fire-rescue'`;
  return m!.id;
}

type Row = { date: string; start: Date; type: string; seat_id: string | null; pattern_version: number };

async function scheduled(tx: Tx, memberId: string): Promise<Row[]> {
  return [...(await tx<Row[]>`
    select (lower(during) at time zone ${TZ})::date::text as date, lower(during) as start, type, seat_id, pattern_version
    from shift_assignments
    where member_id = ${memberId} and source = 'generated' and status = 'scheduled'
      and lower(during) >= (${FROM}::date::timestamp at time zone ${TZ}) and lower(during) < (${TO}::date::timestamp at time zone ${TZ})
    order by lower(during)`)];
}

async function currentPattern(tx: Tx): Promise<ShiftPattern> {
  const [p] = await tx<{ payload: ShiftPattern }[]>`
    select payload from config_versions where kind = 'schedule.pattern' and status = 'approved' order by version desc limit 1`;
  return p!.payload;
}

describe('pattern approval supersedes generated shifts', () => {
  it('regenerates the same-start shifts with the new Kelly layout', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const riley = await memberByEmail(tx, 'member@soma.local'); // platoon A, Kelly group 0
      await asDeptAdmin(tx, d, async (can) => {
        await generateRoster(tx, can, FROM, TO);
        const v1 = await currentPattern(tx);
        const v2: ShiftPattern = { ...v1, kelly: { everyNthShift: 6 } }; // same 07:00 start
        const version = await savePatternDraft(tx, v2);
        const r = await approvePatternDraft(tx, version, SWITCH, today());
        expect(r.superseded).toBeGreaterThan(0);

        const [stale] = await tx<{ status: string; cancelled_reason: string }[]>`
          select status, cancelled_reason from shift_assignments
          where member_id = ${riley} and source = 'generated' and status <> 'scheduled' limit 1`;
        expect(stale).toEqual({ status: 'superseded', cancelled_reason: 'Pattern version 1 replaced' });

        await generateRoster(tx, can, FROM, TO);
        const rows = await scheduled(tx, riley);
        const expected = [
          ...expandPattern(v1, 'a', FROM, SWITCH, TZ).map((i) => ({ i, p: v1, v: 1 })),
          ...expandPattern(v2, 'a', SWITCH, TO, TZ).map((i) => ({ i, p: v2, v: version })),
        ];
        // No missing shifts: one row per on-duty day, each from the version in force that day.
        expect(rows.map((x) => [x.date, x.start.toISOString(), x.pattern_version])).toEqual(
          expected.map((e) => [e.i.date, e.i.start.toISOString(), e.v]),
        );
        expect(rows.map((x) => x.type === 'kelly')).toEqual(expected.map((e) => isKellyShift(e.p, e.i.index, 0)));
        // The Kelly layout actually changed after the switch.
        const after = expected.filter((e) => e.v === version);
        expect(after.map((e) => isKellyShift(v1, e.i.index, 0))).not.toEqual(after.map((e) => isKellyShift(v2, e.i.index, 0)));
      });
    });
  });

  it('keeps a user-cancelled generated shift cancelled across approval and regeneration', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const riley = await memberByEmail(tx, 'member@soma.local');
      await asDeptAdmin(tx, d, async (can) => {
        await generateRoster(tx, can, FROM, TO);
        const target = (await scheduled(tx, riley)).find((x) => x.date >= SWITCH && x.type === 'regular')!;
        const [row] = await tx<{ id: string }[]>`
          select id from shift_assignments where member_id = ${riley} and source = 'generated' and lower(during) = ${target.start}`;
        await cancelAssignment(tx, row!.id, 'Approved leave day');

        const version = await savePatternDraft(tx, { ...(await currentPattern(tx)), shiftHours: 24 });
        await approvePatternDraft(tx, version, SWITCH, today());
        await generateRoster(tx, can, FROM, TO);

        const same = await tx<{ status: string }[]>`
          select status from shift_assignments where member_id = ${riley} and source = 'generated' and lower(during) = ${target.start}`;
        expect(same).toEqual([{ status: 'cancelled' }]);
        expect((await scheduled(tx, riley)).some((x) => x.date === target.date)).toBe(false);
      });
    });
  });
});

describe('standing seat change supersedes the member’s generated shifts', () => {
  it('puts the member on the new seat from the change date after regeneration', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const [ids] = await tx<{ corey: string; ffpm: string; medic: string; c: string }[]>`
        select (select id from members where first_name = 'Corey' and last_name = 'Chen') as corey,
               (select s.id from seats s join org_units ou on ou.id = s.org_unit_id where ou.name = 'Engine 1' and s.label = 'FF/PM') as ffpm,
               (select s.id from seats s join org_units ou on ou.id = s.org_unit_id where ou.name = 'Medic 1' and s.label = 'Paramedic') as medic,
               (select id from shifts where tenant_id = ${d.tenantId} and key = 'c') as c`;
      await asDeptAdmin(tx, d, async (can) => {
        await generateRoster(tx, can, FROM, TO);
        const r = await changeStandingSeat(tx, {
          memberId: ids!.corey, seatId: ids!.medic, platoonShiftId: ids!.c, kellyGroup: 2, effectiveFrom: SWITCH,
        });
        expect(r.superseded).toBeGreaterThan(0);
        const [reason] = await tx<{ cancelled_reason: string }[]>`
          select cancelled_reason from shift_assignments where member_id = ${ids!.corey} and status = 'superseded' limit 1`;
        expect(reason!.cancelled_reason).toBe('Regular seat changed');

        await generateRoster(tx, can, FROM, TO);
        const rows = await scheduled(tx, ids!.corey);
        const cDays = expandPattern(await currentPattern(tx), 'c', FROM, TO, TZ).map((i) => i.date);
        expect(rows.map((x) => x.date)).toEqual(cDays); // no missing shifts
        for (const x of rows.filter((y) => y.type !== 'kelly')) {
          expect(x.seat_id).toBe(x.date < SWITCH ? ids!.ffpm : ids!.medic);
        }
        const [ss] = await tx<{ upper: string }[]>`
          select upper(effective)::text as upper from standing_seats where member_id = ${ids!.corey} and seat_id = ${ids!.ffpm}`;
        expect(ss!.upper).toBe(SWITCH);
      });
    });
  });
});
