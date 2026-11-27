/**
 * DRAFT — Delaware County EMS (the owner's department), transcribed read-only from Aladtec ("EMS Manager"),
 * NinthBrain, Operative IQ Front Line and the county payroll portal on 2026-11-27. Source notes and open questions:
 * docs/research/06-current-systems.md.
 *
 * This file is deliberately NOT registered in `TEMPLATES`: it names a real department and must never appear in
 * another tenant's template picker. Nothing here is approved. Every value marked `UNVERIFIED` is an inference from
 * what a member account can see, not from the contract or an admin screen, and needs the owner's sign-off.
 * No member names, pay rates, balances or other personal data are recorded here.
 */
import type { AccrualPolicy } from '@soma/schedule-engine';
import type { ChecklistItemTemplate, InventoryTemplate } from '../inventory';
import type { LeaveTemplate } from '../leave';
import type { PayTemplate } from '../pay';
import type { DocumentsTemplate } from '../documents';
import type { TrainingTemplate } from '../training';
import type { DepartmentTemplate } from '../types';
import { DEFAULT_ROLES } from '../roles';
import { STARTER_DOCUMENTS } from '../documents';

/** Pay periods are 14 days and start Saturday 06:00 (Aladtec payroll verification: Nov 7, Nov 21, Dec 5 2026). */
const PAY_PERIOD_ANCHOR = '2026-11-07';

const WARN_DAYS = [90, 60, 30, 7];

