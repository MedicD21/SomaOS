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
