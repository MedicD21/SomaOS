import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { can as evaluate, toGrants, type MyGrantRow } from '@soma/auth';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import type { PayRules, ShiftPattern } from '@soma/schedule-engine';
import { TEMPLATES } from '@soma/templates';
import { calculatePayPeriod } from '@/server/pay/load';
import { checkDraft, loadDraft, requireSimulation, simulationTokenFor } from '@/server/rules/guard';
import { simulateAccrual, simulatePattern, simulatePay } from '@/server/rules/simulate';
import { generateRoster } from '@/server/scheduling/generate';

let savedSecret: string | undefined;
beforeAll(() => {
  savedSecret = process.env.SOMA_SIM_TOKEN_SECRET;
  process.env.SOMA_SIM_TOKEN_SECRET = 'db-test-secret-with-enough-length-0123456789';
});
afterAll(async () => {
  if (savedSecret === undefined) delete process.env.SOMA_SIM_TOKEN_SECRET;
  else process.env.SOMA_SIM_TOKEN_SECRET = savedSecret;
  await closeTestDb();
});

const PERIOD = { start: '2026-01-01', endExclusive: '2026-01-29' };
const STARTER = TEMPLATES['career-3-platoon'].pay.rules[0]!.payload as PayRules;
const LOW: PayRules = { ...STARTER, workPeriod: { ...STARTER.workPeriod, threshold: 96 } };
/** Low enough that Riley's four or five 24 h shifts in a 14-day period always cross it. */
const LOWEST: PayRules = { ...STARTER, workPeriod: { ...STARTER.workPeriod, threshold: 48 } };
const HIGH: PayRules = { ...STARTER, workPeriod: { ...STARTER.workPeriod, threshold: 150 } };

type Demo = { tenantId: string; adminId: string; memberUserId: string; rileyId: string };

async function demo(tx: Tx): Promise<Demo> {
  const [row] = await tx<Demo[]>`
    select t.id as "tenantId", a.id as "adminId", u.id as "memberUserId", m.id as "rileyId"
    from tenants t, auth.users a, auth.users u, members m
    where t.slug = 'demo-fire-rescue' and a.email = 'admin@soma.local' and u.email = 'member@soma.local'
      and m.user_id = u.id and m.tenant_id = t.id`;
  if (!row) throw new Error('Demo Fire Rescue is not seeded; run supabase db reset && pnpm db:seed');
  return row;
}

const asAdmin = <T>(tx: Tx, d: Demo, fn: () => Promise<T>): Promise<T> => asUser(tx, { sub: d.adminId, tenant_id: d.tenantId }, fn);

/** Approved v2 (threshold 150) and an open draft v3 (threshold 96), both from the demo tenant's default group. */
async function rulesWithDraft(tx: Tx, d: Demo, draft: unknown = LOW): Promise<void> {
  await tx`delete from config_versions where tenant_id = ${d.tenantId} and kind = 'pay.rules'`;
  await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
           values (${d.tenantId}, 'pay.rules', 'default', 2, 'approved',
                   tstzrange('2025-01-01'::date::timestamp at time zone 'America/New_York', null), ${tx.json(HIGH as never)})`;
  await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
           values (${d.tenantId}, 'pay.rules', 'default', 3, 'draft', tstzrange(null, null), ${tx.json(draft as never)})`;
}

async function generate(tx: Tx, d: Demo): Promise<void> {
  await asAdmin(tx, d, async () => {
    const grants = toGrants(await tx<MyGrantRow[]>`select * from app.my_grants()`);
    const [me] = await tx<{ id: string }[]>`select app.my_member_id() as id`;
    await generateRoster(tx, (p, t) => evaluate(grants, me!.id, p, t, new Date()).allowed, PERIOD.start, PERIOD.endExclusive);
  });
}

const counts = async (tx: Tx) =>
  (await tx<{ n: number }[]>`
    select (select count(*) from config_versions) + (select count(*) from leave_ledger) + (select count(*) from audit_log)
         + (select count(*) from shift_assignments) + (select count(*) from time_entries) + (select count(*) from pay_period_closes) as n`)[0]!.n.toString();

