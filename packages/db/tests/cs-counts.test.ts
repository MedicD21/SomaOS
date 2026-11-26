import { afterAll, describe, expect, it } from 'vitest';
import type { Tx } from '../src/test-harness';
import { closeTestDb, expectDbError, withAdmin } from '../src/test-harness';
import { as, csWorld, onHand, person, stock, witnessed, type CsWorld } from './cs-helpers';

afterAll(closeTestDb);

/** A witnessed count of the drug box; `lines` is [{lot_id, counted}]. */
async function count(tx: Tx, w: CsWorld, lines: { lot_id: string; counted: number }[], seal?: string, counter = w.recorder) {
  const payload: Record<string, unknown> = { location: w.box1, lines };
  if (seal) payload.seal = seal;
  const req = await witnessed(tx, w, counter, w.witness, 'count', payload, w.box1);
  let id = '';
  await as(tx, w, counter, async () => {
    id = (await tx<{ id: string }[]>`select app.submit_cs_count(${w.box1}, ${tx.json(lines as never)}, ${seal ?? null}, null, ${req}) as id`)[0]!.id;
  });
  return id;
}
const discrepancies = (tx: Tx, location: string) =>
  tx<{ id: string; kind: string; expected: string | null; counted: string | null; status: string; lot_id: string | null }[]>`select id, kind, expected, counted, status, lot_id from cs_discrepancies where location_id = ${location} order by opened_at`;

describe('the count sheet is blind', () => {
  it('lists lots held here with names only, never quantities; needs record at the unit', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      await as(tx, w, w.recorder, async () => {
        const rows = await tx<Record<string, unknown>[]>`select * from app.cs_count_sheet(${w.box1})`;
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0]!).sort()).toEqual(['expires_on', 'item_name', 'lot_id', 'lot_no', 'unit']);
      });
      for (const who of [w.recorderElsewhere, w.auditor, w.witness]) {
        await as(tx, w, who, async () => {
          await expectDbError(tx, /cannot count here/, () => tx`select * from app.cs_count_sheet(${w.box1})`);
        });
      }
    });
  });
});

