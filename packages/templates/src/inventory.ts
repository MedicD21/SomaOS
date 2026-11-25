export type ChecklistItemTemplate = { key: string; label: string; kind: 'pass_fail' | 'number' | 'text'; required: boolean };

export type InventoryTemplate = {
  assetTypes: { key: string; label: string; category: 'apparatus' | 'equipment' | 'medical_device' | 'ppe' | 'other' }[];
  /** Fields every asset can carry (entity 'asset' in the custom field registry). */
  assetFields: { key: string; label: string; type: 'text' | 'date'; required: boolean }[];
  checklists: { key: string; label: string; assetTypeKey: string | null; logFailure: boolean; items: ChecklistItemTemplate[] }[];
  items: { sku: string | null; name: string; category: 'medical' | 'station_supply' | 'ppe' | 'other'; unit: string }[];
  stockLocations: { name: string; kind: 'storeroom' }[];
};

const pf = (key: string, label: string, required = true): ChecklistItemTemplate => ({ key, label, kind: 'pass_fail', required });

/**
 * STARTER VALUES ONLY. A generic starting point so a new department sees a working example; every
 * asset type, field, checklist item and supply is editable, and none of it is any department's policy.
 * The Drug Inventory checklist here is a count and seal verification checklist. Controlled-substance
 * custody (witnessed waste, hash-chained ledger, binding blind counts, discrepancies) is the separate
 * custody module (Phase 3b, /custody); at stations with a custody location the count is made there.
 */
export const STARTER_INVENTORY: InventoryTemplate = {
  assetTypes: [
    { key: 'apparatus', label: 'Apparatus (engine, ambulance, ...)', category: 'apparatus' },
    { key: 'cardiac_monitor', label: 'Cardiac monitor', category: 'medical_device' },
    { key: 'cot', label: 'Cot / stretcher', category: 'medical_device' },
    { key: 'ballistic_vest', label: 'Ballistic vest', category: 'ppe' },
    { key: 'turnout_gear', label: 'Turnout gear', category: 'ppe' },
    { key: 'equipment', label: 'Equipment', category: 'equipment' },
  ],
  assetFields: [
    { key: 'serial_number', label: 'Serial number', type: 'text', required: false },
    { key: 'size', label: 'Size', type: 'text', required: false },
    { key: 'issue_date', label: 'Issue date', type: 'date', required: false },
    { key: 'expiration_date', label: 'Expiration date', type: 'date', required: false },
    { key: 'assigned_to', label: 'Assigned to', type: 'text', required: false },
  ],
  checklists: [
    {
      key: 'daily_truck_check',
      label: 'Daily Truck Check',
      assetTypeKey: 'apparatus',
      logFailure: true,
      items: [
        pf('exterior', 'Exterior, tires and lights'),
        pf('fluids', 'Fluids (oil, coolant, washer) and fuel'),
        pf('cab', 'Cab, seat belts and mirrors'),
        pf('radios', 'Radios and mobile data terminal'),
        pf('scba', 'SCBA / air packs present and charged'),
        pf('monitor_o2', 'Cardiac monitor and oxygen present'),
        pf('cot', 'Cot and straps'),
        pf('med_bags', 'Medical bags stocked and sealed'),
        { key: 'odometer', label: 'Odometer reading', kind: 'number', required: false },
        { key: 'notes', label: 'Anything else to report', kind: 'text', required: false },
      ],
    },
    {
      key: 'drug_inventory',
      label: 'Drug Inventory',
      assetTypeKey: null,
      logFailure: true,
      items: [
        pf('seal_intact', 'Drug box seal intact'),
        { key: 'seal_number', label: 'Seal number', kind: 'text', required: true },
        pf('counts_match', 'Counts match the inventory list'),
        pf('expiry_checked', 'Expiration dates checked'),
        { key: 'lines_counted', label: 'Number of line items counted', kind: 'number', required: false },
        { key: 'initials', label: 'Initials', kind: 'text', required: true },
        { key: 'discrepancy_notes', label: 'Discrepancies or notes', kind: 'text', required: false },
      ],
    },
  ],
  items: [
    { sku: null, name: 'Gauze 4x4', category: 'medical', unit: 'pack' },
    { sku: null, name: 'Medical tape 1 in', category: 'medical', unit: 'roll' },
    { sku: null, name: 'Exam gloves, medium', category: 'ppe', unit: 'box' },
    { sku: null, name: 'Oxygen mask, adult', category: 'medical', unit: 'each' },
    { sku: null, name: 'Normal saline 1 L', category: 'medical', unit: 'bag' },
    { sku: null, name: 'Trauma shears', category: 'medical', unit: 'each' },
  ],
  stockLocations: [{ name: 'Main storeroom', kind: 'storeroom' }],
};
