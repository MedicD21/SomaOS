import { afterAll, describe, expect, it } from 'vitest';
import { can as evaluate, toGrants, type MyGrantRow } from '@soma/auth';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { generateRoster } from '@/server/scheduling/generate';
import { loadPatterns } from '@/server/scheduling/load';
import { assignToSeat, cancelAssignment, loadRoster, type Can } from '@/server/scheduling/roster';

afterAll(() => closeTestDb());

const TZ = 'America/New_York';

type Demo = { tenantId: string; userId: string };

async function demo(tx: Tx): Promise<Demo> {
  const [row] = await tx<Demo[]>`
    select t.id as "tenantId", u.id as "userId"
    from tenants t, auth.users u where t.slug = 'demo-fire-rescue' and u.email = 'admin@soma.local'`;
  if (!row) throw new Error('Demo Fire Rescue is not seeded; run supabase db reset && pnpm db:seed');
  return row;
}

/** Runs fn as the seeded department admin with a permission checker built from their real grants. */
async function asDeptAdmin<T>(tx: Tx, d: Demo, fn: (can: Can) => Promise<T>): Promise<T> {
  return asUser(tx, { sub: d.userId, tenant_id: d.tenantId }, async () => {
    const grants = toGrants(await tx<MyGrantRow[]>`select * from app.my_grants()`);
    const [me] = await tx<{ id: string }[]>`select app.my_member_id() as id`;
    return fn((permission, target) => evaluate(grants, me!.id, permission, target, new Date()).allowed);
  });
}

async function seatId(tx: Tx, unit: string, label: string): Promise<string> {
  const [s] = await tx<{ id: string }[]>`
    select s.id from seats s join org_units ou on ou.id = s.org_unit_id where ou.name = ${unit} and s.label = ${label}`;
  return s!.id;
}

/** [07:00 on date, 07:00 the next day) in the demo timezone, as ISO strings. */
async function shiftOn(tx: Tx, date: string): Promise<{ start: string; end: string }> {
  const [r] = await tx<{ start: Date; end: Date }[]>`
    select (${date}::date + time '07:00') at time zone ${TZ} as start,
           (${date}::date + 1 + time '07:00') at time zone ${TZ} as "end"`;
  return { start: r!.start.toISOString(), end: r!.end.toISOString() };
}

describe('loadPatterns', () => {
  it('returns the approved demo pattern', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asDeptAdmin(tx, d, async () => {
        const patterns = await loadPatterns(tx);
        expect(patterns).toHaveLength(1);
        expect(patterns[0]).toMatchObject({ kind: 'schedule.pattern', version: 1, effectiveTo: null });
        expect(patterns[0]!.payload).toMatchObject({ shiftHours: 24, platoons: { a: 0, b: 1, c: 2 } });
      });
    });
  });
});

