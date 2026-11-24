import type { AccrualPolicy } from '@soma/schedule-engine';

export type LeaveTemplate = {
  banks: { key: string; label: string }[];
  types: {
    key: string;
    label: string;
    bankKey: string | null;
    leadTimeDays: number;
    requiresDocumentation: boolean;
    countsAsWorked: boolean;
  }[];
  /** Applied as DRAFT config versions: an admin must edit them to match their contract and approve. */
  policies: { bankKey: string; payload: AccrualPolicy }[];
};

const base: Omit<AccrualPolicy, 'tiers'> = {
  period: { kind: 'monthly' },
  cap: null,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: { career_part_time: 0.5 },
  negativeAllowed: false,
  carryover: { max: null, resetOn: null },
};

/**
 * STARTER VALUES ONLY. These hours are placeholders so a new department sees a working example;
 * they are not any department's contract. Policies are created as drafts and take effect only
 * when an administrator edits and approves them.
 */
export const CAREER_LEAVE: LeaveTemplate = {
  banks: [
    { key: 'vacation', label: 'Vacation' },
    { key: 'sick', label: 'Sick leave' },
    { key: 'comp_time', label: 'Compensatory time' },
    { key: 'holiday', label: 'Holiday' },
  ],
  types: [
    { key: 'vacation', label: 'Vacation', bankKey: 'vacation', leadTimeDays: 7, requiresDocumentation: false, countsAsWorked: false },
    { key: 'sick', label: 'Sick leave', bankKey: 'sick', leadTimeDays: 0, requiresDocumentation: false, countsAsWorked: false },
    { key: 'comp_time', label: 'Compensatory time', bankKey: 'comp_time', leadTimeDays: 1, requiresDocumentation: false, countsAsWorked: false },
    { key: 'holiday', label: 'Holiday', bankKey: 'holiday', leadTimeDays: 7, requiresDocumentation: false, countsAsWorked: false },
    { key: 'bereavement', label: 'Bereavement', bankKey: null, leadTimeDays: 0, requiresDocumentation: false, countsAsWorked: false },
    { key: 'fmla', label: 'FMLA', bankKey: null, leadTimeDays: 0, requiresDocumentation: true, countsAsWorked: false },
    { key: 'military', label: 'Military leave', bankKey: null, leadTimeDays: 0, requiresDocumentation: true, countsAsWorked: false },
  ],
  policies: [
    {
      bankKey: 'vacation',
      payload: {
        ...base,
        tiers: [
          { fromYears: 0, earn: { method: 'per_period', hours: 8 } },
          { fromYears: 5, earn: { method: 'per_period', hours: 12 } },
          { fromYears: 10, earn: { method: 'per_period', hours: 16 } },
        ],
        carryover: { max: 240, resetOn: '01-01' },
      },
    },
    {
      bankKey: 'sick',
      payload: { ...base, tiers: [{ fromYears: 0, earn: { method: 'per_period', hours: 12 } }] },
    },
    {
      // Earned from overtime in Phase 1c; for now credited by manual adjustment. 480 h is the
      // usual public-safety ceiling — policy data, change it to match your agreement.
      bankKey: 'comp_time',
      payload: { ...base, tiers: [{ fromYears: 0, earn: { method: 'manual' } }], cap: 480, prorateFirstPeriod: false },
    },
    {
      bankKey: 'holiday',
      payload: {
        ...base,
        period: { kind: 'monthly' },
        tiers: [{ fromYears: 0, earn: { method: 'annual_front_load', hours: 96 } }],
        prorateFirstPeriod: false,
      },
    },
  ],
};

/** Volunteers rarely carry paid balances, but still log protected leave. */
export const VOLUNTEER_LEAVE: LeaveTemplate = {
  banks: [],
  types: [
    { key: 'fmla', label: 'FMLA', bankKey: null, leadTimeDays: 0, requiresDocumentation: true, countsAsWorked: false },
    { key: 'military', label: 'Military leave', bankKey: null, leadTimeDays: 0, requiresDocumentation: true, countsAsWorked: false },
  ],
  policies: [],
};
