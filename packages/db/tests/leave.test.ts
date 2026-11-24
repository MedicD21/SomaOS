import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { asUser, closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import {
  addLedger, createBank, createLeaveRequest, createLeaveType, createMember, createRole, createTenant,
  expectTenantIsolation, grantRole, userInTenant,
} from './helpers';

afterAll(closeTestDb);

async function person(tx: Tx, t: string, perms: string[] = []) {
  const u = await userInTenant(tx, t);
  const m = await createMember(tx, t, { userId: u });
  if (perms.length) await grantRole(tx, t, m, await createRole(tx, t, `r_${m.slice(0, 6)}`, perms));
  return { u, m };
}

describe('leave banks and types', () => {
  it('are tenant isolated', async () => {
    await withAdmin(async (tx) => {
      await expectTenantIsolation(tx, 'leave_banks', async (t) => void (await createBank(tx, t)), (t) =>
        tx`insert into leave_banks (tenant_id, key, label) values (${t}, 'x', 'x')`);
      await expectTenantIsolation(tx, 'leave_types', async (t) => void (await createLeaveType(tx, t, null)), (t) =>
        tx`insert into leave_types (tenant_id, key, label) values (${t}, 'x', 'x')`);
    });
  });

  it('can only be written by department-wide leave.manage holders', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const plain = await person(tx, t);
      const mgr = await person(tx, t, ['leave.manage']);
      await asUser(tx, { sub: plain.u, tenant_id: t }, async () => {
        await expectDbError(tx, /row-level security/, () => tx`insert into leave_banks (tenant_id, key, label) values (${t}, 'v', 'V')`);
      });
      await asUser(tx, { sub: mgr.u, tenant_id: t }, async () => {
        await tx`insert into leave_banks (tenant_id, key, label) values (${t}, 'v', 'V')`;
      });
    });
  });
});

describe('leave requests and ledger visibility', () => {
  it('members see only their own; leave.view holders see the department; other tenants nothing', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const me = await person(tx, a);
      const other = await person(tx, a);
      const viewer = await person(tx, a, ['leave.view']);
      const bankA = await createBank(tx, a);
      const typeA = await createLeaveType(tx, a, bankA);
      await createLeaveRequest(tx, a, me.m, typeA, '2026-12-10', '2026-12-10');
      await createLeaveRequest(tx, a, other.m, typeA, '2026-12-10', '2026-12-10');
      await addLedger(tx, a, me.m, bankA, 'earn', 8, 'earn:2026-12-01');
      await addLedger(tx, a, other.m, bankA, 'earn', 8, 'earn:2026-12-01');
      const bankB = await createBank(tx, b);
      const strangerB = await createMember(tx, b);
      await addLedger(tx, b, strangerB, bankB, 'earn', 8);
      const count = async (table: string) => (await tx.unsafe(`select count(*)::int as n from ${table}`))[0]!.n as number;

      await asUser(tx, { sub: me.u, tenant_id: a }, async () => {
        expect(await count('leave_requests')).toBe(1);
        expect(await count('leave_ledger')).toBe(1);
      });
      await asUser(tx, { sub: viewer.u, tenant_id: a }, async () => {
        expect(await count('leave_requests')).toBe(2);
        expect(await count('leave_ledger')).toBe(2);
      });
    });
  });

  it('exposes balances as the sum of the ledger', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const me = await person(tx, t);
      const bank = await createBank(tx, t);
      await addLedger(tx, t, me.m, bank, 'earn', 8, 'earn:1');
      await addLedger(tx, t, me.m, bank, 'earn', 8, 'earn:2');
      await addLedger(tx, t, me.m, bank, 'use', -10);
      await asUser(tx, { sub: me.u, tenant_id: t }, async () => {
        const [row] = await tx`select hours::float8 as hours from leave_balances where bank_id = ${bank}`;
        expect(row!.hours).toBe(6);
      });
    });
  });
});

