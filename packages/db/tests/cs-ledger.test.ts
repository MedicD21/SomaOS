import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from '../src/client';
import type { Tx } from '../src/test-harness';
import { closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { as, csWorld, person, type CsWorld } from './cs-helpers';
import { createOrgUnit, createTenant } from './helpers';

afterAll(closeTestDb);

type Who = { u: string; m: string };

/** Receives stock as the owner so scenarios start from known balances (the chain trigger still runs). */
async function stock(tx: Tx, w: CsWorld, location: string, lot: string, qty: number) {
  await tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by, reason) values (${w.t}, ${location}, ${lot}, ${qty}, 'receive', ${w.manager.m}, 'seed')`;
}
const onHand = async (tx: Tx, location: string, lot: string) =>
  Number((await tx<{ s: string | null }[]>`select sum(delta) as s from cs_ledger where location_id = ${location} and lot_id = ${lot}`)[0]!.s ?? 0);

/** Requester asks, the witness confirms from their own session; returns the request id. */
async function witnessed(tx: Tx, w: CsWorld, requester: Who, witness: Who, action: string, payload: object, location: string): Promise<string> {
  let id = '';
  await as(tx, w, requester, async () => {
    id = (await tx<{ id: string }[]>`select app.request_cs_witness(${action}, ${tx.json(payload as never)}, ${location}, ${witness.m}) as id`)[0]!.id;
  });
  await as(tx, w, witness, async () => { await tx`select app.confirm_cs_witness(${id})`; });
  return id;
}

describe('receive and administer', () => {
  it('need custody.record at the unit; rows are attributed to the caller and signed', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      for (const who of [w.manager, w.auditor, w.witness, w.recorderElsewhere, w.nobody]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /cannot record custody/, () => tx`select app.cs_receive(${w.vault}, ${w.lotA}, 10, 'PO 77')`);
        });
      }
      await as(tx, w, w.recorder, async () => {
        await tx`select app.cs_receive(${w.vault}, ${w.lotA}, 10, 'PO 77')`;
        await expectDbError(tx, /above zero/, () => tx`select app.cs_receive(${w.vault}, ${w.lotA}, 0, null)`);
        await expectDbError(tx, /3 decimal/, () => tx`select app.cs_receive(${w.vault}, ${w.lotA}, 1.2345, null)`);
        await tx`select app.cs_administer(${w.vault}, ${w.lotA}, 2.5, 'Run 2026-114')`;
        await expectDbError(tx, /incident or run number/, () => tx`select app.cs_administer(${w.vault}, ${w.lotA}, 1, 'no')`);
        await expectDbError(tx, /Not enough on hand/, () => tx`select app.cs_administer(${w.vault}, ${w.lotA}, 8, 'Run 2026-115')`);
      });
      const rows = await tx<{ type: string; delta: string; performed_by: string; reference: string | null }[]>`select type, delta, performed_by, reference from cs_ledger where location_id = ${w.vault} order by seq`;
      expect(rows.map((r) => [r.type, Number(r.delta)])).toEqual([['receive', 10], ['administer', -2.5]]);
      expect(rows.every((r) => r.performed_by === w.recorder.m)).toBe(true);
      expect(await onHand(tx, w.vault, w.lotA)).toBe(7.5);
    });
  });

  it('refuses an expired or recalled lot except for waste, return and adjust', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      const [old] = await tx<{ id: string }[]>`insert into cs_lots (tenant_id, item_id, lot_no, expires_on) values (${w.t}, ${w.item}, 'OLD', current_date - 1) returning id`;
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /expired/, () => tx`select app.cs_receive(${w.vault}, ${old!.id}, 1, null)`);
      });
      await stock(tx, w, w.vault, w.lotA, 6);
      await as(tx, w, w.manager, async () => { await tx`select app.flag_cs_lot_recall(${w.lotA}, 'Manufacturer recall')`; });
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /recalled/, () => tx`select app.cs_administer(${w.vault}, ${w.lotA}, 1, 'Run 2026-116')`);
        await expectDbError(tx, /recalled/, () => tx`select app.cs_receive(${w.vault}, ${w.lotA}, 1, null)`);
      });
    });
  });
});

describe('transfers and returns', () => {
  it('between vault and station: no witness, two rows share a transfer id and net to zero', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      const [station] = await tx<{ id: string }[]>`insert into cs_locations (tenant_id, name, kind, org_unit_id) values (${w.t}, 'Station safe', 'station', ${w.s1}) returning id`;
      await stock(tx, w, w.vault, w.lotA, 10);
      await as(tx, w, w.recorder, async () => {
        await tx`select app.cs_transfer(${w.vault}, ${station!.id}, ${w.lotA}, 4, 'Restock', null)`;
        await expectDbError(tx, /Choose two different/, () => tx`select app.cs_transfer(${w.vault}, ${w.vault}, ${w.lotA}, 1, null, null)`);
      });
      const rows = await tx<{ type: string; transfer_id: string; delta: string }[]>`select type, transfer_id, delta from cs_ledger where tenant_id = ${w.t} and transfer_id is not null`;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.transfer_id).toBe(rows[1]!.transfer_id);
      expect(Number(rows[0]!.delta) + Number(rows[1]!.delta)).toBe(0);
      expect(await onHand(tx, station!.id, w.lotA)).toBe(4);
    });
  });

  it('into a drug box needs a confirmed witness for exactly those details, used once', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.vault, w.lotA, 10);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /witness is required/i, () => tx`select app.cs_transfer(${w.vault}, ${w.box1}, ${w.lotA}, 3, null, null)`);
      });
      const payload = { from: w.vault, to: w.box1, lot: w.lotA, qty: 3 };
      const req = await witnessed(tx, w, w.recorder, w.witness, 'transfer', payload, w.vault);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /different details/, () => tx`select app.cs_transfer(${w.vault}, ${w.box1}, ${w.lotA}, 4, null, ${req})`);
        await tx`select app.cs_transfer(${w.vault}, ${w.box1}, ${w.lotA}, 3.0, 'Fill box', ${req})`;   // 3 and 3.0 are the same quantity
        await expectDbError(tx, /already been used/, () => tx`select app.cs_transfer(${w.vault}, ${w.box1}, ${w.lotA}, 3, null, ${req})`);
      });
      const rows = await tx<{ witnessed_by: string | null }[]>`select witnessed_by from cs_ledger where tenant_id = ${w.t} and transfer_id is not null`;
      expect(rows.map((r) => r.witnessed_by)).toEqual([w.witness.m, w.witness.m]);
      expect(await onHand(tx, w.box1, w.lotA)).toBe(3);
    });
  });

  it('a return takes the same path with its own action and types', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      const req = await witnessed(tx, w, w.recorder, w.witness, 'return', { from: w.box1, to: w.vault, lot: w.lotA, qty: 2 }, w.box1);
      await as(tx, w, w.recorder, async () => {
        await tx`select app.cs_return(${w.box1}, ${w.vault}, ${w.lotA}, 2, 'Unused', ${req})`;
      });
      expect((await tx<{ type: string }[]>`select type from cs_ledger where tenant_id = ${w.t} and transfer_id is not null order by id`).map((r) => r.type)).toEqual(['return_out', 'return_in']);
    });
  });

  it('record is needed at the source unit; the destination needs record or manage at its unit', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      const [station2] = await tx<{ id: string }[]>`insert into cs_locations (tenant_id, name, kind, org_unit_id) values (${w.t}, 'S2 safe', 'station', ${w.s2}) returning id`;
      await stock(tx, w, w.vault, w.lotA, 10);
      await as(tx, w, w.recorderElsewhere, async () => {
        await expectDbError(tx, /cannot move custody stock from here/, () => tx`select app.cs_transfer(${w.vault}, ${station2!.id}, ${w.lotA}, 1, null, null)`);
      });
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /cannot move custody stock to that location/, () => tx`select app.cs_transfer(${w.vault}, ${station2!.id}, ${w.lotA}, 1, null, null)`);
      });
    });
  });
});

describe('witness requests', () => {
  it('the requester cannot confirm; a witness must be another member holding custody.witness at the unit', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      const payload = { location: w.box1, lot: w.lotA, qty: 1, reason: 'Dropped vial' };
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /different member/, () => tx`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.recorder.m})`);
        await expectDbError(tx, /cannot witness/, () => tx`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.recorder2.m})`);       // record only
        await expectDbError(tx, /cannot witness/, () => tx`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.witnessElsewhere.m})`); // other unit
        await expectDbError(tx, /cannot witness/, () => tx`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.nobody.m})`);
      });
      await as(tx, w, w.witness, async () => {
        await expectDbError(tx, /cannot request this here/, () => tx`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.both.m})`);
      });
      let id = '';
      await as(tx, w, w.recorder, async () => {
        id = (await tx<{ id: string }[]>`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.witness.m}) as id`)[0]!.id;
        await expectDbError(tx, /only the named witness/, () => tx`select app.confirm_cs_witness(${id})`);
      });
      for (const who of [w.recorder2, w.both, w.witnessElsewhere]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /only the named witness/, () => tx`select app.confirm_cs_witness(${id})`);
        });
      }
      await as(tx, w, w.witness, async () => {
        await tx`select app.confirm_cs_witness(${id})`;
        await expectDbError(tx, /already confirmed/, () => tx`select app.confirm_cs_witness(${id})`);
      });
    });
  });

  it('an expired request cannot be confirmed or used; a declined one leaves no ledger row', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      const payload = { location: w.box1, lot: w.lotA, qty: 1, reason: 'Dropped vial' };
      let a = '';
      let b = '';
      await as(tx, w, w.recorder, async () => {
        a = (await tx<{ id: string }[]>`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.witness.m}) as id`)[0]!.id;
        b = (await tx<{ id: string }[]>`select app.request_cs_witness('waste', ${tx.json(payload)}, ${w.box1}, ${w.witness.m}) as id`)[0]!.id;
      });
      await as(tx, w, w.witness, async () => { await tx`select app.decline_cs_witness(${b}, 'Not present')`; });
      await tx`update cs_witness_requests set expires_at = now() - interval '1 minute' where id = ${a}`;
      await as(tx, w, w.witness, async () => {
        await expectDbError(tx, /expired/, () => tx`select app.confirm_cs_witness(${a})`);
      });
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /not confirmed/, () => tx`select app.cs_waste(${w.box1}, ${w.lotA}, 1, 'Dropped vial', ${b})`);
      });
      expect(await onHand(tx, w.box1, w.lotA)).toBe(5);
    });
  });

  it('a confirmed request that then expires cannot be used', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      const req = await witnessed(tx, w, w.recorder, w.witness, 'waste', { location: w.box1, lot: w.lotA, qty: 1, reason: 'Dropped vial' }, w.box1);
      await tx`update cs_witness_requests set expires_at = now() - interval '1 minute' where id = ${req}`;
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /expired/, () => tx`select app.cs_waste(${w.box1}, ${w.lotA}, 1, 'Dropped vial', ${req})`);
      });
    });
  });

  it('only the requester can use it', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      const req = await witnessed(tx, w, w.recorder, w.witness, 'waste', { location: w.box1, lot: w.lotA, qty: 1, reason: 'Dropped vial' }, w.box1);
      await as(tx, w, w.both, async () => {
        await expectDbError(tx, /Unknown witness request/, () => tx`select app.cs_waste(${w.box1}, ${w.lotA}, 1, 'Dropped vial', ${req})`);
      });
    });
  });
});

describe('waste and adjust', () => {
  it('waste needs a reason and a witness; one row names both members', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /witness is required/i, () => tx`select app.cs_waste(${w.box1}, ${w.lotA}, 1, 'Dropped vial', null)`);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.cs_waste(${w.box1}, ${w.lotA}, 1, 'no', null)`);
      });
      const req = await witnessed(tx, w, w.recorder, w.witness, 'waste', { location: w.box1, lot: w.lotA, qty: 1.5, reason: 'Dropped vial' }, w.box1);
      await as(tx, w, w.recorder, async () => {
        await tx`select app.cs_waste(${w.box1}, ${w.lotA}, 1.5, 'Dropped vial', ${req})`;
      });
      const [row] = await tx<{ type: string; performed_by: string; witnessed_by: string; delta: string }[]>`select type, performed_by, witnessed_by, delta from cs_ledger where tenant_id = ${w.t} and type = 'waste'`;
      expect(row).toMatchObject({ type: 'waste', performed_by: w.recorder.m, witnessed_by: w.witness.m });
      expect(Number(row!.delta)).toBe(-1.5);
      expect((await tx<{ result_ledger_id: string }[]>`select result_ledger_id from cs_witness_requests where id = ${req}`)[0]!.result_ledger_id).not.toBeNull();
      await expectDbError(tx, /check constraint|violates/, () => tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by) values (${w.t}, ${w.box1}, ${w.lotA}, -1, 'waste', ${w.recorder.m})`);
      await expectDbError(tx, /check constraint|violates/, () => tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by, witnessed_by) values (${w.t}, ${w.box1}, ${w.lotA}, -1, 'waste', ${w.recorder.m}, ${w.recorder.m})`);
    });
  });

  it('adjust needs custody.manage at the unit and a witness; record cannot adjust', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      const payload = { location: w.box1, lot: w.lotA, delta: -1, reason: 'Count correction' };
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /cannot request this here/, () => tx`select app.request_cs_witness('adjust', ${tx.json(payload)}, ${w.box1}, ${w.witness.m})`);
        await expectDbError(tx, /custody\.manage required/, () => tx`select app.cs_adjust(${w.box1}, ${w.lotA}, -1, 'Count correction', null)`);
      });
      const req = await witnessed(tx, w, w.manager1, w.witness, 'adjust', payload, w.box1);
      await as(tx, w, w.manager1, async () => {
        await tx`select app.cs_adjust(${w.box1}, ${w.lotA}, -1, 'Count correction', ${req})`;
      });
      expect(await onHand(tx, w.box1, w.lotA)).toBe(4);
    });
  });
});