describe('generateRoster', () => {
  it('is idempotent, keeps cancellations and leaves manual rows alone', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const officer = await seatId(tx, 'Engine 1', 'Officer');
      const [extra] = await tx<{ id: string }[]>`
        insert into members (tenant_id, employee_number, first_name, last_name, employment_type)
        values (${d.tenantId}, 'OT-1', 'Owen', 'Overtime', 'career_full_time') returning id`;
      const ot = await shiftOn(tx, '2026-12-05');
      const [manual] = await tx<{ id: string }[]>`
        insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
        values (${d.tenantId}, ${extra!.id}, ${officer}, tstzrange(${ot.start}, ${ot.end}), 'overtime', 'manual')
        returning id`;

      await asDeptAdmin(tx, d, async (can) => {
        const first = await generateRoster(tx, can, '2026-12-01', '2027-01-01');
        expect(first.inserted).toBeGreaterThan(0);
        expect(first.skipped).toBeGreaterThanOrEqual(1); // the officer seat on Dec 5 is taken

        const second = await generateRoster(tx, can, '2026-12-01', '2027-01-01');
        expect(second).toEqual({ inserted: 0, skipped: first.inserted + first.skipped });

        const [gen] = await tx<{ id: string }[]>`
          select id from shift_assignments where source = 'generated' and type = 'regular' order by lower(during) limit 1`;
        await cancelAssignment(tx, gen!.id, 'Station closed for repairs');
        const third = await generateRoster(tx, can, '2026-12-01', '2027-01-01');
        expect(third.inserted).toBe(0);
        const [after] = await tx`select status, cancelled_reason from shift_assignments where id = ${gen!.id}`;
        expect(after).toMatchObject({ status: 'cancelled', cancelled_reason: 'Station closed for repairs' });

        const [m] = await tx`select status, type, source, member_id from shift_assignments where id = ${manual!.id}`;
        expect(m).toMatchObject({ status: 'scheduled', type: 'overtime', source: 'manual', member_id: extra!.id });
        const clash = await tx`
          select 1 from shift_assignments
          where seat_id = ${officer} and source = 'generated' and lower(during) = ${ot.start}::timestamptz`;
        expect(clash).toHaveLength(0);
      });
    });
  });

  it('cancelAssignment requires a 5-500 character reason', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asDeptAdmin(tx, d, async (can) => {
        await generateRoster(tx, can, '2026-12-01', '2026-12-02');
        const [gen] = await tx<{ id: string }[]>`select id from shift_assignments where source = 'generated' limit 1`;
        const msg = 'A cancel reason of at least 5 characters is required';
        await expect(cancelAssignment(tx, gen!.id, '   ab   ')).rejects.toThrow(new RangeError(msg));
        await expect(cancelAssignment(tx, gen!.id, 'x'.repeat(501))).rejects.toThrow(RangeError);
        await cancelAssignment(tx, gen!.id, '  Sick leave  ');
        const [row] = await tx`select status, cancelled_reason from shift_assignments where id = ${gen!.id}`;
        expect(row).toMatchObject({ status: 'cancelled', cancelled_reason: 'Sick leave' });
      });
    });
  });

  it('rejects more than 120 days', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asDeptAdmin(tx, d, async (can) => {
        await expect(generateRoster(tx, can, '2026-12-01', '2027-04-01')).rejects.toThrow(RangeError);
        await expect(generateRoster(tx, can, '2026-12-01', '2027-04-01')).rejects.toThrow(
          'Generate at most 120 days at a time',
        );
      });
    });
  });

  it('requires department-wide roster edit', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asDeptAdmin(tx, d, async () => {
        await expect(generateRoster(tx, () => false, '2026-12-01', '2026-12-02')).rejects.toThrow(/roster/);
      });
    });
  });
});

