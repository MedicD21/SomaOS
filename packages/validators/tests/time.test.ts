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