describe('seal break', () => {
  it('needs a reason, a new unused seal number and a confirmed witness; applies the new seal', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await as(tx, w, w.recorder, async () => { await tx`select app.apply_cs_seal(${w.box1}, 'S-1')`; });
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /witness is required/i, () => tx`select app.break_cs_seal(${w.box1}, 'Restock after call', 'S-2', null)`);
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.break_cs_seal(${w.box1}, 'no', 'S-2', null)`);
        await expectDbError(tx, /already been used/, () => tx`select app.break_cs_seal(${w.box1}, 'Restock after call', 'S-1', null)`);
      });
      const req = await witnessed(tx, w, w.recorder, w.witness, 'seal_break', { location: w.box1, new_seal_no: 'S-2', reason: 'Restock after call' }, w.box1);
      await as(tx, w, w.recorder, async () => { await tx`select app.break_cs_seal(${w.box1}, 'Restock after call', 'S-2', ${req})`; });
      expect((await tx<{ current_seal_no: string }[]>`select current_seal_no from cs_locations where id = ${w.box1}`)[0]!.current_seal_no).toBe('S-2');
      const kinds = await tx<{ kind: string; seal_no: string; witnessed_by: string | null }[]>`select kind, seal_no, witnessed_by from cs_seal_events where location_id = ${w.box1} order by occurred_at, id`;
      expect(kinds.map((k) => [k.kind, k.seal_no])).toEqual([['apply', 'S-1'], ['break', 'S-1'], ['apply', 'S-2']]);
      expect(kinds[1]!.witnessed_by).toBe(w.witness.m);
    });
  });
});

describe('append-only ledger and hash chain', () => {
  it('update, delete and truncate are rejected, even for the owner', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.vault, w.lotA, 5);
      await expectDbError(tx, /append-only/, () => tx`update cs_ledger set delta = 9`);
      await expectDbError(tx, /append-only/, () => tx`delete from cs_ledger`);
      await expectDbError(tx, /append-only|cannot truncate/, () => tx`truncate cs_ledger`);
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update cs_ledger set delta = 9`);
        await expectDbError(tx, /permission denied/, () => tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by) values (${w.t}, ${w.vault}, ${w.lotA}, 1, 'receive', ${w.manager.m})`);
      });
    });
  });

  it('a clean chain verifies; an out-of-band edit is reported at its sequence number; locations chain independently', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      for (let i = 0; i < 3; i++) await stock(tx, w, w.vault, w.lotA, 1 + i);
      await stock(tx, w, w.box2, w.lotA, 4);
      const seqs = await tx<{ location_id: string; seq: string }[]>`select location_id, seq from cs_ledger where tenant_id = ${w.t} order by id`;
      expect(seqs.map((r) => Number(r.seq))).toEqual([1, 2, 3, 1]);
      await as(tx, w, w.auditor, async () => {
        expect((await tx<{ ok: boolean; broken_seq: string | null }[]>`select * from app.verify_cs_chain(${w.vault})`)[0]).toMatchObject({ ok: true, broken_seq: null });
        expect((await tx<{ ok: boolean }[]>`select * from app.verify_cs_chain(${w.box2})`)[0]!.ok).toBe(true);
      });
      // Simulate tampering by someone with owner rights: switch off the guard, edit, switch it back.
      await tx`alter table cs_ledger disable trigger forbid_mutation`;
      await tx`update cs_ledger set delta = 99 where location_id = ${w.vault} and seq = 2`;
      await tx`alter table cs_ledger enable trigger forbid_mutation`;
      await as(tx, w, w.auditor, async () => {
        const [r] = await tx<{ ok: boolean; broken_seq: string }[]>`select * from app.verify_cs_chain(${w.vault})`;
        expect(r!.ok).toBe(false);
        expect(Number(r!.broken_seq)).toBe(2);
        expect((await tx<{ ok: boolean }[]>`select * from app.verify_cs_chain(${w.box2})`)[0]!.ok).toBe(true);
      });
    });
  });

  it('verify needs audit or manage; record alone cannot', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /custody\.audit or custody\.manage required/, () => tx`select * from app.verify_cs_chain(${w.vault})`);
      });
      await as(tx, w, w.manager1, async () => { await tx`select * from app.verify_cs_chain(${w.vault})`; });
    });
  });

  it('cs_balances is the sum of the ledger and respects scope', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.vault, w.lotA, 6);
      await stock(tx, w, w.vault, w.lotA, 2);
      await stock(tx, w, w.box2, w.lotB, 3);
      await as(tx, w, w.recorder, async () => {
        const rows = await tx<{ location_id: string; on_hand: string }[]>`select location_id, on_hand from cs_balances`;
        expect(rows.map((r) => [r.location_id, Number(r.on_hand)])).toEqual([[w.vault, 8]]);
      });
      await as(tx, w, w.auditor, async () => { expect((await tx`select 1 from cs_balances`).length).toBe(2); });
      await as(tx, w, w.nobody, async () => { expect((await tx`select 1 from cs_balances`).length).toBe(0); });
    });
  });
});

describe('separation of permissions and isolation', () => {
  it('audit cannot write; manage cannot record where it has no record grant; record cannot witness', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.vault, w.lotA, 5);
      await as(tx, w, w.auditor, async () => {
        await expectDbError(tx, /cannot record custody/, () => tx`select app.cs_administer(${w.vault}, ${w.lotA}, 1, 'Run 2026-120')`);
        expect((await tx`select 1 from cs_ledger`).length).toBe(1);
      });
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /cannot record custody/, () => tx`select app.cs_administer(${w.vault}, ${w.lotA}, 1, 'Run 2026-120')`);
      });
    });
  });

  it('is tenant isolated and cannot move stock across departments', async () => {
    await withAdmin(async (tx) => {
      const a = await csWorld(tx);
      const b = await csWorld(tx);
      await stock(tx, a, a.vault, a.lotA, 5);
      await stock(tx, b, b.vault, b.lotA, 5);
      await as(tx, a, a.auditor, async () => {
        expect((await tx<{ tenant_id: string }[]>`select distinct tenant_id from cs_ledger`).map((r) => r.tenant_id)).toEqual([a.t]);
      });
      await as(tx, a, a.recorder, async () => {
        await expectDbError(tx, /Unknown location/, () => tx`select app.cs_receive(${b.vault}, ${b.lotA}, 1, null)`);
        await expectDbError(tx, /Unknown location|Unknown lot/, () => tx`select app.cs_receive(${a.vault}, ${b.lotA}, 1, null)`);
      });
    });
  });
});

describe('concurrency', () => {
  it('two concurrent transfers of the last units: exactly one succeeds, and the chain has no gaps', async () => {
    const a = createSql();
    const b = createSql();
    const admin = createSql();
    try {
      const ids = await admin.begin(async (tx) => {
        const t = await createTenant(tx, `CS race ${crypto.randomUUID().slice(0, 6)}`);
        const unit = await createOrgUnit(tx, t, 'Race station');
        const loc = async (name: string) =>
          (await tx<{ id: string }[]>`insert into cs_locations (tenant_id, name, kind, org_unit_id) values (${t}, ${name}, 'station', ${unit}) returning id`)[0]!.id;
        const from = await loc('From');
        const to1 = await loc('To 1');
        const to2 = await loc('To 2');
        const [item] = await tx<{ id: string }[]>`insert into cs_items (tenant_id, name, schedule, unit) values (${t}, 'Race drug', 'II', 'mL') returning id`;
        const [lot] = await tx<{ id: string }[]>`insert into cs_lots (tenant_id, item_id, lot_no, expires_on) values (${t}, ${item!.id}, 'R1', '2099-01-01') returning id`;
        const p = await person(tx, t, ['custody.record'], { scopeKind: 'department' });
        await tx`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by) values (${t}, ${from}, ${lot!.id}, 10, 'receive', ${p.m})`;
        return { t, from, to1, to2, lot: lot!.id, u: p.u };
      });
      const attempt = (conn: ReturnType<typeof createSql>, to: string) =>
        conn.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', sub: ids.u, tenant_id: ids.t })}, true)`;
          await tx`set local role authenticated`;
          await tx`select app.cs_transfer(${ids.from}, ${to}, ${ids.lot}, 8, 'race', null)`;
        });
      const results = await Promise.allSettled([attempt(a, ids.to1), attempt(b, ids.to2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/Not enough on hand/);
      const seqs = await admin<{ location_id: string; seq: string }[]>`select location_id, seq from cs_ledger where tenant_id = ${ids.t} order by location_id, seq`;
      for (const loc of [ids.from, ids.to1, ids.to2]) {
        const s = seqs.filter((r) => r.location_id === loc).map((r) => Number(r.seq));
        expect(s).toEqual(s.map((_, i) => i + 1));
      }
      const [total] = await admin<{ s: string }[]>`select sum(delta) as s from cs_ledger where tenant_id = ${ids.t}`;
      expect(Number(total!.s)).toBe(10);
    } finally {
      await Promise.all([a.end(), b.end(), admin.end()]);
    }
  });
});
