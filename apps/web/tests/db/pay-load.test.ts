import { afterAll, describe, expect, it } from 'vitest';
import { can as evaluate, toGrants, type MyGrantRow } from '@soma/auth';
import { asUser, closeTestDb, withAdmin, type Tx } from '@soma/db/src/test-harness';
import { TEMPLATES } from '@soma/templates';
import { generateRoster } from '@/server/scheduling/generate';
import { closePayPeriod, reopenPayPeriod } from '@/server/pay/close';
import { loadPayPeriod } from '@/server/pay/load';
import { approveRulesDraft, listRuleVersions, saveRulesDraft } from '@/server/pay/rules';

afterAll(() => closeTestDb());

const PERIOD = { start: '2026-01-01', endExclusive: '2026-01-29' }; // exactly one 28-day work period
const RULES = TEMPLATES['career-3-platoon'].pay.rules[0]!.payload;
/** A low threshold so overtime shows up however Kelly days fall in the demo roster. */
const THRESHOLD = 96;
const LOW = { ...RULES, workPeriod: { ...RULES.workPeriod, threshold: THRESHOLD } };

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

const approveRules = (tx: Tx, d: Demo, payload: object = RULES) =>
  tx`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
     values (${d.tenantId}, 'pay.rules', 'default', 2, 'approved',
             tstzrange('2025-01-01'::date::timestamp at time zone 'America/New_York', null), ${tx.json(payload as never)})`;

const asAdmin = <T>(tx: Tx, d: Demo, fn: () => Promise<T>): Promise<T> => asUser(tx, { sub: d.adminId, tenant_id: d.tenantId }, fn);

/** Generates the demo roster for the period as the seeded admin, then returns to the database owner. */
async function generate(tx: Tx, d: Demo): Promise<void> {
  await asAdmin(tx, d, async () => {
    const grants = toGrants(await tx<MyGrantRow[]>`select * from app.my_grants()`);
    const [me] = await tx<{ id: string }[]>`select app.my_member_id() as id`;
    await generateRoster(tx, (p, t) => evaluate(grants, me!.id, p, t, new Date()).allowed, PERIOD.start, PERIOD.endExclusive);
  });
}

const workedShifts = async (tx: Tx, member: string) =>
  (await tx<{ n: number }[]>`select count(*)::int as n from shift_assignments
    where member_id = ${member} and status = 'scheduled' and type <> 'kelly'`)[0]!.n;