describe('assignToSeat', () => {
  async function caseyAfterExpiry(tx: Tx) {
    const [c] = await tx<{ memberId: string; after: string }[]>`
      select m.id as "memberId", (mc.expires_on + 10)::text as after
      from members m
      join member_credentials mc on mc.member_id = m.id
      join credential_types t on t.id = mc.type_id and t.key = 'paramedic'
      where m.first_name = 'Casey' and m.last_name = 'Expiring'`;
    const seat = await seatId(tx, 'Engine 1', 'FF/PM');
    return { memberId: c!.memberId, seatId: seat, date: c!.after, ...(await shiftOn(tx, c!.after)) };
  }

  it('blocks an expired credential, then allows an audited override', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const c = await caseyAfterExpiry(tx);
      await asDeptAdmin(tx, d, async (can) => {
        const input = { seatId: c.seatId, memberId: c.memberId, start: c.start, end: c.end, type: 'regular' as const };
        const blocked = await assignToSeat(tx, can, input);
        expect(blocked.ok).toBe(false);
        if (blocked.ok) throw new Error('unreachable');
        expect(blocked.blocked.map((e) => e.rule)).toContain('credential.expired_before_shift_end');
        expect(await tx`select 1 from shift_assignments where member_id = ${c.memberId}`).toHaveLength(0);

        const reason = 'Renewal card in hand, state lookup pending';
        const ok = await assignToSeat(tx, can, { ...input, overrideReason: reason });
        expect(ok.ok).toBe(true);
        const [row] = await tx<{ override_reason: string; source: string; acting: boolean; explain: { rule: string }[] }[]>`
          select override_reason, source, acting, explain from shift_assignments where member_id = ${c.memberId}`;
        expect(row).toMatchObject({ override_reason: reason, source: 'manual', acting: false });
        expect(row!.explain.map((e) => e.rule)).toContain('credential.expired_before_shift_end');

        const day = await loadRoster(tx, c.date, null);
        const engine = day.units.find((u) => u.name === 'Engine 1')!;
        const ffpm = engine.seats.find((s) => s.seat.label === 'FF/PM')!;
        expect(ffpm.assignment).toMatchObject({ memberName: 'Casey Expiring', overrideReason: reason, acting: false });
        expect(ffpm.issues.map((e) => e.rule)).toContain('credential.expired_before_shift_end');
      });
    });
  });

  it('needs the override permission to override', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const c = await caseyAfterExpiry(tx);
      await asDeptAdmin(tx, d, async (can) => {
        const noOverride: Can = (p, t) => p !== 'scheduling.qualification.override' && can(p, t);
        const res = await assignToSeat(tx, noOverride, {
          seatId: c.seatId, memberId: c.memberId, start: c.start, end: c.end, type: 'regular', overrideReason: 'Please allow',
        });
        expect(res.ok).toBe(false);
        if (res.ok) throw new Error('unreachable');
        expect(res.blocked[0]!.rule).toBe('permission');
      });
    });
  });

  it('rejects an empty time range, kelly type and separated members without touching the DB', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const c = await caseyAfterExpiry(tx);
      const [alex] = await tx<{ id: string }[]>`select id from members where first_name = 'Alex' and last_name = 'Ashford'`;
      const base = { seatId: c.seatId, memberId: alex!.id, start: c.start, end: c.end, type: 'regular' as const };
      const rules = async (p: Promise<{ ok: boolean; blocked?: { rule: string }[] }>) => {
        const r = await p;
        expect(r.ok).toBe(false);
        return r.blocked!.map((e) => e.rule);
      };
      await asDeptAdmin(tx, d, async (can) => {
        expect(await rules(assignToSeat(tx, can, { ...base, end: base.start }))).toEqual(['input.invalid_range']);
        expect(await rules(assignToSeat(tx, can, { ...base, type: 'kelly' }))).toEqual(['input.invalid_type']);
      });
      await tx`update members set status = 'separated', separated_on = ${c.date}::date where id = ${alex!.id}`;
      await asDeptAdmin(tx, d, async (can) => {
        expect(await rules(assignToSeat(tx, can, base))).toEqual(['member.separated']);
      });
      // Separation dated on or before the shift blocks even if status is not yet 'separated'.
      await tx`update members set status = 'active', separated_on = ${c.date}::date - 1 where id = ${alex!.id}`;
      await asDeptAdmin(tx, d, async (can) => {
        expect(await rules(assignToSeat(tx, can, base))).toEqual(['member.separated']);
      });
      expect(await tx`select 1 from shift_assignments where member_id = ${alex!.id}`).toHaveLength(0);
    });
  });

  it('refuses callers without roster edit on the seat unit', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const c = await caseyAfterExpiry(tx);
      await asDeptAdmin(tx, d, async () => {
        const res = await assignToSeat(tx, () => false, {
          seatId: c.seatId, memberId: c.memberId, start: c.start, end: c.end, type: 'regular',
        });
        expect(res).toEqual({ ok: false, blocked: [{ rule: 'permission', message: "You cannot change this unit's roster." }] });
      });
    });
  });
});

describe('loadRoster', () => {
  it('shows each unit with seats, assignments and required counts', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const [medic] = await tx<{ id: string }[]>`select id from org_units where name = 'Medic 1'`;
      await asDeptAdmin(tx, d, async (can) => {
        await generateRoster(tx, can, '2026-12-01', '2026-12-04');
        const day = await loadRoster(tx, '2026-12-02', null);
        expect(day.units.map((u) => u.name)).toEqual(expect.arrayContaining(['Engine 1', 'Medic 1']));
        const engine = day.units.find((u) => u.name === 'Engine 1')!;
        expect(engine.seats.map((s) => s.seat.label)).toEqual(['Officer', 'Driver', 'FF/PM']);
        expect(engine.requiredTotal).toBe(3);
        expect(engine.requiredFilled).toBe(engine.seats.filter((s) => s.assignment).length);
        expect(engine.requiredFilled).toBeGreaterThan(0);
        for (const s of engine.seats) {
          if (!s.assignment) continue;
          expect(new Date(s.assignment.start).toISOString()).toBe((await shiftOn(tx, '2026-12-02')).start);
        }

        const medicOnly = await loadRoster(tx, '2026-12-02', medic!.id);
        expect(medicOnly.units.map((u) => u.name)).toEqual(['Medic 1']);
      });
    });
  });
});
