import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import {
  createCredentialType,
  createMember,
  createOrgUnit,
  createRole,
  createSeat,
  createTenant,
  grantRole,
  userInTenant,
} from './helpers';

afterAll(closeTestDb);

async function actor(
  tx: Tx,
  t: string,
  perms: string[],
  scope: { scopeKind?: 'self' | 'org_unit' | 'department'; orgUnitId?: string | null } = {},
) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `s_${m.slice(0, 6)}`, perms), scope);
  return { u, m };
}

async function createShift(tx: Tx, t: string, key = 'A'): Promise<string> {
  const r = await tx<{ id: string }[]>`
    insert into shifts (tenant_id, key, label) values (${t}, ${key}, ${key}) returning id`;
  return r[0]!.id;
}

const DAY1 = '[2026-12-01 07:00+00,2026-12-02 07:00+00)';
const DAY1_HALF = '[2026-12-01 19:00+00,2026-12-02 07:00+00)';
const DAY2 = '[2026-12-02 07:00+00,2026-12-03 07:00+00)';

type AssignOpts = {
  seatId?: string | null;
  type?: string;
  source?: 'generated' | 'manual';
  overrideReason?: string | null;
};
function assign(tx: Tx, t: string, memberId: string, during: string, o: AssignOpts = {}) {
  return tx`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source, override_reason)
    values (${t}, ${memberId}, ${o.seatId ?? null}, ${during}::tstzrange, ${o.type ?? 'regular'},
            ${o.source ?? 'manual'}, ${o.overrideReason ?? null})
    returning id`;
}

describe('tenant isolation', () => {
  it('isolates seats, seat_requirements, standing_seats and shift_assignments', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'Iso A');
      const b = await createTenant(tx, 'Iso B');
      const fx: Record<string, { unit: string; seat: string; member: string; shift: string; type: string }> = {};
      for (const t of [a, b]) {
        const unit = await createOrgUnit(tx, t);
        const seat = await createSeat(tx, t, unit);
        const member = await createMember(tx, t);
        const shift = await createShift(tx, t);
        const type = await createCredentialType(tx, t, 'emt');
        await tx`insert into seat_requirements (tenant_id, seat_id, group_no, credential_type_id) values (${t}, ${seat}, 0, ${type})`;
        await tx`insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, effective)
          values (${t}, ${member}, ${seat}, ${shift}, '[2026-01-01,)'::daterange)`;
        await assign(tx, t, member, DAY1, { seatId: seat });
        fx[t] = { unit, seat, member, shift, type };
      }
      const v = await actor(tx, a, ['scheduling.config.manage', 'scheduling.roster.edit']);
      const fb = fx[b]!;
      await asUser(tx, { sub: v.u, tenant_id: a }, async () => {
        for (const table of ['seats', 'seat_requirements', 'standing_seats', 'shift_assignments']) {
          const rows = await tx`select distinct tenant_id from ${tx(table)}`;
          expect(rows.map((r) => r.tenant_id), table).toEqual([a]);
        }
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into seats (tenant_id, org_unit_id, label) values (${b}, ${fb.unit}, 'x')`);
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into seat_requirements (tenant_id, seat_id, group_no, credential_type_id) values (${b}, ${fb.seat}, 1, ${fb.type})`);
        await expectDbError(tx, /row-level security/, () =>
          tx`insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, effective)
             values (${b}, ${fb.member}, ${fb.seat}, ${fb.shift}, '[2030-01-01,)'::daterange)`);
        await expectDbError(tx, /row-level security/, () => assign(tx, b, fb.member, DAY2, { seatId: fb.seat }));
      });
    });
  });
});

