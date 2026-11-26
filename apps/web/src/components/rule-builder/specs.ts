import { PAY_WORK_TYPES } from '@soma/validators';
import type { Doc } from './path';
import { setAt } from './path';

/**
 * What each editable setting means, in plain English. The zod schemas in @soma/validators stay the only
 * source of validity; these specs only say how to ask for the value and what it does. Add a field to a
 * schema and the drift test (tests/rule-specs.test.ts) fails until it has a spec here.
 */

export type FieldSpec = {
  path: string;
  label: string;
  help: string;
  input: 'number' | 'text' | 'date' | 'select' | 'toggle';
  unit?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  /** What an emptied field means: write null, or remove the key. Default: leave it blank so the schema complains. */
  blank?: 'null' | 'remove';
  /** Offer existing pay codes or leave banks as suggestions (still free text). */
  suggest?: 'payCodes' | 'banks';
  /** Advice that never decides validity, e.g. a typical value to verify against the agreement. */
  advice?: string;
  /** Show only when another setting has this value. */
  when?: { path: string; equals: unknown };
  /** Replace the default write (used by settings that change the shape of the document). */
  set?: (doc: Doc, value: string) => Doc;
};

export type SectionSpec = {
  id: string;
  title: string;
  intro?: string;
  fields: FieldSpec[];
  /** A section with its own editor: its settings live under these paths. */
  custom?: 'tiers' | 'fractions';
  covers?: string[];
};

const periodKind = (label: string): FieldSpec[] => [
  {
    path: 'period.kind', label: `${label} length`, input: 'select', help: 'Calendar months, or a fixed number of days counted from a start date.',
    options: [{ value: 'monthly', label: 'Calendar month' }, { value: 'fixed_days', label: 'A fixed number of days' }],
    set: (doc, v) => (v === 'monthly' ? setAt(doc, 'period', { kind: 'monthly' }) : setAt(doc, 'period', { kind: 'fixed_days', days: 14, anchor: '2026-01-01' })),
  },
  { path: 'period.days', label: 'Days in each period', input: 'number', unit: 'days', min: 1, max: 366, step: 1, help: 'For example 14 for a two-week pay period.', when: { path: 'period.kind', equals: 'fixed_days' } },
  { path: 'period.anchor', label: 'First day of any one period', input: 'date', help: 'Periods are counted in blocks of days from this date.', when: { path: 'period.kind', equals: 'fixed_days' } },
];

const asPayPeriod = (f: FieldSpec[]): FieldSpec[] =>
  f.map((x) => ({
    ...x,
    path: x.path.replace(/^period/, 'payPeriod'),
    when: x.when ? { ...x.when, path: x.when.path.replace(/^period/, 'payPeriod') } : undefined,
    set: x.set ? (doc, v) => (v === 'monthly' ? setAt(doc, 'payPeriod', { kind: 'monthly' }) : setAt(doc, 'payPeriod', { kind: 'fixed_days', days: 14, anchor: '2026-01-01' })) : undefined,
  }));

const WORK_LABEL: Record<(typeof PAY_WORK_TYPES)[number], string> = {
  regular: 'Regular shifts', overtime: 'Overtime', trade: 'Traded shifts', holdover: 'Holdovers',
  callback: 'Callbacks', acting: 'Acting shifts', training: 'Training', detail: 'Details',
};

