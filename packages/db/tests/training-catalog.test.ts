import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { createCredentialType, createMember, createOrgUnit, createRole, createTenant, grantRole, userInTenant } from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, opts: { perms?: string[]; scope?: Parameters<typeof grantRole>[4] } = {}) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (opts.perms?.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, opts.perms), opts.scope);
  return { u, m };
}

async function world(tx: Tx) {
  const t = await createTenant(tx);
  const unit = await createOrgUnit(tx, t);
  const mgr = await person(tx, t, { perms: ['training.course.manage'] });
  const scopedMgr = await person(tx, t, { perms: ['training.course.manage'], scope: { scopeKind: 'org_unit', orgUnitId: unit } });
  const viewer = await person(tx, t, { perms: ['training.course.view'] });
  const nobody = await person(tx, t);
  const [rank] = await tx<{ id: string }[]>`insert into ranks (tenant_id, key, label, sort) values (${t}, 'ff', 'Firefighter', 10) returning id`;
  return { t, unit, mgr, scopedMgr, viewer, nobody, rank: rank!.id };
}

const as = <T>(tx: Tx, w: { t: string }, who: { u: string }, fn: () => Promise<T>) => asUser(tx, { sub: who.u, tenant_id: w.t }, fn);
const cat = async (tx: Tx, key = 'fire') => (await tx<{ id: string }[]>`select app.save_training_category(null, ${key}, 'Fire', 'ISO-company') as id`)[0]!.id;
const WINDOW = { kind: 'calendar_year' };