describe('submitting a count', () => {
  it('a matching count stores the lines with expected read in SQL and opens nothing', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      await stock(tx, w, w.box1, w.lotB, 2);
      const id = await count(tx, w, [{ lot_id: w.lotA, counted: 5 }, { lot_id: w.lotB, counted: 2 }]);
      const lines = await tx<{ expected: string; counted: string }[]>`select expected, counted from cs_count_lines where count_id = ${id} order by expected desc`;
      expect(lines.map((l) => [Number(l.expected), Number(l.counted)])).toEqual([[5, 5], [2, 2]]);
      expect(await discrepancies(tx, w.box1)).toHaveLength(0);
      const [c] = await tx<{ counted_by: string; witnessed_by: string }[]>`select counted_by, witnessed_by from cs_counts where id = ${id}`;
      expect(c).toEqual({ counted_by: w.recorder.m, witnessed_by: w.witness.m });
    });
  });

  it('a short count opens exactly one discrepancy holding both numbers; a supplied "expected" is ignored', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      await stock(tx, w, w.box1, w.lotB, 2);
      await count(tx, w, [{ lot_id: w.lotA, counted: 4, expected: 4 } as never, { lot_id: w.lotB, counted: 2 }]);
      const d = await discrepancies(tx, w.box1);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ kind: 'quantity', status: 'open', lot_id: w.lotA });
      expect([Number(d[0]!.expected), Number(d[0]!.counted)]).toEqual([5, 4]);
    });
  });

  it('refuses a count that misses a held lot, repeats a lot, or needs a witness it does not have', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      await stock(tx, w, w.box1, w.lotB, 2);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /witness is required/i, () => tx`select app.submit_cs_count(${w.box1}, ${tx.json([{ lot_id: w.lotA, counted: 5 }] as never)}, null, null, null)`);
      });
      const missing = [{ lot_id: w.lotA, counted: 5 }];
      const req = await witnessed(tx, w, w.recorder, w.witness, 'count', { location: w.box1, lines: missing }, w.box1);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /Count every lot held here/, () => tx`select app.submit_cs_count(${w.box1}, ${tx.json(missing as never)}, null, null, ${req})`);
      });
      const dupes = [{ lot_id: w.lotA, counted: 5 }, { lot_id: w.lotA, counted: 5 }];
      const req2 = await witnessed(tx, w, w.recorder, w.witness, 'count', { location: w.box1, lines: dupes }, w.box1);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /only once/, () => tx`select app.submit_cs_count(${w.box1}, ${tx.json(dupes as never)}, null, null, ${req2})`);
      });
      expect((await tx`select 1 from cs_counts where tenant_id = ${w.t}`).length).toBe(0);
    });
  });

  it('the witness must have confirmed these exact lines', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      const req = await witnessed(tx, w, w.recorder, w.witness, 'count', { location: w.box1, lines: [{ lot_id: w.lotA, counted: 5 }] }, w.box1);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /different details/, () => tx`select app.submit_cs_count(${w.box1}, ${tx.json([{ lot_id: w.lotA, counted: 4 }] as never)}, null, null, ${req})`);
        await expectDbError(tx, /not completed by you/, () => tx`select app.submit_cs_count(${w.box1}, ${tx.json([{ lot_id: w.lotA, counted: 5 }] as never)}, null, ${crypto.randomUUID()}, ${req})`);
      });
    });
  });

  it('a seal mismatch opens a seal discrepancy; a missing seal number is refused; a matching seal is clean', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      await as(tx, w, w.recorder, async () => { await tx`select app.apply_cs_seal(${w.box1}, 'S-77')`; });
      const lines = [{ lot_id: w.lotA, counted: 5 }];
      const req = await witnessed(tx, w, w.recorder, w.witness, 'count', { location: w.box1, lines }, w.box1);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /seal number you see/, () => tx`select app.submit_cs_count(${w.box1}, ${tx.json(lines as never)}, null, null, ${req})`);
      });
      await count(tx, w, lines, 'S-77');
      expect(await discrepancies(tx, w.box1)).toHaveLength(0);
      await count(tx, w, lines, 'S-99');
      const d = await discrepancies(tx, w.box1);
      expect(d.map((x) => x.kind)).toEqual(['seal']);
    });
  });

  it('a broken chain opens a chain discrepancy', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 5);
      await tx`alter table cs_ledger disable trigger forbid_mutation`;
      await tx`update cs_ledger set reason = 'edited' where location_id = ${w.box1}`;
      await tx`alter table cs_ledger enable trigger forbid_mutation`;
      await count(tx, w, [{ lot_id: w.lotA, counted: 5 }]);
      expect((await discrepancies(tx, w.box1)).map((x) => x.kind)).toEqual(['chain']);
    });
  });

  it('counts and lines are append-only; record needed at the unit', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      await stock(tx, w, w.box1, w.lotA, 1);
      await count(tx, w, [{ lot_id: w.lotA, counted: 1 }]);
      await expectDbError(tx, /append-only/, () => tx`update cs_counts set note = 'x'`);
      await expectDbError(tx, /append-only/, () => tx`delete from cs_count_lines`);
      await as(tx, w, w.recorderElsewhere, async () => {
        await expectDbError(tx, /cannot count here/, () => tx`select app.submit_cs_count(${w.box1}, '[]'::jsonb, null, null, null)`);
      });
    });
  });
});

