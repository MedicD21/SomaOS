import type { TrainingWindow } from '@soma/schedule-engine';

export type TrainingTemplate = {
  categories: { key: string; label: string; externalCode: string | null }[];
  courses: { key: string; label: string; categoryKey: string; defaultHours: number; credentialTypeKey: string | null; description: string }[];
  /** Applied from the first day of NEXT year so an unedited example never produces an overdue notice. */
  requirements: { label: string; categoryKey: string; requiredHours: number; window: TrainingWindow }[];
};

/**
 * Starter training data. Everything here is an example to edit: category codes are free text and none of the hour
 * figures is a verified ISO, state or NCCP requirement.
 */
export const STARTER_TRAINING: TrainingTemplate = {
  categories: [
    { key: 'fire', label: 'Fire', externalCode: null },
    { key: 'ems', label: 'EMS', externalCode: null },
    { key: 'hazmat', label: 'Hazmat', externalCode: null },
    { key: 'driver_operator', label: 'Driver/Operator', externalCode: null },
    { key: 'officer', label: 'Officer', externalCode: null },
    { key: 'safety', label: 'Safety', externalCode: null },
    { key: 'policy_other', label: 'Policy and other', externalCode: null },
  ],
  courses: [
    { key: 'company_drill', label: 'Company drill', categoryKey: 'fire', defaultHours: 2, credentialTypeKey: null, description: 'Example: a routine company-level drill.' },
    { key: 'ems_ce', label: 'EMS continuing education', categoryKey: 'ems', defaultHours: 2, credentialTypeKey: null, description: 'Example: a continuing-education session.' },
    { key: 'cpr_renewal', label: 'CPR renewal', categoryKey: 'ems', defaultHours: 4, credentialTypeKey: 'cpr', description: 'Example: renews the CPR credential on completion.' },
    { key: 'hazmat_awareness', label: 'Hazmat awareness', categoryKey: 'hazmat', defaultHours: 8, credentialTypeKey: null, description: 'Example course.' },
    { key: 'driver_refresher', label: 'Driver/Operator refresher', categoryKey: 'driver_operator', defaultHours: 4, credentialTypeKey: null, description: 'Example course.' },
    { key: 'policy_review', label: 'Policy review', categoryKey: 'policy_other', defaultHours: 1, credentialTypeKey: null, description: 'Example: a policy briefing.' },
  ],
  requirements: [
    { label: 'Annual fire training (example: edit the hours)', categoryKey: 'fire', requiredHours: 24, window: { kind: 'calendar_year' } },
    { label: 'Annual EMS continuing education (example: edit the hours)', categoryKey: 'ems', requiredHours: 24, window: { kind: 'calendar_year' } },
  ],
};
