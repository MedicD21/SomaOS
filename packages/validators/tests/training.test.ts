import { describe, expect, it } from 'vitest';
import {
  trainingAttendanceSchema, trainingCancelSchema, trainingCategorySchema, trainingCourseSchema, trainingRequirementSchema, trainingSessionSchema,
} from '../src';

const uuid = () => crypto.randomUUID();
const messages = (r: { success: false; error: { issues: { message: string }[] } }) => r.error.issues.map((i) => i.message).join(' | ');

describe('categories and courses', () => {
  it('derives a key from the label and blanks the code', () => {
    expect(trainingCategorySchema.parse({ label: 'Driver Operator', key: '', externalCode: '' })).toMatchObject({ key: 'driver_operator', externalCode: null });
  });

  it('accepts a course and defaults completion to 100 percent', () => {
    const v = trainingCourseSchema.parse({ label: 'CPR renewal', categoryId: uuid(), defaultHours: '4', credentialTypeId: '', description: '' });
    expect(v).toMatchObject({ key: 'cpr_renewal', defaultHours: 4, minHoursPct: 100, credentialTypeId: null });
  });

  it.each([
    ['zero hours', { defaultHours: '0' }, 'more than 0'],
    ['too many hours', { defaultHours: '1000' }, 'at most 999'],
    ['three decimals', { defaultHours: '1.005' }, '2 decimal'],
    ['percent over 100', { minHoursPct: '150' }, 'Use 0 to 100'],
    ['no category', { categoryId: '' }, 'category'],
  ])('rejects %s', (_n, patch, msg) => {
    const r = trainingCourseSchema.safeParse({ label: 'X', categoryId: uuid(), defaultHours: '2', ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(messages(r)).toContain(msg);
  });
});

describe('requirements build the stored window shape', () => {
  const base = { label: 'Fire hours', categoryId: uuid(), rankId: '', roleId: '', requiredHours: '24', effectiveFrom: '2026-01-01' };

  it('calendar year ignores the other fields', () => {
    expect(trainingRequirementSchema.parse({ ...base, windowKind: 'calendar_year', months: '99' }).window).toEqual({ kind: 'calendar_year' });
  });

  it('rolling months and fixed cycles need their own fields', () => {
    expect(trainingRequirementSchema.parse({ ...base, windowKind: 'rolling_months', months: '12' }).window).toEqual({ kind: 'rolling_months', months: 12 });
    expect(trainingRequirementSchema.parse({ ...base, windowKind: 'fixed_cycle', month: '3', day: '31', years: '2' }).window).toEqual({ kind: 'fixed_cycle', month: 3, day: 31, years: 2 });
    const missing = trainingRequirementSchema.safeParse({ ...base, windowKind: 'rolling_months' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(messages(missing)).toContain('number of months');
    const cycle = trainingRequirementSchema.safeParse({ ...base, windowKind: 'fixed_cycle', month: '13', day: '1', years: '1' });
    expect(cycle.success).toBe(false);
    if (!cycle.success) expect(messages(cycle)).toContain('Use 1 to 12');
  });

  it('keeps rank and role blank as null and rejects non-positive hours', () => {
    expect(trainingRequirementSchema.parse({ ...base, windowKind: 'calendar_year' })).toMatchObject({ rankId: null, roleId: null });
    expect(trainingRequirementSchema.safeParse({ ...base, windowKind: 'calendar_year', requiredHours: '0' }).success).toBe(false);
  });
});

describe('sessions', () => {
  const ok = { courseId: uuid(), title: 'Engine drill', date: '2026-12-01', startTime: '09:00', durationHours: '2', orgUnitId: '', location: '', instructorId: '', capacity: '', assignedOnly: '', notes: '' };

  it('accepts a session and blanks optional fields', () => {
    expect(trainingSessionSchema.parse(ok)).toMatchObject({ durationHours: 2, orgUnitId: null, capacity: null, assignedOnly: false, audience: [] });
    expect(trainingSessionSchema.parse({ ...ok, assignedOnly: 'on', capacity: '12' })).toMatchObject({ assignedOnly: true, capacity: 12 });
  });

  it.each([
    ['bad time', { startTime: '9am' }, 'HH:MM'],
    ['no title', { title: ' ' }, 'title'],
    ['zero length', { durationHours: '0' }, 'more than 0'],
    ['capacity zero', { capacity: '0' }, 'at least 1'],
    ['bad date', { date: '12/01/2026' }, 'date'],
  ])('rejects %s', (_n, patch, msg) => {
    const r = trainingSessionSchema.safeParse({ ...ok, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(messages(r)).toContain(msg);
  });

  it('validates audience entries', () => {
    expect(trainingSessionSchema.safeParse({ ...ok, audience: [{ kind: 'rank', refId: uuid() }] }).success).toBe(true);
    expect(trainingSessionSchema.safeParse({ ...ok, audience: [{ kind: 'everyone', refId: uuid() }] }).success).toBe(false);
  });
});

describe('attendance and cancel', () => {
  const enrollmentId = uuid();

  it('a partial needs hours and a note; the others do not', () => {
    expect(trainingAttendanceSchema.safeParse({ enrollmentId, status: 'attended' }).success).toBe(true);
    expect(trainingAttendanceSchema.safeParse({ enrollmentId, status: 'absent', hours: '' }).success).toBe(true);
    const partial = trainingAttendanceSchema.safeParse({ enrollmentId, status: 'partial' });
    expect(partial.success).toBe(false);
    if (!partial.success) expect(messages(partial)).toContain('Enter the hours attended');
    expect(trainingAttendanceSchema.safeParse({ enrollmentId, status: 'partial', hours: '1', note: 'no' }).success).toBe(false);
    expect(trainingAttendanceSchema.safeParse({ enrollmentId, status: 'partial', hours: '1.5', note: 'Left early for a call' }).success).toBe(true);
    expect(trainingAttendanceSchema.safeParse({ enrollmentId, status: 'late' }).success).toBe(false);
  });

  it('cancelling needs a real reason', () => {
    expect(trainingCancelSchema.safeParse({ id: uuid(), reason: 'no' }).success).toBe(false);
    expect(trainingCancelSchema.safeParse({ id: uuid(), reason: 'Instructor unavailable' }).success).toBe(true);
  });
});