export const PAY_SECTIONS: SectionSpec[] = [
  { id: 'period', title: 'Pay period', intro: 'How the calendar is cut into pay periods. A period uses the rules in force on its first day.', fields: asPayPeriod(periodKind('Pay period')) },
  {
    id: 'overtime',
    title: 'Overtime threshold',
    intro: 'Hours worked above the threshold in each work period are federal overtime.',
    fields: [
      { path: 'workPeriod.days', label: 'Days in the work period', input: 'number', unit: 'days', min: 1, max: 366, step: 1, help: 'The length of the block the threshold applies to.', advice: '28 days is the usual fire-service election; verify against your agreement.' },
      { path: 'workPeriod.anchor', label: 'First day of any one work period', input: 'date', help: 'Work periods are counted in blocks from this date.' },
      { path: 'workPeriod.threshold', label: 'Overtime starts after', input: 'number', unit: 'hours', min: 0, step: 0.5, help: 'Hours worked in one work period before overtime pay begins.', advice: '212 h for 28 days is the usual federal figure; starter value, verify.' },
      { path: 'workPeriod.multiplier', label: 'Overtime multiplier', input: 'number', unit: '×', min: 1, max: 5, step: 0.05, help: '1.5 is time and a half.' },
      { path: 'workPeriod.code', label: 'Pay code for overtime', input: 'text', suggest: 'payCodes', help: 'Which pay code overtime hours are reported under.' },
      {
        path: 'overtimeCombination', label: 'When contract and federal overtime meet', input: 'select',
        help: 'An hour can be both. "Larger" pays the bigger multiplier once; "add" adds the premiums.',
        options: [{ value: 'highest', label: 'Pay the larger multiplier once' }, { value: 'stack', label: 'Add the premiums together' }],
      },
    ],
  },
  {
    id: 'work',
    title: 'Pay code for each kind of work',
    intro: 'Which pay code and multiplier each kind of shift uses.',
    fields: PAY_WORK_TYPES.flatMap((t): FieldSpec[] => [
      { path: `assignments.${t}.code`, label: `${WORK_LABEL[t]}: pay code`, input: 'text', suggest: 'payCodes', help: 'The pay code these hours are reported under.' },
      { path: `assignments.${t}.multiplier`, label: `${WORK_LABEL[t]}: multiplier`, input: 'number', unit: '×', min: 0, max: 5, step: 0.05, help: '1 is straight time; 0 is unpaid.' },
      { path: `assignments.${t}.countsTowardFlsa`, label: `${WORK_LABEL[t]}: counts toward the overtime threshold`, input: 'toggle', help: 'Untick if these hours should not move a member toward overtime.', blank: 'remove' },
      { path: `assignments.${t}.minimumHours`, label: `${WORK_LABEL[t]}: guaranteed hours`, input: 'number', unit: 'hours', min: 0, max: 48, step: 0.5, blank: 'remove', help: 'Leave empty for none. A shorter shift is paid up to this many hours; the top-up is not time worked.' },
    ]),
  },
  {
    id: 'comp',
    title: 'Comp time',
    intro: 'Whether overtime and other premium hours can be taken as comp time instead of cash.',
    fields: [
      {
        path: 'compTime.mode', label: 'Comp time', input: 'select', help: '"Member choice" follows each member’s comp-time preference.',
        options: [{ value: 'never', label: 'Never: always pay cash' }, { value: 'always', label: 'Always: credit comp time, no cash' }, { value: 'member_choice', label: 'Member choice' }],
      },
      { path: 'compTime.multiplier', label: 'Comp hours earned per hour', input: 'number', unit: '×', min: 1, max: 5, step: 0.05, help: '1.5 credits one and a half hours for each hour.' },
      { path: 'compTime.bankKey', label: 'Leave bank comp time goes to', input: 'text', suggest: 'banks', blank: 'null', help: 'Required unless comp time is off.' },
    ],
  },
];

export const ACCRUAL_SECTIONS: SectionSpec[] = [
  { id: 'period', title: 'How often leave is earned', fields: periodKind('Accrual period') },
  { id: 'tiers', title: 'Tiers by years of service', intro: 'The tier with the most years that the member has reached applies.', fields: [], custom: 'tiers', covers: ['tiers'] },
  {
    id: 'limits',
    title: 'Cap, waiting period and proration',
    fields: [
      { path: 'cap', label: 'Balance cap', input: 'number', unit: 'hours', min: 0, step: 1, blank: 'null', help: 'Earning stops at this balance. Empty means no cap.' },
      { path: 'waitingPeriodDays', label: 'Waiting period', input: 'number', unit: 'days', min: 0, max: 3650, step: 1, help: 'Nothing accrues until this many days after the hire date.' },
      { path: 'prorateFirstPeriod', label: 'Prorate the first period', input: 'toggle', help: 'Scale the first period’s earnings by the days employed.' },
      { path: 'negativeAllowed', label: 'Balance may go negative', input: 'toggle', help: 'Allow leave to be taken before it is earned.' },
    ],
  },
  { id: 'fractions', title: 'Part-time fractions', intro: 'Employment types that earn only part of the normal amount.', fields: [], custom: 'fractions', covers: ['fractionByEmploymentType'] },
  {
    id: 'carryover',
    title: 'Year-end carryover',
    fields: [
      { path: 'carryover.resetOn', label: 'Reset on', input: 'text', blank: 'null', help: 'Month and day as MM-DD, for example 01-01. Empty means balances never reset.' },
      { path: 'carryover.max', label: 'Most hours that carry over', input: 'number', unit: 'hours', min: 0, step: 1, blank: 'null', help: 'Balance above this is forfeited at the reset. Empty carries everything over.' },
    ],
  },
];

export type RuleKindKey = 'pay' | 'accrual';
export const SECTIONS: Record<RuleKindKey, SectionSpec[]> = { pay: PAY_SECTIONS, accrual: ACCRUAL_SECTIONS };

/** Every path the form edits (custom sections list the prefixes they own). */
export function coveredPaths(kind: RuleKindKey): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const s of SECTIONS[kind]) {
    for (const f of s.fields) exact.add(f.path);
    prefixes.push(...(s.covers ?? []));
  }
  return { exact, prefixes };
}
