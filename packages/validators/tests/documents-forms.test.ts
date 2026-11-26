import { describe, expect, it } from 'vitest';
import {
  acknowledgeSchema, addVersionSchema, assignReadingSchema, coerceAnswers, createDocumentSchema, folderSchema, formDefinitionSchema,
  formFieldsSchema, isFieldVisible, publishVersionSchema, submitFormSchema, type FormField,
} from '../src';

const id = () => crypto.randomUUID();

describe('document schemas', () => {
  it('folder: blank parent and permission become null; permission must look like a code', () => {
    expect(folderSchema.parse({ name: ' HR ', parentId: '', viewPermission: '' })).toMatchObject({ name: 'HR', parentId: null, viewPermission: null });
    expect(folderSchema.parse({ name: 'HR', viewPermission: 'admin.members.manage' }).viewPermission).toBe('admin.members.manage');
    expect(folderSchema.safeParse({ name: 'HR', viewPermission: 'whatever' }).success).toBe(false);
    expect(folderSchema.safeParse({ name: '' }).success).toBe(false);
  });
  it('document: kinds, title and the acknowledgement checkbox', () => {
    const base = { folderId: id(), kind: 'sog', title: 'Vehicle Fires', number: '3.4', requiresAck: 'on' };
    expect(createDocumentSchema.parse(base)).toMatchObject({ requiresAck: true, number: '3.4' });
    expect(createDocumentSchema.parse({ ...base, requiresAck: undefined, number: '' })).toMatchObject({ requiresAck: false, number: null });
    expect(createDocumentSchema.safeParse({ ...base, kind: 'memo' }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ ...base, title: ' ' }).success).toBe(false);
  });
  it('version label is at most 40 characters; a short backdate reason is refused', () => {
    expect(addVersionSchema.safeParse({ documentId: id(), label: 'x'.repeat(41) }).success).toBe(false);
    expect(addVersionSchema.parse({ documentId: id(), label: '2.0', changeNote: '' }).changeNote).toBeNull();
    expect(publishVersionSchema.parse({ versionId: id(), effectiveFrom: '', major: 'on' })).toMatchObject({ effectiveFrom: null, major: true });
    expect(publishVersionSchema.safeParse({ versionId: id(), backdateReason: 'no' }).success).toBe(false);
  });
});

describe('reading schemas', () => {
  it('an audience is required; everyone wins over lists', () => {
    expect(assignReadingSchema.safeParse({ versionId: id() }).success).toBe(false);
    expect(assignReadingSchema.parse({ versionId: id(), everyone: 'on', orgUnitIds: [id()] }).audience).toEqual({ all: true });
    const u = id();
    expect(assignReadingSchema.parse({ versionId: id(), orgUnitIds: [u], dueOn: '2026-12-31' })).toMatchObject({
      audience: { org_unit_ids: [u], role_ids: [] }, dueOn: '2026-12-31', requireTypedName: false,
    });
  });
  it('acknowledge: a blank typed name is null', () => {
    expect(acknowledgeSchema.parse({ readingId: id(), typedName: '' }).typedName).toBeNull();
  });
});

describe('form definitions', () => {
  const fields = [
    { key: 'injured', label: 'Injured?', type: 'boolean' as const, required: true },
    { key: 'details', label: 'Details', type: 'text' as const, required: true, show_if: { field: 'injured', equals: true } },
    { key: 'severity', label: 'Severity', type: 'select' as const, required: false, options: [{ value: 'minor', label: 'Minor' }] },
  ];
  it('accepts a valid field list and rejects what the database rejects', () => {
    expect(formFieldsSchema.safeParse(fields).success).toBe(true);
    expect(formFieldsSchema.safeParse([]).success).toBe(false);
    expect(formFieldsSchema.safeParse([fields[0], fields[0]]).success).toBe(false);
    expect(formFieldsSchema.safeParse([{ key: 's', label: 'S', type: 'select', required: false }]).success).toBe(false);
    expect(formFieldsSchema.safeParse([fields[1], fields[0]]).success).toBe(false);
    expect(formFieldsSchema.safeParse([{ key: 'p', label: 'P', type: 'photo', required: false }]).success).toBe(false);
    expect(formFieldsSchema.safeParse(Array.from({ length: 201 }, (_, i) => ({ key: `f${i}`, label: 'F', type: 'text', required: false }))).success).toBe(false);
  });
  it('a signed form needs a real statement', () => {
    const base = { key: 'injury', label: 'Injury', fields, approval: 'officer', requiresSignature: 'on' };
    expect(formDefinitionSchema.safeParse({ ...base, signatureStatement: 'short' }).success).toBe(false);
    expect(formDefinitionSchema.safeParse({ ...base, signatureStatement: 'I certify this is true and complete.' }).success).toBe(true);
    expect(formDefinitionSchema.safeParse({ ...base, requiresSignature: undefined }).success).toBe(true);
  });
});

describe('coerceAnswers', () => {
  const fields: FormField[] = [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'count', label: 'Count', type: 'integer', required: false },
    { key: 'cost', label: 'Cost', type: 'number', required: false },
    { key: 'injured', label: 'Injured', type: 'boolean', required: true },
    { key: 'details', label: 'Details', type: 'text', required: false, show_if: { field: 'injured', equals: true } },
    { key: 'tags', label: 'Tags', type: 'multi_select', required: false, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  ];
  it('parses numbers, booleans and lists, trims, omits blanks, and drops hidden fields', () => {
    expect(coerceAnswers(fields, { name: ' Pat ', count: '3', cost: '12.50', injured: 'false', tags: ['a', 'b'], details: 'hidden' })).toEqual({
      name: 'Pat', count: 3, cost: 12.5, injured: false, tags: ['a', 'b'],
    });
    expect(coerceAnswers(fields, { name: '', count: '', injured: 'true', details: 'Sprain' })).toEqual({ injured: true, details: 'Sprain' });
  });
  it('leaves a non-number as text so validation can say so; no yes/no choice omits the boolean', () => {
    expect(coerceAnswers(fields, { name: 'x', count: 'abc' }).count).toBe('abc');
    expect(coerceAnswers(fields, { name: 'x' })).toEqual({ name: 'x' });
  });
  it('isFieldVisible follows show_if', () => {
    expect(isFieldVisible(fields[4]!, { injured: true })).toBe(true);
    expect(isFieldVisible(fields[4]!, { injured: false })).toBe(false);
    expect(isFieldVisible(fields[0]!, {})).toBe(true);
  });
});

describe('submitFormSchema', () => {
  it('blank signature values are null; the method must be typed or drawn', () => {
    expect(submitFormSchema.parse({ definitionId: id(), correctsId: '', signatureMethod: '' })).toMatchObject({ correctsId: null, signatureMethod: null });
    expect(submitFormSchema.safeParse({ definitionId: id(), signatureMethod: 'scribble' }).success).toBe(false);
  });
});
