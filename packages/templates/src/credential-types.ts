import type { DepartmentTemplate } from './types';

const WARN_DAYS = [90, 60, 30, 7];

export const DEFAULT_CREDENTIAL_TYPES: DepartmentTemplate['credentialTypes'] = [
  { key: 'emr', label: 'EMR', validity: { kind: 'fixed_cycle', month: 9, day: 30, years: 2 }, warnDays: WARN_DAYS },
  { key: 'emt', label: 'EMT', validity: { kind: 'fixed_cycle', month: 3, day: 31, years: 2 }, warnDays: WARN_DAYS },
  { key: 'aemt', label: 'AEMT', validity: { kind: 'fixed_cycle', month: 3, day: 31, years: 2 }, warnDays: WARN_DAYS },
  { key: 'paramedic', label: 'Paramedic', validity: { kind: 'fixed_cycle', month: 3, day: 31, years: 2 }, warnDays: WARN_DAYS },
  { key: 'cpr', label: 'CPR', validity: { kind: 'months', months: 24 }, warnDays: WARN_DAYS },
  { key: 'driver_operator', label: 'Driver/Operator', validity: { kind: 'none' }, warnDays: WARN_DAYS },
];
