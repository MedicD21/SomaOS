import { describe, expect, it } from 'vitest';
import { leaveLimitSchema, overrideReasonSchema } from '../src';

const ok = { label: 'Station 1 vacation cap', orgUnitId: '', shiftId: '', leaveTypeId: '', maxConcurrent: '2', effectiveFrom: '2027-01-01' };

describe('leaveLimitSchema', () => {
  it('a blank station means department-wide; a station means org_unit', () => {
    expect(leaveLimitSchema.parse(ok)).toMatchObject({ scopeKind: 'department', orgUnitId: null, shiftId: null, leaveTypeId: null, maxConcurrent: 2 });
    expect(leaveLimitSchema.parse({ ...ok, orgUnitId: crypto.randomUUID() }).scopeKind).toBe('org_unit');
  });
  it.each([
    ['negative', { maxConcurrent: '-1' }],
    ['fraction', { maxConcurrent: '1.5' }],
    ['too many', { maxConcurrent: '5000' }],
    ['blank', { maxConcurrent: '' }],
    ['bad date', { effectiveFrom: 'soon' }],
    ['no label', { label: '' }],
  ])('rejects %s', (_n, patch) => {
    expect(leaveLimitSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
  it('allows a limit of zero (no one may be off)', () => {
    expect(leaveLimitSchema.parse({ ...ok, maxConcurrent: '0' }).maxConcurrent).toBe(0);
  });
});

describe('overrideReasonSchema', () => {
  it('needs 5 characters', () => {
    expect(overrideReasonSchema.safeParse('no').success).toBe(false);
    expect(overrideReasonSchema.safeParse('Coverage arranged').success).toBe(true);
  });
});