describe('ledger and requests are written only through functions', () => {
  it('direct writes by authenticated users are denied', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const me = await person(tx, t, ['leave.manage', 'leave.approve', 'leave.request']);
      const bank = await createBank(tx, t);
      const type = await createLeaveType(tx, t, bank);
      const req = await createLeaveRequest(tx, t, me.m, type, '2026-12-10', '2026-12-10');
      await addLedger(tx, t, me.m, bank, 'earn', 8);
      await asUser(tx, { sub: me.u, tenant_id: t }, async () => {
        await expectDbError(tx, /permission denied/, () =>
          tx`insert into leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date) values (${t}, ${me.m}, ${bank}, 'earn', 99, current_date)`);
        await expectDbError(tx, /permission denied/, () => tx`update leave_ledger set hours = 999`);
        await expectDbError(tx, /permission denied/, () => tx`delete from leave_ledger`);
        await expectDbError(tx, /permission denied/, () => tx`update leave_requests set status = 'approved' where id = ${req}`);
        await expectDbError(tx, /permission denied/, () => tx`delete from leave_requests where id = ${req}`);
        await expectDbError(tx, /permission denied/, () =>
          tx`insert into leave_requests (tenant_id, member_id, leave_type_id, start_date, end_date, hours) values (${t}, ${me.m}, ${type}, '2027-01-01', '2027-01-01', 24)`);
      });
    });
  });

  it('service_role can append but never rewrite the ledger', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const bank = await createBank(tx, t);
      await tx`set local role service_role`;
      await addLedger(tx, t, m, bank, 'earn', 8);
      await expectDbError(tx, /permission denied/, () => tx`update leave_ledger set hours = 1`);
      await expectDbError(tx, /permission denied/, () => tx`delete from leave_ledger`);
      await expectDbError(tx, /permission denied/, () => tx`truncate leave_ledger`);
      await tx`reset role`;
    });
  });

  it('rejects a duplicate run_key for the same member and bank', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const bank = await createBank(tx, t);
      await addLedger(tx, t, m, bank, 'earn', 8, 'earn:2026-12-01');
      await expectDbError(tx, /duplicate key/, () => addLedger(tx, t, m, bank, 'earn', 8, 'earn:2026-12-01'));
      await addLedger(tx, t, m, bank, 'earn', 8, 'earn:2027-01-01');
    });
  });

  it('refuses a zero-hour ledger entry', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const bank = await createBank(tx, t);
      await expectDbError(tx, /leave_ledger_hours_check/, () => addLedger(tx, t, m, bank, 'adjust', 0));
    });
  });
});

describe('leave request integrity', () => {
  it('rejects overlapping pending/approved requests but not cancelled or denied ones', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const type = await createLeaveType(tx, t, null, 'fmla');
      await createLeaveRequest(tx, t, m, type, '2026-12-10', '2026-12-12', 'approved');
      await expectDbError(tx, /leave_requests_member_no_overlap/, () => createLeaveRequest(tx, t, m, type, '2026-12-12', '2026-12-14', 'pending'));
      await createLeaveRequest(tx, t, m, type, '2026-12-13', '2026-12-14', 'pending');
      await createLeaveRequest(tx, t, m, type, '2026-12-10', '2026-12-12', 'cancelled');
      await createLeaveRequest(tx, t, m, type, '2026-12-10', '2026-12-12', 'denied');
    });
  });

  it('rejects an end date before the start date and non-positive hours', async () => {
    await withAdmin(async (tx) => {
      const t = await createTenant(tx);
      const m = await createMember(tx, t);
      const type = await createLeaveType(tx, t, null, 'x');
      await expectDbError(tx, /leave_requests_check|dates/, () => createLeaveRequest(tx, t, m, type, '2026-12-12', '2026-12-10'));
      await expectDbError(tx, /hours_check/, () => createLeaveRequest(tx, t, m, type, '2026-12-10', '2026-12-10', 'pending', 0));
    });
  });

  it('cannot attach a leave type from another tenant', async () => {
    await withAdmin(async (tx) => {
      const a = await createTenant(tx, 'A');
      const b = await createTenant(tx, 'B');
      const m = await createMember(tx, a);
      const typeB = await createLeaveType(tx, b, null, 'x');
      await expectDbError(tx, /violates foreign key/, () => createLeaveRequest(tx, a, m, typeB, '2026-12-10', '2026-12-10'));
    });
  });
});