describe('loadPayPeriod', () => {
  it('turns the generated roster into regular and overtime hours with dollars', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await approveRules(tx, d, LOW);
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        const n = await workedShifts(tx, d.rileyId);
        expect(n).toBeGreaterThan(4);
        const result = await loadPayPeriod(tx, PERIOD);
        const riley = result.rows.find((r) => r.memberId === d.rileyId)!;
        expect(riley.problem).toBeNull();
        expect(riley.rate).toBe(31.25);
        const hours = 24 * n;
        const ot = Math.max(0, hours - THRESHOLD);
        const line = (code: string) => riley.result!.lines.find((l) => l.code === code);
        expect(line('reg')!.hours).toBe(hours - ot);
        expect(line('ot')?.hours ?? 0).toBe(ot);
        const amount = Math.round(((hours - ot) * 31.25 + ot * 31.25 * 1.5) * 100) / 100;
        expect(riley.result!.totalAmount).toBe(amount);
      });
    });
  });

  it('pays approved leave under its own code and takes those shifts out of worked hours', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await approveRules(tx, d, LOW);
      await generate(tx, d);
      const before = await workedShifts(tx, d.rileyId);
      const [shift] = await tx<{ id: string }[]>`
        select id from shift_assignments where member_id = ${d.rileyId} and status = 'scheduled' and type <> 'kelly'
        order by lower(during) limit 1`;
      const [type] = await tx<{ id: string }[]>`select id from leave_types where key = 'vacation' and tenant_id = ${d.tenantId}`;
      const [req] = await tx<{ id: string }[]>`
        insert into leave_requests (tenant_id, member_id, leave_type_id, start_date, end_date, hours, status)
        values (${d.tenantId}, ${d.rileyId}, ${type!.id}, '2026-01-01', '2026-01-01', 24, 'approved') returning id`;
      await tx`update shift_assignments set status = 'cancelled', cancelled_reason = 'Leave: Vacation', leave_request_id = ${req!.id}
               where id = ${shift!.id}`;
      await asAdmin(tx, d, async () => {
        const riley = (await loadPayPeriod(tx, PERIOD)).rows.find((r) => r.memberId === d.rileyId)!;
        const vacation = riley.result!.lines.find((l) => l.code === 'vacation')!;
        expect(vacation).toMatchObject({ hours: 24, multiplier: 1, source: 'leave', amount: 750 });
        const worked = riley.result!.lines.filter((l) => l.source === 'work').reduce((s, l) => s + l.hours, 0);
        expect(worked).toBe(24 * (before - 1));
      });
    });
  });

  it('reports a clear problem instead of guessing when no pay rules are approved', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        const result = await loadPayPeriod(tx, PERIOD);
        const riley = result.rows.find((r) => r.memberId === d.rileyId)!;
        expect(riley.result).toBeNull();
        expect(riley.problem).toBe('No approved pay rules for group "default" on 2026-01-01.');
      });
    });
  });

  it('gives null amounts, not zero, to a member with no rate', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await approveRules(tx, d);
      await tx`delete from member_pay_rates where member_id = ${d.rileyId}`;
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        const riley = (await loadPayPeriod(tx, PERIOD)).rows.find((r) => r.memberId === d.rileyId)!;
        expect(riley.rate).toBeNull();
        expect(riley.result!.totalAmount).toBeNull();
        expect(riley.result!.lines.every((l) => l.amount === null)).toBe(true);
      });
    });
  });

  it('honours the prefers_comp_time custom field when comp time is member choice', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await approveRules(tx, d, { ...LOW, compTime: { mode: 'member_choice', multiplier: 1.5, bankKey: 'comp_time' } });
      await tx`update members set custom = '{"prefers_comp_time": true}' where id = ${d.rileyId}`;
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        const n = await workedShifts(tx, d.rileyId);
        const ot = Math.max(0, 24 * n - THRESHOLD);
        expect(ot).toBeGreaterThan(0);
        const riley = (await loadPayPeriod(tx, PERIOD)).rows.find((r) => r.memberId === d.rileyId)!;
        expect(riley.result!.comp).toEqual({ bankKey: 'comp_time', hours: Math.round(ot * 1.5 * 100) / 100 });
        expect(riley.result!.lines.find((l) => l.code === 'ot')).toMatchObject({ compensated: true, amount: 0 });
      });
    });
  });

  it('refuses callers who may not see pay', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await approveRules(tx, d);
      await asUser(tx, { sub: d.memberUserId, tenant_id: d.tenantId }, async () => {
        await expect(loadPayPeriod(tx, PERIOD)).rejects.toThrow(/pay\.view/);
      });
    });
  });
});

describe('pay rule versions', () => {
  it('save draft, approve from a date, and close the previous version', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await asUser(tx, { sub: d.adminId, tenant_id: d.tenantId }, async () => {
        const [seed] = await listRuleVersions(tx, 'default');
        expect(seed).toMatchObject({ version: 1, status: 'draft' }); // starter rules from the template
        const v = await saveRulesDraft(tx, 'default', { ...RULES, workPeriod: { ...RULES.workPeriod, threshold: 204 } });
        expect(v).toBe(1); // updates the open draft
        await approveRulesDraft(tx, 'default', 1, '2026-01-01');
        const next = await saveRulesDraft(tx, 'default', RULES);
        expect(next).toBe(2);
        await approveRulesDraft(tx, 'default', 2, '2026-07-01');
        const versions = await listRuleVersions(tx, 'default');
        expect(versions.map((x) => [x.version, x.status, x.fromDate, x.toDate])).toEqual([
          [2, 'approved', '2026-07-01', null],
          [1, 'approved', '2026-01-01', '2026-07-01'],
        ]);
        await expect(saveRulesDraft(tx, 'default', RULES).then((n) => approveRulesDraft(tx, 'default', n, '2026-07-01'))).rejects.toThrow(/after 2026-07-01/);
      });
    });
  });
});

