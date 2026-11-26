import 'server-only';
import type { AccrualPolicy, IsoDate } from '@soma/schedule-engine';
import type { Tx } from '@/server/db';
import { approveDraft, listVersions, saveDraft, type VersionRow } from '@/server/versioned-config';

export const POLICY_KIND = 'leave.accrual';

export type PolicyVersion = VersionRow<AccrualPolicy>;

/** Shown to admins who start a policy from scratch; every number is theirs to change. */
export const BLANK_POLICY: AccrualPolicy = {
  period: { kind: 'monthly' },
  tiers: [{ fromYears: 0, earn: { method: 'per_period', hours: 0 } }],
  cap: null,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: null, resetOn: null },
};

export const listPolicyVersions = (tx: Tx, bankKey: string): Promise<PolicyVersion[]> => listVersions<AccrualPolicy>(tx, POLICY_KIND, bankKey);

export const savePolicyDraft = (tx: Tx, bankKey: string, payload: AccrualPolicy): Promise<number> => saveDraft(tx, POLICY_KIND, bankKey, payload);

/**
 * Approves draft `version` from local midnight of `effectiveDate`. Past dates are allowed: the accrual
 * job then posts every completed period since that date (up to two years back).
 */
export const approvePolicyDraft = (tx: Tx, bankKey: string, version: number, effectiveDate: IsoDate, note = ''): Promise<void> =>
  approveDraft(tx, POLICY_KIND, bankKey, version, effectiveDate, `Leave policy ${bankKey} v${version} approved effective ${effectiveDate}.${note}`);
