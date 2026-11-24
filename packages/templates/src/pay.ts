import type { PayRules } from '@soma/schedule-engine';
import type { LeaveTemplate } from './leave';

export type PayTemplate = {
  codes: { key: string; label: string; kind: 'regular' | 'overtime' | 'premium' | 'leave' | 'other'; multiplier: number; countsTowardFlsa: boolean; exportCode: string | null }[];
  groups: { key: string; label: string }[];
  /** Applied as DRAFT config versions (kind `pay.rules`, key = group key). */
  rules: { groupKey: string; payload: PayRules }[];
};

/**
 * STARTER VALUES ONLY. The 28-day work period with a 212 h threshold is the usual federal (FLSA 7(k))
 * figure for fire protection, but verify it against your own work-period election and agreement.
 * Rules are created as drafts: nothing is calculated for pay until an administrator edits and approves them.
 */
export function careerPay(leave: LeaveTemplate): PayTemplate {
  return {
    codes: [
      { key: 'reg', label: 'Regular', kind: 'regular', multiplier: 1, countsTowardFlsa: true, exportCode: 'REG' },
      { key: 'ot', label: 'Overtime', kind: 'overtime', multiplier: 1.5, countsTowardFlsa: true, exportCode: 'OT' },
      { key: 'hold', label: 'Holdover', kind: 'premium', multiplier: 1.5, countsTowardFlsa: true, exportCode: 'HOLD' },
      { key: 'call', label: 'Callback', kind: 'premium', multiplier: 1.5, countsTowardFlsa: true, exportCode: 'CALL' },
      { key: 'act', label: 'Acting', kind: 'premium', multiplier: 1, countsTowardFlsa: true, exportCode: 'ACT' },
      // One code per leave type; the code key equals the leave type key.
      ...leave.types.map((t) => ({ key: t.key, label: t.label, kind: 'leave' as const, multiplier: 1, countsTowardFlsa: false, exportCode: t.key.toUpperCase() })),
    ],
    groups: [{ key: 'default', label: 'All members' }],
    rules: [
      {
        groupKey: 'default',
        payload: {
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
            detail: { code: 'reg', multiplier: 1 },
          },
          compTime: { mode: 'never', multiplier: 1.5, bankKey: 'comp_time' },
        },
      },
    ],
  };
}

export const VOLUNTEER_PAY: PayTemplate = { codes: [], groups: [], rules: [] };