describe('time entries and closing', () => {
  const rileyRow = async (tx: Tx, d: Demo) => (await loadPayPeriod(tx, PERIOD)).rows.find((r) => r.memberId === d.rileyId)!;

  it('adds recorded time as extra work and ignores voided entries', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await approveRules(tx, d, LOW);
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        const base = (await rileyRow(tx, d)).result!;
        const [entry] = await tx<{ id: string }[]>`select app.add_time_entry(${d.rileyId}, '2026-01-10', 3, 'holdover', 'Held over for a late call') as id`;
        const withHold = await rileyRow(tx, d);
        expect(withHold.result!.totalHours).toBe(base.totalHours + 3);
        const hold = withHold.result!.lines.find((l) => l.code === 'hold')!;
        expect(hold).toMatchObject({ hours: 3, multiplier: 1.5, amount: 140.63 });
        await tx`select app.void_time_entry(${entry!.id}, 'Entered on the wrong day')`;
        expect((await rileyRow(tx, d)).result!.totalHours).toBe(base.totalHours);
      });
    });
  });

  it('counts time worked before the period toward the work-period threshold', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      // 28-day pay period inside a 56-day work period: the first half's hours already used up the threshold.
      const rules = { ...LOW, payPeriod: { kind: 'fixed_days', days: 28, anchor: '2026-01-29' }, workPeriod: { ...LOW.workPeriod, days: 56, anchor: '2026-01-01', threshold: 100 } };
      await approveRules(tx, d, rules);
      await asAdmin(tx, d, async () => {
        const period = { start: '2026-01-29', endExclusive: '2026-02-26' };
        await tx`select app.add_time_entry(${d.rileyId}, '2026-01-05', 48, 'regular', 'Worked before the pay period')`;
        await tx`select app.add_time_entry(${d.rileyId}, '2026-01-06', 48, 'regular', 'Worked before the pay period')`;
        await tx`select app.add_time_entry(${d.rileyId}, '2026-01-07', 48, 'regular', 'Worked before the pay period')`;
        await tx`select app.add_time_entry(${d.rileyId}, '2026-02-02', 10, 'regular', 'Worked inside the pay period')`;
        const riley = (await loadPayPeriod(tx, period)).rows.find((r) => r.memberId === d.rileyId)!;
        // 144 h earlier in the work period already passed 100 h, so these 10 h are all overtime.
        expect(riley.result!.lines.find((l) => l.code === 'ot')!.hours).toBe(10);
      });
    });
  });

  it('a closed period keeps its numbers when rates, rules or the roster change, and reopening makes it live again', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await approveRules(tx, d, LOW);
      await generate(tx, d);
      let closeId = '';
      let frozen = 0;
      await asAdmin(tx, d, async () => {
        frozen = (await rileyRow(tx, d)).result!.totalAmount!;
        closeId = (await closePayPeriod(tx, PERIOD)).id;
        expect((await loadPayPeriod(tx, PERIOD)).closed).toMatchObject({ id: closeId });
      });
      await tx`update member_pay_rates set hourly_rate = 99 where member_id = ${d.rileyId}`;
      await tx`update shift_assignments set status = 'cancelled' where member_id = ${d.rileyId}`;
      await asAdmin(tx, d, async () => {
        const closed = await loadPayPeriod(tx, PERIOD);
        expect(closed.closed).not.toBeNull();
        expect(closed.rows.find((r) => r.memberId === d.rileyId)!.result!.totalAmount).toBe(frozen);
        await reopenPayPeriod(tx, closeId, 'Reopened to check a rate');
        const live = await loadPayPeriod(tx, PERIOD);
        expect(live.closed).toBeNull();
        expect(live.rows.find((r) => r.memberId === d.rileyId)!.result!.totalHours).toBe(0);
      });
    });
  });

  it('refuses to close when a member could not be calculated, and credits comp time when it can', async () => {
    await withAdmin(async (tx) => {
      const d = await demo(tx);
      await generate(tx, d);
      await asAdmin(tx, d, async () => {
        await expect(closePayPeriod(tx, PERIOD)).rejects.toThrow(/Cannot close.*No approved pay rules/);
        expect((await tx`select 1 from pay_period_closes`).length).toBe(0);
      });
      await approveRules(tx, d, { ...LOW, compTime: { mode: 'always', multiplier: 1.5, bankKey: 'comp_time' } });
      const [before] = await tx<{ h: string | null }[]>`select sum(hours) as h from leave_ledger l join leave_banks b on b.id = l.bank_id where l.member_id = ${d.rileyId} and b.key = 'comp_time'`;
      let credit = 0;
      await asAdmin(tx, d, async () => {
        const { credits } = await closePayPeriod(tx, PERIOD);
        credit = credits.find((c) => c.memberId === d.rileyId)!.hours;
        expect(credit).toBeGreaterThan(0);
      });
      const [after] = await tx<{ h: string | null }[]>`select sum(hours) as h from leave_ledger l join leave_banks b on b.id = l.bank_id where l.member_id = ${d.rileyId} and b.key = 'comp_time'`;
      expect(Number(after!.h ?? 0) - Number(before!.h ?? 0)).toBe(credit);
    });
  });
});
