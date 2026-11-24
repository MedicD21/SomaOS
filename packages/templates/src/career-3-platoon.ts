import { DEFAULT_ROLES } from './roles';
import type { DepartmentTemplate } from './types';

export const career3Platoon: DepartmentTemplate = {
  key: 'career-3-platoon',
  label: 'Career — 3 platoon fire/EMS',
  orgUnitTypes: [
    { key: 'division', label: 'Division', sort: 1 },
    { key: 'battalion', label: 'Battalion', sort: 2 },
    { key: 'station', label: 'Station', sort: 3 },
    { key: 'unit', label: 'Unit', sort: 4 },
  ],
  ranks: [
    { key: 'fire_chief', label: 'Fire Chief', sort: 1 },
    { key: 'deputy_chief', label: 'Deputy Chief', sort: 2 },
    { key: 'battalion_chief', label: 'Battalion Chief', sort: 3 },
    { key: 'captain', label: 'Captain', sort: 4 },
    { key: 'lieutenant', label: 'Lieutenant', sort: 5 },
    { key: 'driver_engineer', label: 'Driver/Engineer', sort: 6 },
    { key: 'ff_paramedic', label: 'Firefighter/Paramedic', sort: 7 },
    { key: 'ff_emt', label: 'Firefighter/EMT', sort: 8 },
    { key: 'probationary_ff', label: 'Probationary Firefighter', sort: 9 },
  ],
  shifts: [
    { key: 'a', label: 'A Shift', color: '#dc2626' },
    { key: 'b', label: 'B Shift', color: '#2563eb' },
    { key: 'c', label: 'C Shift', color: '#16a34a' },
  ],
  roles: DEFAULT_ROLES,
  enabledModules: ['admin', 'files'],
};
