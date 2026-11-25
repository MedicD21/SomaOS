import { describe, expect, it } from 'vitest';
import { describeAccrualPolicy, describePattern, describePayRules } from '../src/describe';
import type { AccrualPolicy } from '../src/accrual';
import type { PayRules } from '../src/pay';
import type { ShiftPattern } from '../src/pattern';

const RULES: PayRules = {
  payPeriod: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
  workPeriod: { days: 28, anchor: '2026-01-01', threshold: 212, multiplier: 1.5, code: 'ot' },
  overtimeCombination: 'highest',
  assignments: {
    regular: { code: 'reg', multiplier: 1 },
    overtime: { code: 'ot', multiplier: 1.5 },
    trade: { code: 'reg', multiplier: 1 },
    holdover: { code: 'hold', multiplier: 1.5 },
    callback: { code: 'call', multiplier: 1.5, minimumHours: 2 },
    acting: { code: 'act', multiplier: 1 },
    training: { code: 'reg', multiplier: 1 },
    detail: { code: 'reg', multiplier: 1, countsTowardFlsa: false },
  },
  compTime: { mode: 'never', multiplier: 1.5, bankKey: 'comp_time' },
};

describe('describePayRules', () => {
  it('explains the starter values in plain English', () => {
    const lines = describePayRules(RULES);
    expect(lines).toContain('Pay periods are 14 days long, starting 2026-01-01.');
    expect(lines).toContain('Overtime starts after 212 h worked in each 28-day work period (starting 2026-01-01) and is paid at 1.5x under "ot".');
    expect(lines).toContain('An hour that is both contract overtime and over the threshold is paid at the larger multiplier, once.');
    expect(lines).toContain('Callbacks are guaranteed 2 h; the top-up is paid but is not time worked.');
    expect(lines).toContain('Detail hours do not count toward the overtime threshold.');
    expect(lines).toContain('Overtime is never taken as comp time.');
  });

  it('lists the pay code and multiplier for each kind of work', () => {
    const lines = describePayRules(RULES);
    expect(lines).toContain('Regular shifts are paid under "reg" at 1x.');
    expect(lines).toContain('Holdover shifts are paid under "hold" at 1.5x.');
  });

  it('describes stacking premiums', () => {
    const lines = describePayRules({ ...RULES, overtimeCombination: 'stack' });
    expect(lines).toContain('An hour that is both contract overtime and over the threshold adds the premiums (for example 1.5x and 1.5x together pay 2x).');
    expect(lines).not.toContain('An hour that is both contract overtime and over the threshold is paid at the larger multiplier, once.');
  });

  it('describes comp time modes', () => {
    expect(describePayRules({ ...RULES, compTime: { mode: 'always', multiplier: 1.5, bankKey: 'comp_time' } })).toContain(
      'Overtime and other premium hours are always taken as comp time: 1.5x the hours is credited to "comp_time" and no cash is paid for them.',
    );
    expect(describePayRules({ ...RULES, compTime: { mode: 'member_choice', multiplier: 1, bankKey: 'comp_time' } })).toContain(
      'Members who ask for it take overtime and other premium hours as comp time (1x the hours credited to "comp_time"); everyone else is paid cash.',
    );
    // A switched-on mode with no bank says so instead of inventing one.
    expect(describePayRules({ ...RULES, compTime: { mode: 'member_choice', multiplier: 1.5, bankKey: null } })).toContain(
      'Comp time is switched on but no leave bank is chosen, so it cannot be credited yet.',
    );
  });

  it('describes a monthly pay period', () => {
    expect(describePayRules({ ...RULES, payPeriod: { kind: 'monthly' } })).toContain('Pay periods are calendar months.');
  });
});

const POLICY: AccrualPolicy = {
  period: { kind: 'monthly' },
  tiers: [
    { fromYears: 0, earn: { method: 'per_period', hours: 8 } },
    { fromYears: 5, earn: { method: 'per_period', hours: 12 } },
  ],
  cap: 240,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: 240, resetOn: '01-01' },
};