describe('config tables', () => {
  it('require department-wide scheduling.config.manage to write', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const plain = await actor(tx, t, ['scheduling.roster.edit']);
      const station = await actor(tx, t, ['scheduling.config.manage'], { scopeKind: 'org_unit', orgUnitId: unit });
      const admin = await actor(tx, t, ['scheduling.config.manage']);
      for (const who of [plain, station]) {
        await asUser(tx, { sub: who.u, tenant_id: t }, async () => {
          await expectDbError(tx, /row-level security/, () =>
            tx`insert into seats (tenant_id, org_unit_id, label) values (${t}, ${unit}, 'x')`);
        });
      }
      await asUser(tx, { sub: admin.u, tenant_id: t }, async () => {
        await tx`insert into seats (tenant_id, org_unit_id, label) values (${t}, ${unit}, 'x')`;
      });
    });
  });

  it('cannot hard-delete seats or standing seats; can replace seat requirements', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const type = await createCredentialType(tx, t, 'emt');
      await tx`insert into seat_requirements (tenant_id, seat_id, group_no, credential_type_id) values (${t}, ${seat}, 0, ${type})`;
      const admin = await actor(tx, t, ['scheduling.config.manage']);
      const plain = await actor(tx, t, []);
      await asUser(tx, { sub: plain.u, tenant_id: t }, async () => {
        expect(await tx`delete from seat_requirements returning seat_id`).toHaveLength(0);
      });
      await asUser(tx, { sub: admin.u, tenant_id: t }, async () => {
        await expectDbError(tx, /permission denied/, () => tx`delete from seats`);
        await expectDbError(tx, /permission denied/, () => tx`delete from standing_seats`);
        expect(await tx`delete from seat_requirements returning seat_id`).toHaveLength(1);
      });
    });
  });

  it('rejects overlapping standing seats for one member', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const seat2 = await createSeat(tx, t, unit, 'Engine 1 Driver');
      const shift = await createShift(tx, t);
      const m = await createMember(tx, t);
      await tx`insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, kelly_group, effective)
        values (${t}, ${m}, ${seat}, ${shift}, 0, '[2026-01-01,)'::daterange)`;
      await expectDbError(tx, /standing_seats_member_no_overlap/, () =>
        tx`insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, effective)
           values (${t}, ${m}, ${seat2}, ${shift}, '[2026-06-01,)'::daterange)`);
      await expectDbError(tx, /check constraint/, () =>
        tx`insert into standing_seats (tenant_id, member_id, seat_id, platoon_shift_id, kelly_group, effective)
           values (${t}, ${m}, ${seat2}, ${shift}, 30, '[2025-01-01,2025-06-01)'::daterange)`);
    });
  });
});

describe('shift_assignments constraints', () => {
  it('prevents double-booking a member, but kelly days do not occupy', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const s1 = await createSeat(tx, t, unit);
      const s2 = await createSeat(tx, t, unit, 'Medic 1');
      const m = await createMember(tx, t);
      await assign(tx, t, m, DAY1, { seatId: s1 });
      await expectDbError(tx, /shift_assignments_member_no_overlap/, () =>
        assign(tx, t, m, DAY1_HALF, { seatId: s2, type: 'overtime' }));

      const k = await createMember(tx, t);
      await assign(tx, t, k, DAY1, { type: 'kelly' });
      await assign(tx, t, k, DAY1_HALF, { seatId: s2, type: 'overtime' });
    });
  });

  it('prevents double-booking a seat until the first assignment is cancelled', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const m1 = await createMember(tx, t);
      const m2 = await createMember(tx, t);
      const [first] = await assign(tx, t, m1, DAY1, { seatId: seat });
      await expectDbError(tx, /shift_assignments_seat_no_overlap/, () => assign(tx, t, m2, DAY1_HALF, { seatId: seat }));
      await tx`update shift_assignments set status = 'cancelled', cancelled_reason = 'sick' where id = ${first!.id}`;
      await assign(tx, t, m2, DAY1_HALF, { seatId: seat });
    });
  });

  it('makes generation idempotent per member and start (including cancelled rows)', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const m = await createMember(tx, t);
      const [row] = await assign(tx, t, m, DAY1, { seatId: seat, source: 'generated' });
      await tx`update shift_assignments set status = 'cancelled' where id = ${row!.id}`;
      const again = await tx`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
        values (${t}, ${m}, ${seat}, ${DAY1}::tstzrange, 'regular', 'generated')
        on conflict do nothing returning id`;
      expect(again).toHaveLength(0);
    });
  });

  it('enforces seat/kelly shape and non-empty ranges', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const m = await createMember(tx, t);
      await expectDbError(tx, /check constraint/, () => assign(tx, t, m, DAY1, { type: 'regular' }));
      await expectDbError(tx, /check constraint/, () => assign(tx, t, m, DAY1, { seatId: seat, type: 'kelly' }));
      await expectDbError(tx, /check constraint/, () => assign(tx, t, m, DAY1, { seatId: seat, type: 'vacation' }));
      await expectDbError(tx, /check constraint/, () =>
        assign(tx, t, m, '[2026-12-01 07:00+00,2026-12-01 07:00+00)', { seatId: seat }));
      await assign(tx, t, m, DAY1, { type: 'training' });
    });
  });
});

