import 'server-only';
import type { IsoDate, PayRules } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';
import { approveDraft, listVersions, saveDraft, type VersionRow } from '@/server/versioned-config';

export const RULES_KIND = 'pay.rules';

export type RulesVersion = VersionRow<PayRules>;

export const listRuleVersions = (tx: Tx, groupKey: string): Promise<RulesVersion[]> => listVersions<PayRules>(tx, RULES_KIND, groupKey);

export const saveRulesDraft = (tx: Tx, groupKey: string, payload: PayRules): Promise<number> => saveDraft(tx, RULES_KIND, groupKey, payload);

/** Approves a draft from a local date; the previous version is closed at that instant. */
export const approveRulesDraft = (tx: Tx, groupKey: string, version: number, effectiveDate: IsoDate): Promise<void> =>
  approveDraft(tx, RULES_KIND, groupKey, version, effectiveDate, `Pay rules ${groupKey} v${version} approved effective ${effectiveDate}`);

/** A neutral starting point for a group with no rules yet. Edit every number, then approve. */
export const BLANK_RULES: PayRules = {
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
};