describe('describeAccrualPolicy', () => {
  it('explains tiers, cap, proration and carryover', () => {
    const lines = describeAccrualPolicy(POLICY);
    expect(lines).toContain('Accrual is calculated every month.');
    expect(lines).toContain('From 0 years of service: 8 h each period.');
    expect(lines).toContain('From 5 years of service: 12 h each period.');
    expect(lines).toContain('Earning stops when the balance reaches 240 h.');
    expect(lines).toContain('Accrual starts on the hire date.');
    expect(lines).toContain('The first period is prorated by the days employed.');
    expect(lines).toContain('Balances cannot go negative.');
    expect(lines).toContain('On 01-01, any balance above 240 h is forfeited.');
  });

  it('handles every earn method, no cap, waiting period and part-time fractions', () => {
    const lines = describeAccrualPolicy({
      ...POLICY,
      period: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
      tiers: [
        { fromYears: 0, earn: { method: 'per_hours_worked', perHours: 40, earnHours: 1 } },
        { fromYears: 1, earn: { method: 'annual_front_load', hours: 96 } },
        { fromYears: 2, earn: { method: 'manual' } },
      ],
      cap: null,
      waitingPeriodDays: 90,
      prorateFirstPeriod: false,
      fractionByEmploymentType: { career_part_time: 0.5 },
      negativeAllowed: true,
      carryover: { max: null, resetOn: '07-01' },
    });
    expect(lines).toContain('Accrual is calculated every 14 days (starting 2026-01-01).');
    expect(lines).toContain('From 0 years of service: 1 h for every 40 h worked.');
    expect(lines).toContain('From 1 year of service: 96 h credited at the start of each year.');
    expect(lines).toContain('From 2 years of service: no automatic accrual; balances are changed by hand.');
    expect(lines).toContain('There is no balance cap.');
    expect(lines).toContain('No accrual until 90 days after the hire date.');
    expect(lines).toContain('The first period is not prorated.');
    expect(lines).toContain('career_part_time earns 50% of the normal amount.');
    expect(lines).toContain('Balances may go negative.');
    expect(lines).toContain('On 07-01, the whole balance carries over.');
  });

  it('says plainly when nothing is ever forfeited', () => {
    expect(describeAccrualPolicy({ ...POLICY, carryover: { max: null, resetOn: null } })).toContain('Balances carry over without limit.');
  });
});

const PATTERN: ShiftPattern = {
  cycle: ['on', 'off', 'off'],
  shiftStart: '07:00',
  shiftHours: 24,
  anchorDate: '2026-01-01',
  platoons: { a: 0, b: 1, c: 2 },
  kelly: { everyNthShift: 9 },
};

describe('describePattern', () => {
  it('describes a 24/48 cycle', () => {
    const lines = describePattern(PATTERN, ['a', 'b', 'c']);
    expect(lines).toContain('The cycle is 3 days: 1 on, 2 off.');
    expect(lines).toContain('Each shift starts at 07:00 and lasts 24 h.');
    expect(lines).toContain('That averages 56 h per week.');
    expect(lines).toContain('Shift "a" starts the cycle 0 days after 2026-01-01.');
    expect(lines).toContain('Shift "c" starts the cycle 2 days after 2026-01-01.');
    expect(lines).toContain('Every 9th shift is a Kelly day for the member in that Kelly group.');
  });

  it('describes a longer cycle with runs, no Kelly days and a missing offset', () => {
    const lines = describePattern(
      { ...PATTERN, cycle: ['on', 'on', 'off', 'off', 'off', 'off', 'on', 'on', 'on', 'off', 'off', 'off', 'off', 'off'], shiftHours: 12, kelly: undefined, platoons: { a: 0 } },
      ['a', 'b'],
    );
    expect(lines).toContain('The cycle is 14 days: 2 on, 4 off, 3 on, 5 off.');
    expect(lines).toContain('That averages 30 h per week.');
    expect(lines).toContain('There are no Kelly days.');
    expect(lines).toContain('Shift "b" has no offset yet.');
  });
});
