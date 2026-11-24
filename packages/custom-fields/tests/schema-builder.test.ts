import { describe, expect, it } from 'vitest';
import type { CustomFieldDef } from '../src/schema-builder';
import { buildCustomFieldSchema } from '../src/schema-builder';

const def = (d: Partial<CustomFieldDef> & Pick<CustomFieldDef, 'key' | 'type'>): CustomFieldDef => ({
  label: d.key,
  required: false,
  archived: false,
  ...d,
});

const issuesFor = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.')) ?? [];

describe('buildCustomFieldSchema', () => {
  const schema = buildCustomFieldSchema([
    def({ key: 'badge', type: 'text', required: true }),
    def({ key: 'shirt', type: 'select', options: [{ value: 'm', label: 'M' }, { value: 'l', label: 'L' }] }),
    def({ key: 'locker', type: 'integer' }),
    def({ key: 'certs', type: 'multi_select', options: [{ value: 'hazmat', label: 'HazMat' }] }),
    def({ key: 'dob', type: 'date' }),
    def({ key: 'legacy', type: 'text', required: true, archived: true }),
  ]);

  it('accepts valid values', () => {
    const r = schema.safeParse({ badge: 'B-12', shirt: 'm', locker: 4, certs: ['hazmat'], dob: '1990-05-01' });
    expect(r.success).toBe(true);
  });

  it('reports a missing required field at its key', () => {
    expect(issuesFor(schema.safeParse({}))).toEqual(['badge']);
  });

  it('rejects a select value not in options', () => {
    expect(issuesFor(schema.safeParse({ badge: 'x', shirt: 'xl' }))).toEqual(['shirt']);
  });

  it('rejects a non-integer for integer fields', () => {
    expect(issuesFor(schema.safeParse({ badge: 'x', locker: 1.5 }))).toEqual(['locker']);
  });

  it('rejects malformed dates', () => {
    expect(issuesFor(schema.safeParse({ badge: 'x', dob: '05/01/1990' }))).toEqual(['dob']);
  });

  it('rejects unknown keys', () => {
    expect(schema.safeParse({ badge: 'x', nope: 1 }).success).toBe(false);
  });

  it('keeps values of archived fields without requiring them', () => {
    const r = schema.safeParse({ badge: 'x', legacy: 'kept' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ legacy: 'kept' });
  });
});
