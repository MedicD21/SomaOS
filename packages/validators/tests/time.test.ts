import { describe, expect, it } from 'vitest';
import { closePeriodSchema, reopenPeriodSchema, timeEntrySchema, voidTimeEntrySchema } from '../src';

const ok = { memberId: crypto.randomUUID(), workDate: '2026-01-10', hours: '3.5', type: 'holdover', reason: 'Held over for a late call' };

describe('timeEntrySchema', () => {
  it('accepts a valid entry and coerces hours', () => {
    expect(timeEntrySchema.parse(ok)).toMatchObject({ hours: 3.5, type: 'holdover' });
  });
  it.each([
    ['zero hours', { hours: '0' }, 'more than 0'],
    ['too many hours', { hours: '49' }, 'At most 48'],
    ['three decimals', { hours: '1.005' }, '2 decimal'],
    ['blank hours', { hours: '' }, ''],
    ['unknown type', { type: 'bonus' }, ''],
    ['short reason', { reason: 'no' }, 'at least 5'],
    ['bad date', { workDate: '10/01/2026' }, 'date'],
    ['no member', { memberId: '' }, 'member'],
  ])('rejects %s', (_n, patch, msg) => {
    const r = timeEntrySchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    if (!r.success && msg) expect(r.error.issues.map((i) => i.message).join(' ')).toContain(msg);
  });
});

describe('void / close / reopen schemas', () => {
  it('require a reason of at least 5 characters', () => {
    const id = crypto.randomUUID();
    expect(voidTimeEntrySchema.safeParse({ id, reason: 'oops' }).success).toBe(false);
    expect(voidTimeEntrySchema.safeParse({ id, reason: 'Wrong date' }).success).toBe(true);
    expect(reopenPeriodSchema.safeParse({ id, reason: ' ' }).success).toBe(false);
    expect(reopenPeriodSchema.safeParse({ id, reason: 'Missed a holdover' }).success).toBe(true);
  });
  it('close needs an ISO date', () => {
    expect(closePeriodSchema.safeParse({ start: '2026-01-01' }).success).toBe(true);
    expect(closePeriodSchema.safeParse({ start: 'soon' }).success).toBe(false);
  });
});

describe('trade schemas', async () => {
  const { proposeTradeSchema, decideTradeSchema } = await import('../src');
  it('propose needs two shifts; blank note becomes null', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(proposeTradeSchema.parse({ mineId: a, theirsId: b, note: '  ' }).note).toBeNull();
    expect(proposeTradeSchema.safeParse({ mineId: a, theirsId: '' }).success).toBe(false);
  });
  it('an override needs a real reason', () => {
    const id = crypto.randomUUID();
    expect(decideTradeSchema.safeParse({ id, approve: true, overrideReason: 'no' }).success).toBe(false);
    expect(decideTradeSchema.safeParse({ id, approve: true, overrideReason: 'Short staffed' }).success).toBe(true);
    expect(decideTradeSchema.safeParse({ id, approve: false }).success).toBe(true);
  });
});

describe('open shift schemas', async () => {
  const { postOpenShiftSchema, decideClaimSchema, claimOpenShiftSchema } = await import('../src');
  it('post needs a seat, regular or overtime, and a reason', () => {
    const seatId = crypto.randomUUID();
    expect(postOpenShiftSchema.safeParse({ seatId, type: 'overtime', reason: 'Short for the weekend' }).success).toBe(true);
    expect(postOpenShiftSchema.safeParse({ seatId, type: 'detail', reason: 'Short for the weekend' }).success).toBe(false);
    expect(postOpenShiftSchema.safeParse({ seatId, type: 'regular', reason: 'no' }).success).toBe(false);
  });
  it('claim note is optional and blank becomes null; an override needs a real reason', () => {
    const id = crypto.randomUUID();
    expect(claimOpenShiftSchema.parse({ id, note: '  ' }).note).toBeNull();
    expect(decideClaimSchema.safeParse({ id, approve: true, overrideReason: 'no' }).success).toBe(false);
    expect(decideClaimSchema.safeParse({ id, approve: true, overrideReason: 'Short staffed' }).success).toBe(true);
  });
});
