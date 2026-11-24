import { describe, expect, it } from 'vitest';
import { nextScanTime } from '../../src/jobs/credential-expiry-scan';

describe('nextScanTime', () => {
  it('returns today 06:00 UTC when before it', () => {
    expect(nextScanTime(new Date('2026-11-24T05:59:59Z')).toISOString()).toBe('2026-11-24T06:00:00.000Z');
  });
  it('returns tomorrow 06:00 UTC at exactly 06:00', () => {
    expect(nextScanTime(new Date('2026-11-24T06:00:00Z')).toISOString()).toBe('2026-11-25T06:00:00.000Z');
  });
  it('returns tomorrow 06:00 UTC when after it, across month end', () => {
    expect(nextScanTime(new Date('2026-11-30T12:00:00Z')).toISOString()).toBe('2026-12-01T06:00:00.000Z');
  });
});