/** NinthBrain "Required Credentials" for the Lieutenant position; validity read from issue/expiry pairs. */
export const DELCO_CREDENTIAL_TYPES: DepartmentTemplate['credentialTypes'] = [
  // NREMT cycles end 31 March every 2 years.
  { key: 'nremt_paramedic', label: 'NREMT - Paramedic', validity: { kind: 'fixed_cycle', month: 3, day: 31, years: 2 }, warnDays: WARN_DAYS },
  // CBA 8.10 requires Ohio EMT, AEMT or Paramedic certification, BLS and an Ohio driver's license.
  // Ohio certificate observed as issue + 3 years - 1 day; `months: 36` lands one day late. UNVERIFIED for EMT/AEMT.
  { key: 'ohio_paramedic', label: 'Ohio: Paramedic', validity: { kind: 'months', months: 36 }, warnDays: WARN_DAYS },
  { key: 'ohio_aemt', label: 'Ohio: Advanced EMT', validity: { kind: 'months', months: 36 }, warnDays: WARN_DAYS },
  { key: 'ohio_emt', label: 'Ohio: EMT', validity: { kind: 'months', months: 36 }, warnDays: WARN_DAYS },
  // CBA 26.9(2): $360 a year for each of these. Validity UNVERIFIED.
  { key: 'critical_care', label: 'Critical Care Certification', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'fp_c', label: 'FP-C Certification', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  // RQI cards observed expiring at the end of the month ~24 months out. UNVERIFIED (RQI itself is quarterly).
  { key: 'acls_rqi', label: 'ACLS RQI', validity: { kind: 'months', months: 24 }, warnDays: WARN_DAYS },
  { key: 'bls_rqi', label: 'BLS RQI', validity: { kind: 'months', months: 24 }, warnDays: WARN_DAYS },
  { key: 'pals_rqi', label: 'PALS RQI', validity: { kind: 'months', months: 24 }, warnDays: WARN_DAYS },
  { key: 'itls_phtls_btls', label: 'ITLS/PHTLS/BTLS', validity: { kind: 'months', months: 36 }, warnDays: WARN_DAYS },
  { key: 'pals_pepp_epc', label: 'PALS/PEPP/EPC', validity: { kind: 'months', months: 48 }, warnDays: WARN_DAYS },
  { key: 'evoc', label: 'EVOC (Emergency Vehicle Operator Course)', validity: { kind: 'months', months: 12 }, warnDays: WARN_DAYS },
  { key: 'hazmat_fra', label: 'HazMat First Responder Awareness', validity: { kind: 'months', months: 12 }, warnDays: WARN_DAYS },
  { key: 'handtevy', label: 'Handtevy', validity: { kind: 'months', months: 24 }, warnDays: WARN_DAYS },
  { key: 'drivers_license', label: "Driver's License - State", validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'cads', label: 'Certified Ambulance Documentation Specialist (CADS)', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'death_notification', label: 'Death Notification', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'nims_100', label: 'IS/ICS/NIMS-100', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'nims_200', label: 'IS/ICS/NIMS-200', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'nims_700', label: 'IS/ICS/NIMS-700', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'nims_800', label: 'IS/ICS/NIMS-800', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  // Seen with an expiry on one record and none on others. UNVERIFIED.
  { key: 'rescue_task_force', label: 'Rescue Task Force Awareness', validity: { kind: 'none' }, warnDays: WARN_DAYS },
  { key: 'dementia_training', label: 'Dementia Training for Ohio EMS', validity: { kind: 'none' }, warnDays: WARN_DAYS },
];

/**
 * Aladtec time-off types (38, in Aladtec's order) mapped to the banks the county payroll portal tracks:
 * Vacation, Sick Leave, Personal Leave, Military Leave, Comp. Time (plus FMLA, tracked as a balance there).
 * `countsAsWorked` follows the CBA (2023-2026): sick (20.1), funeral (20.2, charged to sick) and vacation (22.3)
 * count toward overtime, but ONLY the built-in overtime of the regular schedule; personal (20.5), comp used (21.2)
 * and jury duty (20.3) do not. The engine has no "scheduled overtime only" flag, so `true` over-counts when the
 * member also works extra hours that week (research 06 §5).
 */
const lt = (key: string, label: string, bankKey: string | null, requiresDocumentation = false, countsAsWorked = false): LeaveTemplate['types'][number] => ({
  key, label, bankKey, leadTimeDays: 0, requiresDocumentation, countsAsWorked,
});

const accrualBase: Omit<AccrualPolicy, 'tiers'> = {
  period: { kind: 'fixed_days', days: 14, anchor: PAY_PERIOD_ANCHOR },
  cap: null,
  waitingPeriodDays: 0,
  prorateFirstPeriod: false,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: null, resetOn: null },
};

export const DELCO_LEAVE: LeaveTemplate = {
  banks: [
    { key: 'vacation', label: 'Vacation' },
    { key: 'sick', label: 'Sick leave' },
    { key: 'personal', label: 'Personal leave' },
    { key: 'comp_time', label: 'Compensatory time' },
    { key: 'military', label: 'Military leave' },
  ],
  types: [
    lt('sick', 'Sick Leave', 'sick', false, true),
    lt('sick_admin_use', 'Sick Leave - Administrative Use', 'sick'),
    lt('personal', 'Personal Leave', 'personal'),
    lt('vacation', 'Vacation Leave', 'vacation', false, true),
    lt('comp_time', 'Compensatory Leave', 'comp_time'),
    lt('dtu_mtu', 'DTU / MTU Leave', null),
    lt('training', 'Training Leave', null),
    lt('instructor', 'Instructor Leave', null),
    lt('peer_support', 'Peer Support Leave', null),
    lt('union', 'Union Leave', null),
    lt('lwop', 'Leave Without Pay', null),
    lt('military', 'Military Leave', 'military', true),
    lt('jury_duty', 'Jury Duty', null, true),
    lt('court', 'Court Leave', null, true),
    // CBA 20.2: up to two 24 h tours, deducted from sick leave.
    lt('funeral', 'Funeral Leave', 'sick', false, true),
    lt('awol', 'Absence Without Leave (AWOL)', null),
    lt('dmat', 'DMAT', null),
    lt('holiday_paid', 'Holiday Paid', null),
    lt('unexcused', 'Unexcused', null),
    lt('admin_leave', 'Admin Leave', null),
    lt('honor_guard', 'Honor Guard', null),
    lt('fmla', 'FMLA', null, true),
    lt('fmla_sick', 'FMLA - Sick', 'sick', true, true),
    lt('fmla_vacation', 'FMLA - Vacation', 'vacation', true, true),
    lt('fmla_comp', 'FMLA - Comp', 'comp_time', true),
    lt('fmla_lwop', 'FMLA - LWOP', null, true),
    lt('tardy', 'Tardy', null),
    lt('holiday_comped', 'Holiday Comped', null),
    lt('unpaid_admin', 'Unpaid Admin Leave', null),
    lt('unpaid_military', 'Unpaid Military', null, true),
    lt('holiday_nw_comped_captain', 'Holiday not Worked Comped Captain', null),
    lt('holiday_nw_paid_captain', 'Holiday not Worked Paid Captain', null),
    lt('ohio_task_force_one', 'Ohio Task Force One', null),
    lt('admin_covid', 'Admin Leave - Covid', null),
    lt('instructor_sce', 'Instructor SCE Leave', null),
    lt('teaching_non_union', 'Teaching Leave Non-Union', null),
    lt('admin', 'Admin', null),
    lt('other', 'Other', null),
  ],
  policies: [
    // CBA 22.1 (24/48 employees): annual 120 h (1-7 yrs), 168 h (8-14), 216 h (15-24), 264 h (25+), pro rata over
    // 26 bi-weekly pays (payroll posts 6.46 h a pay for the 168 h tier). Nothing accrues per pay in year one: "two
    // weeks" are earned on completing the first year, which the engine cannot grant (research 06 §5). Carryover is
    // "three years with the Director's approval", also not expressible; no cap is set.
    {
      bankKey: 'vacation',
      payload: {
        ...accrualBase,
        tiers: [
          { fromYears: 0, earn: { method: 'per_period', hours: 0 } },
          { fromYears: 1, earn: { method: 'per_period', hours: 4.62 } },
          { fromYears: 8, earn: { method: 'per_period', hours: 6.46 } },
          { fromYears: 15, earn: { method: 'per_period', hours: 8.31 } },
          { fromYears: 25, earn: { method: 'per_period', hours: 10.15 } },
        ],
      },
    },
    // CBA 20.1: 0.0656 h for each hour of regular work, accumulated without limit.
    { bankKey: 'sick', payload: { ...accrualBase, tiers: [{ fromYears: 0, earn: { method: 'per_hours_worked', perHours: 1, earnHours: 0.0656 } }] } },
    // CBA 20.5: personal leave "up to two times each year", in increments of at least 2 h, no carryover into the next
    // calendar year. Payroll grants 48 h (two 24 h tours); the two-uses limit is not expressible (research 06 §5).
    {
      bankKey: 'personal',
      payload: { ...accrualBase, tiers: [{ fromYears: 0, earn: { method: 'annual_front_load', hours: 48 } }], carryover: { max: 0, resetOn: '01-01' } },
    },
    // CBA 21.2: comp accrues 1:1 in lieu of overtime pay, capped at 160 h, used within 180 days, and is paid at 1.5x
    // when used. The 180-day use-by and the 1.5x-on-use are not expressible (research 06 §5).
    { bankKey: 'comp_time', payload: { ...accrualBase, tiers: [{ fromYears: 0, earn: { method: 'manual' } }], cap: 160 } },
    // CBA 19.3: military leave follows federal and state law.
    { bankKey: 'military', payload: { ...accrualBase, tiers: [{ fromYears: 0, earn: { method: 'manual' } }] } },
  ],
};

/**
 * Leave types a crew member (Lieutenant and below) may request themselves. The rest are entered by officers or
 * admin (discipline, admin and captain-only codes). The proposal for the owner's review; the leave module has no
 * per-type visibility yet (research 06 §5).
 */
export const DELCO_CREW_LEAVE_KEYS = [
  'sick', 'personal', 'vacation', 'comp_time', 'funeral', 'jury_duty', 'court', 'military', 'unpaid_military',
  'fmla', 'fmla_sick', 'fmla_vacation', 'fmla_comp', 'fmla_lwop', 'lwop', 'holiday_paid', 'holiday_comped',
  'training', 'instructor', 'instructor_sce', 'peer_support', 'union', 'honor_guard', 'dmat', 'ohio_task_force_one',
] as const;

/**
 * County holiday schedule 2027 (HR PDF) and CBA 23.1/23.2. Eight-hour holidays pay 8 h straight time or bank
 * 5.34 h comp; the starred four-hour holidays pay 4 h or bank 2.67 h (comp is later paid at 1.5x). `observed` is the
 * county date when the actual date falls on a weekend. Captains (outside the CBA) follow the same list, per the owner.
 */
export const DELCO_HOLIDAYS_2027: { name: string; actual: string; observed: string; hours: 8 | 4 }[] = [
  { name: "New Year's Day", actual: '2027-01-01', observed: '2027-01-01', hours: 8 },
  { name: 'Martin Luther King Day', actual: '2027-01-18', observed: '2027-01-18', hours: 8 },
  { name: "President's Day", actual: '2027-02-15', observed: '2027-02-15', hours: 8 },
  { name: 'Memorial Day', actual: '2027-05-31', observed: '2027-05-31', hours: 8 },
  { name: 'Juneteenth', actual: '2027-06-19', observed: '2027-06-18', hours: 8 },
  { name: 'Independence Day', actual: '2027-07-04', observed: '2027-07-05', hours: 8 },
  { name: 'Labor Day', actual: '2027-09-06', observed: '2027-09-06', hours: 8 },
  { name: 'Little Brown Jug Day', actual: '2027-09-23', observed: '2027-09-23', hours: 4 },
  { name: 'Veterans Day', actual: '2027-11-11', observed: '2027-11-11', hours: 8 },
  { name: 'Thanksgiving Day', actual: '2027-11-25', observed: '2027-11-25', hours: 8 },
  { name: 'Day after Thanksgiving', actual: '2027-11-26', observed: '2027-11-26', hours: 8 },
  { name: 'Christmas Eve', actual: '2027-12-24', observed: '2027-12-23', hours: 4 },
  { name: 'Christmas Day', actual: '2027-12-25', observed: '2027-12-24', hours: 8 },
];

/**
 * County payroll export codes seen on a member's stub and leave ledger, with the owner's reading of them. Partial
 * list: the owner is getting the full code list from payroll. EMSST = sick taken at straight time; EMSVTOVT =
 * vacation taken, overtime portion; EMSSTKNO / STKNOVT unclear (STKNOVT may be FMLA); CPO 120P = elected comp payout.
 */
const LEAVE_EXPORT: Record<string, string> = {
  vacation: 'EMS VTKN',
  sick: 'EMSST',
  personal: 'EMSPERS',
  comp_time: 'EMS CTKN',
  holiday_paid: 'EMSHOLPD',
};

export const DELCO_PAY: PayTemplate = {
  codes: [
    { key: 'reg', label: 'Regular (EMS SREG)', kind: 'regular', multiplier: 1, countsTowardFlsa: true, exportCode: 'EMS SREG' },
    { key: 'ot', label: 'Overtime (EMS SOT)', kind: 'overtime', multiplier: 1.5, countsTowardFlsa: true, exportCode: 'EMS SOT' },
    // CBA 26.6: a Paramedic acting as Lieutenant for 6+ consecutive hours earns +$2.00/h. The engine has no flat
    // hourly adders (also FTO +$2, SCE +$1.50, instructor +$3), so this code carries no premium yet.
    { key: 'act', label: 'Out-of-class (Acting Lieutenant)', kind: 'premium', multiplier: 1, countsTowardFlsa: true, exportCode: null },
    ...DELCO_LEAVE.types.map((t) => ({
      key: t.key, label: t.label, kind: 'leave' as const, multiplier: 1, countsTowardFlsa: false, exportCode: LEAVE_EXPORT[t.key] ?? null,
    })),
  ],
  // Aladtec work groups / pay classes: 300 FTPM Medic, 320 PTIN, 330 FTPM Captains. Rules exist only for 300, the
  // bargaining unit (full-time EMT, AEMT, Paramedic, Lieutenant). Captains and above are outside the CBA.
  groups: [
    { key: 'pc300_ftpm_medic', label: '300 (FTPM Medic)' },
    { key: 'pc320_ptin', label: '320 (PTIN)' },
    { key: 'pc330_ftpm_captains', label: '330 (FTPM Captains)' },
  ],
  rules: [
    {
      groupKey: 'pc300_ftpm_medic',
      payload: {
        payPeriod: { kind: 'fixed_days', days: 14, anchor: PAY_PERIOD_ANCHOR },
        // Overtime is paid for hours over 40 in a week (owner). On 24/48 that is built-in overtime of 8 h in 48 h
        // weeks and 32 h in 72 h weeks (CBA 20.1, 22.3), giving "long" (5-shift) and "short" (4-shift) pays.
        // Weeks are assumed to start with the pay period, Saturday. UNVERIFIED week boundary.
        workPeriod: { days: 7, anchor: PAY_PERIOD_ANCHOR, threshold: 40, multiplier: 1.5, code: 'ot' },
        overtimeCombination: 'highest',
        // Extra and held-over hours are straight time until the weekly threshold makes them overtime.
        assignments: {
          regular: { code: 'reg', multiplier: 1 },
          overtime: { code: 'reg', multiplier: 1 },
          // CBA 21.5: hours worked on a trade are not hours worked for overtime.
          trade: { code: 'reg', multiplier: 1, countsTowardFlsa: false },
          holdover: { code: 'reg', multiplier: 1 },
          // CBA 21.3: a call-back not abutting the shift is paid at least 2 h.
          callback: { code: 'reg', multiplier: 1, minimumHours: 2 },
          acting: { code: 'act', multiplier: 1 },
          training: { code: 'reg', multiplier: 1 },
          detail: { code: 'reg', multiplier: 1 },
        },
        // CBA 21.2: members elect comp in lieu of overtime pay; it accrues 1:1 (paid at 1.5x when used).
        compTime: { mode: 'member_choice', multiplier: 1, bankKey: 'comp_time' },
      },
    },
  ],
};

const pf = (key: string, label: string, required = true): ChecklistItemTemplate => ({ key, label, kind: 'pass_fail', required });
const num = (key: string, label: string, required = true): ChecklistItemTemplate => ({ key, label, kind: 'number', required });
const txt = (key: string, label: string, required = true): ChecklistItemTemplate => ({ key, label, kind: 'text', required });

/** Front Line part codes and PAR seen in the Medic 8 (2024 Frazer) cabinets. `unit` is Front Line's unit of issue. */
const item = (sku: string | null, name: string, unit = 'each'): InventoryTemplate['items'][number] => ({ sku, name, category: 'medical', unit });

export const DELCO_INVENTORY: InventoryTemplate = {
  // Operative IQ unit types (vehicles) and asset classes (equipment), from the back office.
  assetTypes: [
    { key: 'ambulance_diesel', label: 'Ambulance - Diesel', category: 'apparatus' },
    { key: 'ambulance_gas', label: 'Ambulance - Gas', category: 'apparatus' },
    { key: 'ambulance_stocked_spare', label: 'Ambulance - Stocked Spare', category: 'apparatus' },
    { key: 'captain_vehicle', label: 'Captain vehicle (Captain 461/462)', category: 'apparatus' },
    { key: 'chief_vehicle', label: 'Chief vehicle (Chief 460/461/462)', category: 'apparatus' },
    { key: 'ems_support_vehicle', label: 'EMS support vehicle (EMS 461/462)', category: 'apparatus' },
    { key: 'f250', label: 'F250', category: 'apparatus' },
    { key: 'kubota', label: 'Kubota (UTV)', category: 'apparatus' },
    { key: 'malibu', label: 'Malibu (staff car)', category: 'apparatus' },
    { key: 'minivan', label: 'Minivan', category: 'apparatus' },
    { key: 'mci_trailer', label: 'MCI Trailer', category: 'apparatus' },
    { key: 'utility', label: 'Utility', category: 'apparatus' },
    { key: 'cardiac_equipment', label: 'Cardiac Equipment (Zoll Zenix, AutoPulse)', category: 'medical_device' },
    { key: 'patient_movement', label: 'Patient Movement (devices for packaging and moving patients)', category: 'medical_device' },
    { key: 'truck_medical_equipment', label: 'Truck Medical Equipment', category: 'medical_device' },
    { key: 'truck_equipment', label: 'Truck Equipment, not medical (Cradlepoint, cooler, radio)', category: 'equipment' },
    { key: 'station_equipment', label: 'Station Equipment', category: 'equipment' },
    { key: 'employee_gear', label: 'Employee Gear (rescue gear, vests, RTF helmets)', category: 'ppe' },
    { key: 'fit_testing', label: 'Fit Testing Equipment', category: 'equipment' },
    { key: 'training_equipment', label: 'Training Equipment', category: 'equipment' },
    { key: 'logistics_equipment', label: 'Logistics Equipment', category: 'equipment' },
  ],
  assetFields: [
    { key: 'unit_letter', label: 'Fleet letter (e.g. Letter, F, Q)', type: 'text', required: false },
    { key: 'model_year_make', label: 'Year and make (e.g. 2024 Frazer)', type: 'text', required: false },
    { key: 'service_status', label: 'Status (In-Service / Reserve)', type: 'text', required: false },
    { key: 'serial_number', label: 'Serial number', type: 'text', required: false },
  ],
  checklists: [
    {
      // Front Line "Daily Vehicle Driver Inspection (Gas)", occurs every day. Multiple-choice answers are flattened to
      // pass/fail with the passing answers in the label (the checklist engine has no multiple-choice item).
      key: 'daily_vehicle_driver_inspection',
      label: 'Daily Vehicle Driver Inspection',
      assetTypeKey: 'ambulance_gas',
      logFailure: true,
      items: [
        pf('crewforce_sign', 'Signed out/in on CrewForce'),
        num('mileage', 'Mileage'),
        pf('fuel_level', 'Fuel level Full or 3/4 (1/2: refuel; under 1/2: refuel and notify Captain)'),
        pf('voltage', 'Voltage checked'),
        pf('horn_siren', 'Horn / siren operational'),
        pf('emergency_lights', 'Emergency / scene lights operational'),
        pf('headlights', 'Headlights and high beams operational'),
        pf('oil', 'Oil level full (note quarts added)'),
        pf('transmission', 'Transmission fluid full (or sealed system)'),
        pf('coolant', 'Antifreeze / radiator fluid level full'),
        pf('tires', 'Tire pressure / condition pass'),
        pf('shoreline', 'Shoreline connection operational'),
        pf('no_new_damage', 'No new paint / body damage'),
        pf('seat_belts', 'Seat belts operational'),
        pf('rear_camera', 'Rear camera operational'),
        pf('hvac', 'Front/rear air conditioner and heater operational'),
        pf('extinguishers', 'Extinguishers (2): powder rotated x3 during monthly check', false),
        pf('dc_fuel_card', 'Drivers compartment: fuel card'),
        pf('dc_ipad', 'Drivers compartment: iPad with charger'),
        pf('dc_gloves', 'Drivers compartment: gloves S, M, L, XL'),
        num('oc_main_o2', 'Outside compartments: main oxygen reading'),
        pf('oc_autopulse', 'Outside compartments: AutoPulse'),
        pf('oc_autopulse_battery', 'Outside compartments: AutoPulse battery changed'),
        pf('oc_pedi_vacuum_mattress', 'Outside compartments: pedi full body vacuum mattress / pump'),
        pf('oc_pfds', "Outside compartments: 3 PFD's (2 for Medic 2 and 11)"),
        pf('oc_binder_lift', 'Outside compartments: binder lift, regular and XL'),
        pf('oc_c_collar_bag', 'Outside compartments: cervical collar bag'),
        pf('oc_reeves', "Outside compartments: Reeve's sleeve"),
        pf('oc_adult_vacuum_mattress', 'Outside compartments: adult full body vacuum mattress / pump'),
        pf('oc_vacuum_splints', 'Outside compartments: vacuum splints (ankle/wrist, arm, leg)'),
        pf('oc_stair_chair', 'Outside compartments: transport / mega mover chair'),
        pf('oc_fire_rehab_bag', 'Outside compartments: fire rehab bag'),
        pf('oc_backboards', 'Outside compartments: 2 backboards with straps'),
        txt('other_notes', 'Other notable items not listed above', false),
      ],
    },
    {
      // Front Line "Daily PRIMARY Rear Check", occurs every day. Seal numbers here are a check, not custody:
      // the custody module owns controlled-substance counts.
      key: 'daily_primary_rear_check',
      label: 'Daily PRIMARY Rear Check',
      assetTypeKey: null,
      logFailure: true,
      items: [
        pf('crewforce_sign', 'Signed out/in on CrewForce'),
        txt('cooler_seal', 'Cooler seal number'),
        txt('drug_drawer_seal', 'Drug drawer seal number'),
        txt('narcotic_kit_seal', 'Narcotic kit seal number'),
        txt('med_pouch_seal', 'Bag medication pouch seal number'),
        num('temp_stick_reading', 'Last TEMP Stick temperature (cooler and drawer)'),
        num('temp_stick_battery', 'TEMP Stick battery % (cooler and drawer)'),
        pf('compartment_secured', 'Items secured in patient compartment'),
        pf('ipad', 'iPad with charger', false),
        pf('cot', 'Inspect cot'),
        pf('lma_all_sizes', 'LMA - 1 each, all sizes'),
        pf('o2_bottles', '3 O2 bottles with regulators (bag, wall, cot or cabinet)'),
        pf('adult_bvm_cabinet', 'Adult BVM - airway cabinet (1)'),
        pf('adult_o2_supplies', 'Adult oxygen supplies'),
        pf('monitor', 'Monitor and equipment'),
        pf('zoll_spare_battery', 'Zoll monitor spare battery'),
        pf('bandages', 'Bandages / dressings'),
        pf('manual_bp', 'Manual BP cuffs'),
        pf('warming_blankets', 'Quick warming blankets'),
        pf('ob_kits', 'OB kits (2)'),
        pf('doppler', 'Doppler'),
        pf('suction', 'Portable / on board suction'),
        pf('stethoscopes', 'Stethoscopes'),
        pf('cleaning', 'Cleaning supplies'),
        pf('pedimate', 'Pedimate restraint system'),
        pf('isolation', 'Isolation / bed bug supplies'),
        pf('linens', 'Linens'),
        pf('box_light', 'Box light'),
        pf('gloves', 'Gloves - all sizes'),
        pf('biohazard_bags', 'Biohazard bags'),
        pf('fib_sharps', 'First In Bag: small sharps'),
        pf('fib_bvm', 'First In Bag: adult BVM'),
        pf('fib_bp', 'First In Bag: manual BP cuff'),
        pf('fib_stethoscope', 'First In Bag: stethoscope'),
        pf('fib_glucometer', 'First In Bag: glucometer'),
        pf('fib_thermometer', 'First In Bag: Adtemp thermometer'),
        pf('fib_trauma', 'First In Bag: trauma supplies (4x4, 5x9, coban, gauze, SAM splint)'),
        pf('fib_tourniquet', 'First In Bag: CAT tourniquet'),
        pf('ab_o2_bottle', 'Airway Bag: aluminum O2 bottle'),
        num('ab_o2_level', 'Airway Bag: oxygen level'),
        pf('ab_bvm', 'Airway Bag: adult BVM'),
        pf('ab_cpap_medium', 'Airway Bag: complete CPAP and medium mask'),
        pf('ab_cpap_large', 'Airway Bag: CPAP large mask'),
        pf('ab_airq', 'Airway Bag: AirQ 3, 4, 5'),
        pf('ab_glidescope', 'Airway Bag: Glidescope GO'),
        num('ab_glidescope_battery', 'Airway Bag: Glidescope battery level'),
        pf('ab_glidescope_stylet', 'Airway Bag: Glidescope stylet'),
        pf('ab_glidescope_lopro', 'Airway Bag: Glidescope LoPro S3, S4'),
        pf('ab_glidescope_mac', 'Airway Bag: Glidescope Mac S3, S4'),
        pf('ab_intubation', 'Airway Bag: intubation supplies'),
        pf('ab_et_tubes', 'Airway Bag: ET tubes 6.0 to 8.5'),
        pf('ab_lube', 'Airway Bag: 8 lube'),
        pf('ab_npa', "Airway Bag: NPA's 22-36 Fr"),
        pf('ab_opa', "Airway Bag: OPA's 70-110 mm"),
        pf('ab_cric', 'Airway Bag: cric supplies (scalpels, bougie, 3 ml chloraprep)'),
        pf('ab_o2_supplies', 'Airway Bag: adult O2 supplies (NC, NRB, neb, neb with mask)'),
        txt('variances', 'Please explain any variances', false),
      ],
    },
  ],
  // A representative subset of Front Line part codes (Medic 8 cabinets A, C, D, IV, syringes). PAR per cabinet
  // is recorded in docs/research/06-current-systems.md; the item schema has no cabinet/PAR field.
  items: [
    item('C70', 'N95, duckbill with faceshield'),
    item('J34', 'Surgical face mask with ear loop', 'box'),
    item('J18', 'Safety glasses, clear'),
    item('C20', 'Magill forceps, adult, large'),
    item('F14', 'Magill forceps, child, small'),
    item('E51', 'Doppler, Edan Sonotrax Lite, 8 MHz probe'),
    item('C53a', 'Saline bullets, suction'),
    item('C61a', 'Suction catheter kit 16 Fr with sterile gloves'),
    item('D03', 'Nasal cannula, adult'),
    item('D02', 'Zenix ETCO2 adult nasal capnocannula'),
    item('D04', 'Non-rebreather, adult'),
    item('D11', 'Nebulizer, adult, no mask'),
    item('D30', 'CPAP with neb-connect kit, medium mask'),
    item('D40', 'Adult BVM with manometer, PEEP and HEPA filter'),
    item('C01', 'NPA 22 Fr'),
    item('C10', 'Lubricating jelly 2.7 g'),
    item('C14', 'Air-Q SP3G LMA size 4'),
    item('C32', 'ET tube 7.0 cuffed with stylet'),
    item('C27', 'Bougie, adult'),
    item('D42', 'HEPA filter'),
    item('A60', 'Combat Application Tourniquet'),
    item('A02', 'Gauze 4x4'),
    item('A03', 'Gauze 5x9'),
    item('A31', 'Tape 1 in'),
    item('A43', 'Quick warming blanket'),
    item('F65', 'OB kit, boxed, with scissors'),
    item('B10', 'IV catheter'),
    item('B03', 'Saline flush'),
    item('B20', 'Saline 500 ml'),
    item('B44', 'BD IO needle 25 mm (blue)'),
    item('B45', 'BD IO needle 45 mm (yellow)'),
    item('B34', 'Syringe 10 ml'),
    item('B42', 'Security seals'),
    item('E41', 'EKG electrode'),
    item('E34', 'Zenix CPR pads, adult'),
    item('F51', 'Zenix CPR pads, pediatric'),
  ],
  // Operative IQ supply rooms. Station medical cabinets serve two groups of medics: (1, 2, 3, 6, 7, 11) and
  // (4, 5, 8, 9, 10). Medication cabinets (UcapIt machines) belong to the custody module, not here.
  stockLocations: [
    'Medical Supplies - Main Supply',
    'Cleaning/Station Supplies - Main Supply',
    'DCEMS Misc. Supplies',
    'Employee Gear',
    'Class A and B Uniforms',
    'PR Event Supplies',
    'Training Supplies',
    'Truck Equipment',
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].flatMap((n) => [
      `Station ${n} - Medical Equipment Supply Cabinet (${[4, 5, 8, 9, 10].includes(n) ? '4, 5, 8, 9, 10' : '1, 2, 3, 6, 7, 11'})`,
      `Station ${n} - Station/Cleaning/Truck Supplies`,
    ]),
  ].map((name) => ({ name, kind: 'storeroom' as const })),
};