describe('discrepancy workflow', () => {
  async function opened(tx: Tx) {
    const w = await csWorld(tx);
    await stock(tx, w, w.box1, w.lotA, 5);
    const counter = await person(tx, w.t, ['custody.record', 'custody.manage'], { scopeKind: 'org_unit', orgUnitId: w.s1 });
    await count(tx, w, [{ lot_id: w.lotA, counted: 4 }], undefined, counter);
    const [d] = await discrepancies(tx, w.box1);
    return { ...w, counter, d: d! };
  }

  it('manage investigates and escalates with a free-text report reference; nothing is filed anywhere', async () => {
    await withAdmin(async (tx) => {
      const w = await opened(tx);
      await as(tx, w, w.recorder, async () => {
        await expectDbError(tx, /custody\.manage required/, () => tx`select app.investigate_cs_discrepancy(${w.d.id}, 'Looking into it')`);
      });
      await as(tx, w, w.manager1, async () => {
        await expectDbError(tx, /at least 5 characters/, () => tx`select app.investigate_cs_discrepancy(${w.d.id}, 'no')`);
        await tx`select app.investigate_cs_discrepancy(${w.d.id}, 'Checking the run reports')`;
        await tx`select app.escalate_cs_discrepancy(${w.d.id}, 'Cannot account for the vial', 'Incident 2026-0417')`;
      });
      expect((await discrepancies(tx, w.box1))[0]!.status).toBe('escalated');
      const events = await tx<{ kind: string; report_ref: string | null }[]>`select kind, report_ref from cs_discrepancy_events where discrepancy_id = ${w.d.id} order by occurred_at, id`;
      expect(events.map((e) => [e.kind, e.report_ref])).toEqual([['investigate', null], ['escalate', 'Incident 2026-0417']]);
    });
  });

  it('the counter and the witness cannot resolve; a different manager can, once', async () => {
    await withAdmin(async (tx) => {
      const w = await opened(tx);
      await as(tx, w, w.counter, async () => {
        await expectDbError(tx, /cannot resolve their own count/, () => tx`select app.resolve_cs_discrepancy(${w.d.id}, 'Found it in the bag, recounted', null, null)`);
      });
      const witnessManager = await person(tx, w.t, ['custody.witness', 'custody.manage'], { scopeKind: 'org_unit', orgUnitId: w.s1 });
      // A count witnessed by that manager: they may not resolve it either.
      const req = await witnessed(tx, w, w.recorder, witnessManager, 'count', { location: w.box1, lines: [{ lot_id: w.lotA, counted: 3 }] }, w.box1);
      await as(tx, w, w.recorder, async () => {
        await tx`select app.submit_cs_count(${w.box1}, ${tx.json([{ lot_id: w.lotA, counted: 3 }] as never)}, null, null, ${req})`;
      });
      const second = (await discrepancies(tx, w.box1)).find((x) => x.id !== w.d.id)!;
      await as(tx, w, witnessManager, async () => {
        await expectDbError(tx, /cannot resolve their own count/, () => tx`select app.resolve_cs_discrepancy(${second.id}, 'Found it in the bag, recounted', null, null)`);
      });
      await as(tx, w, w.manager1, async () => {
        await expectDbError(tx, /at least 10 characters/, () => tx`select app.resolve_cs_discrepancy(${w.d.id}, 'short', null, null)`);
        await tx`select app.resolve_cs_discrepancy(${w.d.id}, 'Recounted with the officer; vial was returned', null, null)`;
        await expectDbError(tx, /already resolved/, () => tx`select app.resolve_cs_discrepancy(${w.d.id}, 'Resolving it again for fun', null, null)`);
        await expectDbError(tx, /already resolved/, () => tx`select app.investigate_cs_discrepancy(${w.d.id}, 'Looking again')`);
      });
      expect(await onHand(tx, w.box1, w.lotA)).toBe(5);   // no delta, no change
    });
  });

  it('resolving with a delta posts one witnessed adjust linked to the discrepancy, and only then does the balance change', async () => {
    await withAdmin(async (tx) => {
      const w = await opened(tx);
      const note = 'Vial confirmed broken; waste form on file';
      const req = await witnessed(tx, w, w.manager1, w.witness, 'adjust', { location: w.box1, lot: w.lotA, delta: -1, reason: note, discrepancy: w.d.id }, w.box1);
      expect(await onHand(tx, w.box1, w.lotA)).toBe(5);
      await as(tx, w, w.manager1, async () => {
        await tx`select app.resolve_cs_discrepancy(${w.d.id}, ${note}, -1, ${req})`;
      });
      expect(await onHand(tx, w.box1, w.lotA)).toBe(4);
      const adj = await tx<{ id: string; discrepancy_id: string; witnessed_by: string }[]>`select id, discrepancy_id, witnessed_by from cs_ledger where tenant_id = ${w.t} and type = 'adjust'`;
      expect(adj).toHaveLength(1);
      expect(adj[0]).toMatchObject({ discrepancy_id: w.d.id, witnessed_by: w.witness.m });
      const [ev] = await tx<{ adjust_ledger_id: string }[]>`select adjust_ledger_id from cs_discrepancy_events where discrepancy_id = ${w.d.id} and kind = 'resolve'`;
      expect(ev!.adjust_ledger_id).toBe(adj[0]!.id);
    });
  });

  it('discrepancies are never deleted or edited; only their status moves', async () => {
    await withAdmin(async (tx) => {
      const w = await opened(tx);
      await as(tx, w, w.manager1, async () => { await tx`select app.investigate_cs_discrepancy(${w.d.id}, 'Checking the run reports')`; });
      await expectDbError(tx, /cannot be deleted/, () => tx`delete from cs_discrepancies`);
      await expectDbError(tx, /cannot be deleted|cannot truncate/, () => tx`truncate cs_discrepancies`);
      await expectDbError(tx, /can only change status/, () => tx`update cs_discrepancies set expected = 99`);
      await expectDbError(tx, /append-only/, () => tx`delete from cs_discrepancy_events`);
      await as(tx, w, w.manager, async () => {
        await expectDbError(tx, /permission denied/, () => tx`update cs_discrepancies set status = 'resolved'`);
      });
    });
  });

  it('is scoped: an officer elsewhere sees none, an auditor sees all and cannot act', async () => {
    await withAdmin(async (tx) => {
      const w = await opened(tx);
      await as(tx, w, w.recorderElsewhere, async () => { expect((await tx`select 1 from cs_open_discrepancies`).length).toBe(0); });
      await as(tx, w, w.auditor, async () => {
        expect((await tx`select 1 from cs_open_discrepancies`).length).toBe(1);
        await expectDbError(tx, /custody\.manage required/, () => tx`select app.investigate_cs_discrepancy(${w.d.id}, 'Looking into it')`);
      });
      const other = await csWorld(tx);
      await as(tx, other, other.auditor, async () => { expect((await tx`select 1 from cs_discrepancies`).length).toBe(0); });
    });
  });
});

