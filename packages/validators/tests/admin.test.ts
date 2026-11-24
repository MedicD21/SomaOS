import { describe, expect, it } from 'vitest';
import { orgUnitSchema, rankSchema, shiftSchema, tenantSettingsSchema, TERMINOLOGY_KEYS } from '../src/index';

describe('tenantSettingsSchema', () => {
  const base = { timezone: 'America/Chicago', terminology: {}, enabledModules: ['admin'] };

  it('accepts a valid IANA timezone and known terminology keys', () => {
    const r = tenantSettingsSchema.safeParse({ ...base, terminology: { shift: 'Platoon', shifts: 'Platoons' } });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown timezone', () => {
    const r = tenantSettingsSchema.safeParse({ ...base, timezone: 'Mars/Olympus' });
    expect(r.error?.issues[0]?.path).toEqual(['timezone']);
  });

  it('rejects terminology keys outside the allowed list', () => {
    const r = tenantSettingsSchema.safeParse({ ...base, terminology: { chief: 'Boss' } });
    expect(r.success).toBe(false);
  });

  it('drops blank terminology overrides', () => {
    const r = tenantSettingsSchema.parse({ ...base, terminology: { shift: '  ', station: 'House' } });
    expect(r.terminology).toEqual({ station: 'House' });
  });

  it('exposes singular and plural keys', () => {
    expect(TERMINOLOGY_KEYS).toContain('shift');
    expect(TERMINOLOGY_KEYS).toContain('shifts');
  });
});

describe('org, rank, shift schemas', () => {
  it('requires a name and uuid type for org units; parent optional', () => {
    expect(orgUnitSchema.safeParse({ name: '', typeId: crypto.randomUUID() }).success).toBe(false);
    expect(orgUnitSchema.parse({ name: ' Station 1 ', typeId: crypto.randomUUID(), parentId: '' })).toMatchObject({
      name: 'Station 1',
      parentId: null,
    });
  });

  it('validates rank key format and positive sort', () => {
    expect(rankSchema.safeParse({ key: 'Captain', label: 'Captain', sort: 4 }).success).toBe(false);
    expect(rankSchema.safeParse({ key: 'captain', label: 'Captain', sort: 0 }).success).toBe(false);
    expect(rankSchema.safeParse({ key: 'captain', label: 'Captain', sort: '4' }).success).toBe(true);
  });

  it('validates shift color as hex', () => {
    expect(shiftSchema.safeParse({ key: 'a', label: 'A', color: 'red' }).success).toBe(false);
    expect(shiftSchema.safeParse({ key: 'a', label: 'A', color: '#dc2626' }).success).toBe(true);
  });
});