describe('checkDraft', () => {
  it('accepts the starter rules and explains what is wrong with a broken draft, in plain English by field', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asAdmin(tx, d, async () => {
        expect((await checkDraft(tx, 'pay.rules', 'default', STARTER)).ok).toBe(true);
        const bad = await checkDraft(tx, 'pay.rules', 'default', { ...STARTER, workPeriod: { ...STARTER.workPeriod, multiplier: 9 } });
        expect(bad).toEqual({ ok: false, errors: { 'workPeriod.multiplier': 'Enter a number no larger than 5.' } });
      });
    });
  });

  it('refuses references to pay codes, comp banks, shifts and leave banks that do not exist', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asAdmin(tx, d, async () => {
        const noCode = await checkDraft(tx, 'pay.rules', 'default', { ...STARTER, assignments: { ...STARTER.assignments, holdover: { code: 'nope', multiplier: 1.5 } } });
        expect(noCode).toMatchObject({ ok: false, errors: { 'assignments.holdover.code': 'There is no pay code "nope". Add it under Pay codes first.' } });
        const noBank = await checkDraft(tx, 'pay.rules', 'default', { ...STARTER, compTime: { mode: 'always', multiplier: 1.5, bankKey: 'nope' } });
        expect(noBank).toMatchObject({ ok: false, errors: { 'compTime.bankKey': 'There is no leave bank "nope". Add it under Leave banks first.' } });

        const pattern = TEMPLATES['career-3-platoon'].schedulePattern!.payload as ShiftPattern;
        expect((await checkDraft(tx, 'schedule.pattern', 'default', pattern)).ok).toBe(true);
        const badPattern = await checkDraft(tx, 'schedule.pattern', 'default', { ...pattern, platoons: { a: 0, b: 1, zz: 2 } });
        expect(badPattern).toMatchObject({ ok: false, errors: { 'platoons.zz': '"zz" is not one of this department\'s shifts.', 'platoons.c': 'C Shift needs an offset.' } });

        const policy = TEMPLATES['career-3-platoon'].leave.policies[0]!;
        expect((await checkDraft(tx, 'leave.accrual', policy.bankKey, policy.payload)).ok).toBe(true);
        expect(await checkDraft(tx, 'leave.accrual', 'not_a_bank', policy.payload)).toMatchObject({ ok: false });
      });
    });
  });
});

describe('requireSimulation (the approve guard)', () => {
  async function setup(tx: Tx) {
    const d = await demo(tx);
    await rulesWithDraft(tx, d);
    const who = { tenantId: d.tenantId, userId: d.adminId };
    return { d, who };
  }

  it('lets a simulated draft through and records the simulation in the audit text', async () => {
    await withAdmin(async (tx) => {
      const { d, who } = await setup(tx);
      await asAdmin(tx, d, async () => {
        const draft = (await loadDraft(tx, 'pay.rules', 'default', 3))!;
        const token = simulationTokenFor(who, 'pay.rules', 'default', draft, 'pay period 2026-01-01 for group default');
        const note = await requireSimulation(tx, who, 'pay.rules', 'default', 3, token);
        expect(note).toContain('pay period 2026-01-01 for group default');
        expect(note).toMatch(/\(check [A-Za-z0-9_-]{8}\)/);
      });
    });
  });

  it('refuses a missing token, a token for another user, an older payload and another key', async () => {
    await withAdmin(async (tx) => {
      const { d, who } = await setup(tx);
      await asAdmin(tx, d, async () => {
        const draft = (await loadDraft(tx, 'pay.rules', 'default', 3))!;
        const token = simulationTokenFor(who, 'pay.rules', 'default', draft, 's');
        await expect(requireSimulation(tx, who, 'pay.rules', 'default', 3, '')).rejects.toThrow('Simulate this exact draft first.');
        await expect(requireSimulation(tx, { ...who, userId: d.memberUserId }, 'pay.rules', 'default', 3, token)).rejects.toThrow(/changed since you simulated/);
        await expect(requireSimulation(tx, who, 'pay.rules', 'default', 3, `${token}x`)).rejects.toThrow(/not valid/);
        await expect(requireSimulation(tx, who, 'pay.rules', 'default', 9, token)).rejects.toThrow(/no longer exists/);

        // The draft is edited after simulating: the old token no longer matches.
        await tx`reset role`;
        await tx`update config_versions set payload = ${tx.json({ ...LOW, workPeriod: { ...LOW.workPeriod, threshold: 97 } } as never)} where id = ${draft.id}`;
        await tx`set local role authenticated`;
        await expect(requireSimulation(tx, who, 'pay.rules', 'default', 3, token)).rejects.toThrow(/changed since you simulated/);
      });
    });
  });

  it('refuses an invalid or reference-broken draft even with a valid token', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const who = { tenantId: d.tenantId, userId: d.adminId };
      await rulesWithDraft(tx, d, { ...LOW, assignments: { ...LOW.assignments, regular: { code: 'ghost', multiplier: 1 } } });
      await asAdmin(tx, d, async () => {
        const draft = (await loadDraft(tx, 'pay.rules', 'default', 3))!;
        const token = simulationTokenFor(who, 'pay.rules', 'default', draft, 's');
        await expect(requireSimulation(tx, who, 'pay.rules', 'default', 3, token)).rejects.toThrow(/cannot be approved yet.*There is no pay code "ghost"/);
      });
    });
  });
});