/** NinthBrain course catalog categories (these mirror NREMT NCCP topic areas; codes not confirmed). */
export const DELCO_TRAINING: TrainingTemplate = {
  categories: [
    { key: 'arv', label: 'Airway, Respiration & Ventilation (ARV)', externalCode: null },
    { key: 'cardiology', label: 'Cardiology', externalCode: null },
    { key: 'trauma', label: 'Trauma', externalCode: null },
    { key: 'medical', label: 'Medical', externalCode: null },
    { key: 'operations', label: 'Operations', externalCode: null },
    { key: 'pediatric', label: 'Pediatric', externalCode: null },
    { key: 'geriatrics', label: 'Geriatrics', externalCode: null },
    { key: 'special_considerations', label: 'Special Considerations', externalCode: null },
    { key: 'cism', label: 'CISM', externalCode: null },
    { key: 'instructor', label: 'Instructor', externalCode: null },
  ],
  // Recurring program shapes seen in the catalog and calendar. Hours are not published to members: 0 = set per session.
  courses: [
    { key: 'core_competency', label: 'Core Competency Process (annual)', categoryKey: 'operations', defaultHours: 0, credentialTypeKey: null, description: 'Yearly core comps; 2026 topics: adult poisoning, difficult airway, geriatric injury, operations/HIPAA, pediatric seizures.' },
    { key: 'sim_lab', label: 'Quarterly Sim Lab', categoryKey: 'medical', defaultHours: 0, credentialTypeKey: null, description: 'Quarterly simulation lab (e.g. neonate resuscitation, post-partum hemorrhage).' },
    { key: 'protocol_exam', label: 'Protocol Exam', categoryKey: 'medical', defaultHours: 0, credentialTypeKey: null, description: 'Written protocol exam: annual under CBA 26.5 (remediation, then FTO time, then possible de-credentialing), assigned quarterly in practice.' },
    { key: 'physical_abilities_test', label: 'Physical Abilities Test (PAT)', categoryKey: 'operations', defaultHours: 0, credentialTypeKey: null, description: 'Annual third-party PAT (CBA 26.5); failure leads to remediation and a retest within 6 months.' },
    { key: 'sce_session', label: 'Shift Clinical Educator (SCE) session', categoryKey: 'medical', defaultHours: 0, credentialTypeKey: null, description: 'On-duty topic delivered by an SCE to listed units across several shift days (e.g. Environmental Emergencies - M3, M10).' },
    { key: 'medical_director_zoom', label: 'Medical Director Zoom', categoryKey: 'medical', defaultHours: 1, credentialTypeKey: null, description: 'Monthly medical director session.' },
    { key: 'handtevy', label: 'Handtevy', categoryKey: 'pediatric', defaultHours: 0, credentialTypeKey: 'handtevy', description: 'Renews the Handtevy credential.' },
    { key: 'zoll_equipment', label: 'Zoll Zenix / NXT / AutoPulse training', categoryKey: 'operations', defaultHours: 0, credentialTypeKey: null, description: 'Equipment training.' },
  ],
  // No hour requirements are visible to a member. Left empty rather than invented.
  requirements: [],
};