describe('shift_assignments permissions', () => {
  it('requires scheduling.qualification.override to record an override', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const m = await createMember(tx, t);
      const editor = await actor(tx, t, ['scheduling.roster.edit']);
      const boss = await actor(tx, t, ['scheduling.roster.edit', 'scheduling.qualification.override']);
      await asUser(tx, { sub: editor.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () =>
          assign(tx, t, m, DAY1, { seatId: seat, overrideReason: 'short staffed' }));
      });
      await asUser(tx, { sub: boss.u, tenant_id: t }, async () => {
        await assign(tx, t, m, DAY1, { seatId: seat, overrideReason: 'short staffed' });
      });
    });
  });

  it('limits a station-scoped roster editor to seats in that station', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const st1 = await createOrgUnit(tx, t, 'Station 1');
      const st2 = await createOrgUnit(tx, t, 'Station 2');
      const seat1 = await createSeat(tx, t, st1);
      const seat2 = await createSeat(tx, t, st2);
      const m = await createMember(tx, t);
      const ed = await actor(tx, t, ['scheduling.roster.edit'], { scopeKind: 'org_unit', orgUnitId: st1 });
      await asUser(tx, { sub: ed.u, tenant_id: t }, async () => {
        const [row] = await assign(tx, t, m, DAY1, { seatId: seat1 });
        await expectDbError(tx, /row-level security/, () => assign(tx, t, m, DAY2, { seatId: seat2 }));
        // Cannot move an own-station row to another station.
        await expectDbError(tx, /row-level security/, () =>
          tx`update shift_assignments set seat_id = ${seat2} where id = ${row!.id}`);
        // Kelly rows (no seat) require department scope.
        await expectDbError(tx, /row-level security/, () => assign(tx, t, m, DAY2, { type: 'kelly' }));
      });
    });
  });

  it('denies self-scoped roster editors and allows department editors to write kelly rows', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const self = await actor(tx, t, ['scheduling.roster.edit'], { scopeKind: 'self' });
      const dept = await actor(tx, t, ['scheduling.roster.edit']);
      await asUser(tx, { sub: self.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () => assign(tx, t, self.m, DAY1, { seatId: seat }));
        await expectDbError(tx, /row-level security/, () => assign(tx, t, self.m, DAY1, { type: 'kelly' }));
      });
      await asUser(tx, { sub: dept.u, tenant_id: t }, async () => {
        await assign(tx, t, dept.m, DAY1, { type: 'kelly' });
        await assign(tx, t, dept.m, DAY2, { seatId: seat });
      });
    });
  });

  it('cannot be hard-deleted and is audited', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const unit = await createOrgUnit(tx, t);
      const seat = await createSeat(tx, t, unit);
      const dept = await actor(tx, t, ['scheduling.roster.edit']);
      await asUser(tx, { sub: dept.u, tenant_id: t }, async () => {
        await assign(tx, t, dept.m, DAY1, { seatId: seat });
        await expectDbError(tx, /permission denied/, () => tx`delete from shift_assignments`);
      });
      const audited = await tx`select distinct table_name from audit_log
        where tenant_id = ${t} and table_name in ('seats','shift_assignments') order by 1`;
      expect(audited.map((r) => r.table_name)).toEqual(['seats', 'shift_assignments']);
    });
  });
});