describe('simulation', () => {
  it('pay: the approved column is exactly what the real calculation gives, and the draft column uses only the draft', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await rulesWithDraft(tx, d, LOWEST);
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        // The starter pay period is 14 days, so the simulation looks at 2026-01-01 to 2026-01-14.
        const real = (await calculatePayPeriod(tx, { start: '2026-01-01', endExclusive: '2026-01-15' })).rows.find((r) => r.memberId === d.rileyId)!;
        const { sim, summary } = await simulatePay(tx, { mode: 'period', groupKey: 'default', draft: LOWEST, today: '2026-01-05', date: '2026-01-05', memberId: d.rileyId });
        if (sim.kind !== 'pay') throw new Error('expected a pay simulation');
        expect(summary).toContain('pay period 2026-01-01');
        const row = sim.rows.find((r) => r.id === d.rileyId)!;
        expect(row.approved!.hours).toBe(real.result!.totalHours);
        expect(row.approved!.amount).toBe(real.result!.totalAmount);
        // A lower threshold (48 h vs 150 h) can only move hours into overtime.
        const ot = (c: NonNullable<typeof row.draft>) => c.lines.filter((l) => l.code === 'ot').reduce((s, l) => s + l.hours, 0);
        expect(ot(row.draft!)).toBeGreaterThan(ot(row.approved!));
        expect(row.draft!.hours).toBe(row.approved!.hours);
        expect(row.draft!.amount!).toBeGreaterThan(row.approved!.amount!);
        expect(sim.totals.draftAmount!).toBeGreaterThan(sim.totals.approvedAmount!);
      });
    });
  });

  it('pay: a group with no approved rules still shows the draft column; sample mode needs no shifts', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await tx`delete from config_versions where tenant_id = ${d.tenantId} and kind = 'pay.rules'`;
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        const { sim } = await simulatePay(tx, { mode: 'period', groupKey: 'default', draft: LOW, today: '2026-01-05', date: '2026-01-05', memberId: d.rileyId });
        if (sim.kind !== 'pay') throw new Error('expected a pay simulation');
        const row = sim.rows[0]!;
        expect(row.approved).toMatchObject({ problem: 'No approved pay rules for group "default" on 2026-01-01.' });
        expect(row.draft!.problem).toBeNull();
        expect(row.draft!.hours).toBeGreaterThan(0);

        const s = await simulatePay(tx, { mode: 'sample', groupKey: 'default', draft: LOW, today: '2026-01-05', hourlyRate: 30, shifts: [{ type: 'regular', hours: 24, count: 5 }] });
        if (s.sim.kind !== 'pay') throw new Error('expected a pay simulation');
        expect(s.sim.rows[0]!.draft!.lines.find((l) => l.code === 'ot')!.hours).toBe(24);
        expect(s.sim.rows[0]!.approved!.problem).toMatch(/No approved pay rules/);
      });
    });
  });

  it('pay: needs the same permission as seeing the real result', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await rulesWithDraft(tx, d);
      await asUser(tx, { sub: d.memberUserId, tenant_id: d.tenantId }, async () => {
        await expect(simulatePay(tx, { mode: 'period', groupKey: 'default', draft: LOW, today: '2026-01-05', date: '2026-01-05', memberId: null })).rejects.toThrow(/pay\.view required/);
      });
    });
  });

  it('accrual: projects 12 periods from the member’s real balance, with and without an approved policy', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const policy = TEMPLATES['career-3-platoon'].leave.policies.find((p) => p.bankKey === 'vacation')!.payload;
      await asAdmin(tx, d, async () => {
        const { sim } = await simulateAccrual(tx, { bankKey: 'vacation', draft: policy, today: '2026-01-15', from: null, memberId: d.rileyId, sample: null, hoursWorkedPerPeriod: 0 });
        if (sim.kind !== 'accrual') throw new Error('expected an accrual simulation');
        expect(sim.rows).toHaveLength(12);
        expect(sim.rows[0]!.draft!.balanceAfter).toBeGreaterThanOrEqual(120);
        expect(sim.rows[0]!.approved).toBeNull();
        expect(sim.notes.join(' ')).toMatch(/No policy is approved/);
      });
      await tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
               values (${d.tenantId}, 'leave.accrual', 'vacation', 99, 'approved', tstzrange('2020-01-01'::date::timestamp at time zone 'America/New_York', null), ${tx.json({ ...policy, tiers: [{ fromYears: 0, earn: { method: 'per_period', hours: 4 } }] } as never)})`;
      await asAdmin(tx, d, async () => {
        const { sim } = await simulateAccrual(tx, { bankKey: 'vacation', draft: policy, today: '2026-01-15', from: null, memberId: null, sample: { hireDate: '2020-01-01', employmentType: 'career_full_time', balance: 0 }, hoursWorkedPerPeriod: 0 });
        if (sim.kind !== 'accrual') throw new Error('expected an accrual simulation');
        // Same sample member under both policies: the draft earns more per period than the approved 4 h.
        expect(sim.rows[0]!.approved!.hours).toBe(4);
        expect(sim.rows[0]!.draft!.hours).toBeGreaterThan(4);
      });
    });
  });

  it('pattern: marks the changed days and counts the generated shifts approving would withdraw', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      const approved = TEMPLATES['career-3-platoon'].schedulePattern!.payload as ShiftPattern;
      const draft: ShiftPattern = { ...approved, cycle: ['on', 'off', 'off', 'off'] };
      await generate(tx, d);
      const n = (await tx<{ n: number }[]>`select count(*)::int as n from shift_assignments where source = 'generated' and status = 'scheduled' and lower(during) > now()`)[0]!.n;
      await asAdmin(tx, d, async () => {
        const { sim } = await simulatePattern(tx, { draft, today: '2026-01-05', tz: 'America/New_York', shiftKey: 'a', from: '2026-01-05', weeks: 4 });
        if (sim.kind !== 'pattern') throw new Error('expected a pattern simulation');
        expect(sim.days).toHaveLength(28);
        expect(sim.added.length + sim.removed.length).toBeGreaterThan(0);
        expect(sim.days.filter((x) => x.draft && !x.approved).map((x) => x.date)).toEqual(sim.added);
        expect(sim.replaced).toBeLessThanOrEqual(n);
      });
    });
  });

  it('never writes anything', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await rulesWithDraft(tx, d);
      await generate(tx, d);
      const before = await counts(tx);
      await asAdmin(tx, d, async () => {
        await simulatePay(tx, { mode: 'period', groupKey: 'default', draft: LOW, today: '2026-01-05', date: '2026-01-05', memberId: null });
        await simulatePay(tx, { mode: 'sample', groupKey: 'default', draft: LOW, today: '2026-01-05', hourlyRate: 30, shifts: [{ type: 'regular', hours: 24, count: 3 }] });
        const policy = TEMPLATES['career-3-platoon'].leave.policies[0]!;
        await simulateAccrual(tx, { bankKey: policy.bankKey, draft: policy.payload, today: '2026-01-05', from: null, memberId: d.rileyId, sample: null, hoursWorkedPerPeriod: 0 });
        await simulatePattern(tx, { draft: TEMPLATES['career-3-platoon'].schedulePattern!.payload as ShiftPattern, today: '2026-01-05', tz: 'America/New_York', shiftKey: 'a', from: null, weeks: 2 });
      });
      expect(await counts(tx)).toBe(before);
    });
  });
});
