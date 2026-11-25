import { STARTER_INVENTORY } from './inventory';
import { DEFAULT_ROLES } from './roles';
import { VOLUNTEER_LEAVE } from './leave';
import { VOLUNTEER_PAY } from './pay';
import { DEFAULT_CREDENTIAL_TYPES } from './credential-types';
import type { DepartmentTemplate } from './types';

export const volunteer: DepartmentTemplate = {
  key: 'volunteer',
  label: 'Volunteer department',
  orgUnitTypes: [
    { key: 'station', label: 'Station', sort: 1 },
    { key: 'unit', label: 'Unit', sort: 2 },
  ],
  ranks: [
    { key: 'chief', label: 'Chief', sort: 1 },
    { key: 'assistant_chief', label: 'Assistant Chief', sort: 2 },
    { key: 'captain', label: 'Captain', sort: 3 },
    { key: 'lieutenant', label: 'Lieutenant', sort: 4 },
    { key: 'firefighter', label: 'Firefighter', sort: 5 },
    { key: 'probationary', label: 'Probationary', sort: 6 },
  ],
  shifts: [],
  roles: DEFAULT_ROLES,
  enabledModules: ['admin', 'files', 'scheduling', 'leave', 'inventory'],
  credentialTypes: DEFAULT_CREDENTIAL_TYPES,
  inventory: STARTER_INVENTORY,
  leave: VOLUNTEER_LEAVE,
  pay: VOLUNTEER_PAY,
  schedulePattern: null,
};