describe('expiry and recall views', () => {
  it('list exactly the lots with stock in scope that expire within 90 days or are recalled', async () => {
    await withAdmin(async (tx) => {
      const w = await csWorld(tx);
      const lot = async (no: string, days: number) =>
        (await tx<{ id: string }[]>`insert into cs_lots (tenant_id, item_id, lot_no, expires_on) values (${w.t}, ${w.item}, ${no}, current_date + ${days}::int) returning id`)[0]!.id;
      const soon = await lot('SOON', 20);
      const later = await lot('LATER', 200);
      const empty = await lot('EMPTY', 5);
      const elsewhere = await lot('ELSE', 10);
      await stock(tx, w, w.box1, soon, 3);
      await stock(tx, w, w.box1, later, 3);
      await stock(tx, w, w.box2, elsewhere, 3);
      await stock(tx, w, w.box1, w.lotB, 2);
      await as(tx, w, w.manager, async () => { await tx`select app.flag_cs_lot_recall(${w.lotB}, 'Manufacturer recall')`; });
      void empty;
      await as(tx, w, w.recorder, async () => {
        const e = await tx<{ lot_no: string; days_left: number }[]>`select lot_no, days_left from cs_expiring order by days_left`;
        expect(e.map((r) => [r.lot_no, Number(r.days_left)])).toEqual([['SOON', 20]]);
        expect((await tx<{ lot_no: string }[]>`select lot_no from cs_recalled`).map((r) => r.lot_no)).toEqual(['B200']);
      });
      await as(tx, w, w.auditor, async () => {
        expect((await tx<{ lot_no: string }[]>`select lot_no from cs_expiring order by days_left`).map((r) => r.lot_no)).toEqual(['ELSE', 'SOON']);
      });
      await as(tx, w, w.nobody, async () => { expect((await tx`select 1 from cs_expiring`).length).toBe(0); });
    });
  });
});