/** NinthBrain File Cabinet top level, plus the existing starter forms and one county form. */
export const DELCO_DOCUMENTS: DocumentsTemplate = {
  folders: [
    { name: 'SOGs', viewPermission: null },
    { name: 'Memos', viewPermission: null },
    { name: 'Forms', viewPermission: null },
    { name: 'Training', viewPermission: null },
    { name: 'Infection Control', viewPermission: null },
    { name: 'Mental Health Resources', viewPermission: null },
    { name: 'Fitness and Nutrition', viewPermission: null },
    { name: 'Collective Bargaining Agreement', viewPermission: null },
    { name: 'Meeting Notes', viewPermission: null },
    { name: 'Human Resources', viewPermission: 'admin.members.manage' },
  ],
  forms: [
    ...STARTER_DOCUMENTS.forms,
    {
      // Aladtec form "Compensatory Time Earned Payout Request"; payroll fills the amounts.
      key: 'comp_time_payout_request',
      label: 'Compensatory Time Payout Request',
      description: 'Ask payroll to pay out hours from your comp bank. Payroll computes the amount at the overtime rate.',
      requiresSignature: true,
      signatureStatement: 'I request payout of the compensatory hours listed and confirm the details are correct.',
      approval: 'officer',
      fields: [
        { key: 'hours_to_payout', label: 'Hours to pay out', type: 'number', required: true },
        { key: 'date_of_request', label: 'Date of request', type: 'date', required: true },
        { key: 'payout_date', label: 'Requested payout date', type: 'date', required: true },
      ],
    },
  ],
};