describe('training catalog writes', () => {
  it('need department-wide training.course.manage', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      for (const who of [w.scopedMgr, w.viewer, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /training\.course\.manage required/, () => tx`select app.save_training_category(null, 'fire', 'Fire', null)`);
          await expectDbError(tx, /permission denied/, () => tx`insert into training_categories (tenant_id, key, label) values (${w.t}, 'x', 'X')`);
        });
      }
      await as(tx, w, w.mgr, async () => {
        const c = await cat(tx);
        const [r] = await tx<{ id: string }[]>`select app.save_training_course(null, 'ems_ce', 'EMS CE', ${c}, 2, null, 100, 'Continuing ed') as id`;
        expect(r!.id).toBeTruthy();
      });
    });
  });

  it('refuses duplicate keys, bad keys and bad numbers', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr, async () => {
        const c = await cat(tx);
        await expectDbError(tx, /duplicate key|training_categories_tenant_id_key_key/, () => cat(tx));
        await expectDbError(tx, /training_categories_key_check/, () => tx`select app.save_training_category(null, 'Bad Key', 'X', null)`);
        await expectDbError(tx, /default_hours_check/, () => tx`select app.save_training_course(null, 'c1', 'C', ${c}, 0, null, 100, null)`);
        await expectDbError(tx, /completion_rule_check/, () => tx`select app.save_training_course(null, 'c2', 'C', ${c}, 1, null, 150, null)`);
      });
    });
  });

  it('a credential type or rank from another department is refused by the composite foreign keys', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      const other = await createTenant(tx, 'Other FD');
      const foreignType = await createCredentialType(tx, other, 'cpr');
      const [foreignRank] = await tx<{ id: string }[]>`insert into ranks (tenant_id, key, label, sort) values (${other}, 'ff', 'FF', 1) returning id`;
      await as(tx, w, w.mgr, async () => {
        const c = await cat(tx);
        await expectDbError(tx, /violates foreign key/, () => tx`select app.save_training_course(null, 'c1', 'C', ${c}, 1, ${foreignType}, 100, null)`);
        await expectDbError(tx, /violates foreign key/, () => tx`select app.save_training_requirement('Hours', ${c}, ${foreignRank!.id}, null, 20, ${tx.json(WINDOW)}, '2026-01-01')`);
      });
    });
  });

  it('archives with a reason and refuses new courses in an archived category', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr, async () => {
        const c = await cat(tx);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.archive_training_category(${c}, 'no')`);
        await tx`select app.archive_training_category(${c}, 'No longer used')`;
        await expectDbError(tx, /category is archived/, () => tx`select app.save_training_course(null, 'c1', 'C', ${c}, 1, null, 100, null)`);
        expect((await tx`select 1 from training_categories where id = ${c} and archived_at is not null`).length).toBe(1);
      });
    });
  });
});

describe('training requirements', () => {
  it('a new effective date ends the earlier version and the old row stays', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr, async () => {
        const c = await cat(tx);
        await tx`select app.save_training_requirement('Fire hours', ${c}, ${w.rank}, null, 20, ${tx.json(WINDOW)}, '2026-01-01')`;
        await tx`select app.save_training_requirement('Fire hours', ${c}, ${w.rank}, null, 24, ${tx.json(WINDOW)}, '2027-01-01')`;
        const rows = await tx<{ required_hours: string; effective_from: string; effective_to: string | null }[]>`
          select required_hours::text, effective_from::text, effective_to::text from training_requirements order by effective_from`;
        expect(rows).toEqual([
          { required_hours: '20.00', effective_from: '2026-01-01', effective_to: '2026-12-31' },
          { required_hours: '24.00', effective_from: '2027-01-01', effective_to: null },
        ]);
      });
    });
  });

  it('refuses an overlapping version for the same category, rank and role, but allows different ones', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr, async () => {
        const c = await cat(tx);
        await tx`select app.save_training_requirement('Fire hours', ${c}, ${w.rank}, null, 20, ${tx.json(WINDOW)}, '2026-01-01')`;
        // Starting before the existing one overlaps it (an earlier open-ended row only closes for a LATER start).
        await expectDbError(tx, /overlaps another/, () => tx`select app.save_training_requirement('Fire hours', ${c}, ${w.rank}, null, 22, ${tx.json(WINDOW)}, '2025-06-01')`);
        // A different rank, and the everyone-requirement, are separate.
        await tx`select app.save_training_requirement('All hours', ${c}, null, null, 10, ${tx.json(WINDOW)}, '2026-01-01')`;
        const c2 = await cat(tx, 'ems');
        await tx`select app.save_training_requirement('EMS hours', ${c2}, ${w.rank}, null, 20, ${tx.json(WINDOW)}, '2026-01-01')`;
      });
    });
  });

  it('validates the window shape', async () => {
    await withAdmin(async (tx) => {
      const w = await world(tx);
      await as(tx, w, w.mgr, async () => {
        const c = await cat(tx);
        const bad = [{ kind: 'weekly' }, { kind: 'rolling_months', months: 0 }, { kind: 'rolling_months' }, { kind: 'fixed_cycle', month: 13, day: 1, years: 1 }, { kind: 'fixed_cycle', month: 1, day: 1 }];
        for (const b of bad) {
          await expectDbError(tx, /span_check/, () => tx`select app.save_training_requirement('X', ${c}, null, null, 5, ${tx.json(b)}, '2026-01-01')`);
        }
        await tx`select app.save_training_requirement('Rolling', ${c}, null, null, 5, ${tx.json({ kind: 'rolling_months', months: 12 })}, '2026-01-01')`;
        await tx`select app.save_training_requirement('Cycle', ${await cat(tx, 'ems')}, null, null, 5, ${tx.json({ kind: 'fixed_cycle', month: 6, day: 30, years: 2 })}, '2026-01-01')`;
      });
    });
  });
});

describe('who can read the catalog', () => {
  it('course viewers and managers can; others cannot; departments are isolated', async () => {
    await withAdmin(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      for (const w of [a, b]) {
        await as(tx, w, w.mgr, async () => {
          await cat(tx);
        });
      }
      const count = (w: { t: string }, who: { u: string }) => as(tx, w, who, async () => (await tx`select 1 from training_categories`).length);
      expect(await count(a, a.viewer)).toBe(1);
      expect(await count(a, a.mgr)).toBe(1);
      expect(await count(a, a.nobody)).toBe(0);
      const rows = await as(tx, a, a.mgr, async () => tx<{ tenant_id: string }[]>`select tenant_id from training_categories`);
      expect(rows.map((r) => r.tenant_id)).toEqual([a.t]);
    });
  });
});