export const delcoEmsDraft: DepartmentTemplate = {
  key: 'delco-ems-draft',
  label: 'Delaware County EMS (DRAFT, not for other tenants)',
  orgUnitTypes: [
    { key: 'division', label: 'Division', sort: 1 },
    { key: 'station', label: 'Station', sort: 2 },
    { key: 'unit', label: 'Unit', sort: 3 },
  ],
  // Rank order from the owner and NEOGOV. Admin titles are positions held at a rank: Assistant Chief of
  // Administration / of Operations; Captain of Clinical Quality & Compliance, Training Captain, Captain of
  // Education & Development (admin captains) vs the six shift Captains. FTO and SCE are assignments below Lieutenant.
  ranks: [
    { key: 'chief', label: 'Chief (Director of Emergency Services)', sort: 1 },
    { key: 'asst_chief', label: 'Assistant Chief', sort: 2 },
    { key: 'captain', label: 'Captain', sort: 3 },
    { key: 'lieutenant', label: 'Lieutenant', sort: 4 },
    { key: 'paramedic', label: 'Paramedic', sort: 5 },
    { key: 'aemt', label: 'AEMT', sort: 6 },
    { key: 'emt', label: 'EMT', sort: 7 },
  ],
  // Aladtec "Duty Day": Unit 1, Unit 2, Unit 3 (also "40 hrs" and "Part-Time", which are not platoons).
  shifts: [
    { key: 'unit_1', label: '1 Unit', color: '#dc2626' },
    { key: 'unit_2', label: '2 Unit', color: '#2563eb' },
    { key: 'unit_3', label: '3 Unit', color: '#16a34a' },
  ],
  roles: DEFAULT_ROLES,
  enabledModules: ['admin', 'files', 'scheduling', 'leave', 'pay', 'documents', 'forms', 'inventory', 'custody', 'training'],
  credentialTypes: DELCO_CREDENTIAL_TYPES,
  inventory: DELCO_INVENTORY,
  leave: DELCO_LEAVE,
  pay: DELCO_PAY,
  documents: DELCO_DOCUMENTS,
  training: DELCO_TRAINING,
  // 24 on / 48 off from 06:00 for medic units; 2026-11-02 was a "1" day in Aladtec's month view. No Kelly day seen.
  // Captain units (Capt. 461/462) run 07:30-07:30 and need a second pattern.
  // Research 06 §8.5: at least 25 ALS on duty (Paramedic and AEMT count), 2 ALS per ambulance. The Ohio
  // certificate is what qualifies a member to practise, so the group uses the Ohio credential types.
  staffingRules: {
    groups: [{ key: 'als', label: 'ALS', credentialKeys: ['ohio_paramedic', 'ohio_aemt'] }],
    departmentMinimums: [{ group: 'als', min: 25 }],
    unitRules: [{ group: 'als', unitTypeKey: 'unit', min: 2 }],
  },
  schedulePattern: {
    key: 'default',
    payload: {
      cycle: ['on', 'off', 'off'],
      shiftStart: '06:00',
      shiftHours: 24,
      anchorDate: '2026-11-02',
      platoons: { unit_1: 0, unit_2: 1, unit_3: 2 },
    },
  },
};
