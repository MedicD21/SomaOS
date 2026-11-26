import type { Permission } from '@soma/auth';

export type FormFieldTemplate = {
  key: string;
  label: string;
  type: 'text' | 'long_text' | 'number' | 'integer' | 'boolean' | 'date' | 'select' | 'multi_select' | 'email' | 'phone';
  required: boolean;
  options?: { value: string; label: string }[];
  show_if?: { field: string; equals: string | number | boolean };
};

export type FormTemplate = {
  key: string;
  label: string;
  description: string;
  fields: FormFieldTemplate[];
  requiresSignature: boolean;
  signatureStatement: string | null;
  approval: 'none' | 'officer';
};

export type DocumentsTemplate = {
  /** Top-level folders. `viewPermission` restricts a folder (and everything under it) to department-wide holders. */
  folders: { name: string; viewPermission: Permission | null }[];
  forms: FormTemplate[];
};

/**
 * Starter content: folders and three generic forms. Every field list and statement is a starting point to edit;
 * the wording is generic and has not had legal review.
 */
export const STARTER_DOCUMENTS: DocumentsTemplate = {
  folders: [
    { name: 'Policies and SOGs', viewPermission: null },
    { name: 'Forms Library', viewPermission: null },
    { name: 'Training', viewPermission: null },
    { name: 'HR', viewPermission: 'admin.members.manage' },
  ],
  forms: [
    {
      key: 'incident_injury_report',
      label: 'Incident / Injury Report',
      description: 'Report an incident, near miss or injury. Your company officer reviews it.',
      requiresSignature: true,
      signatureStatement: 'I certify that the information in this report is true and complete to the best of my knowledge.',
      approval: 'officer',
      fields: [
        { key: 'incident_date', label: 'Date of incident', type: 'date', required: true },
        { key: 'location', label: 'Location', type: 'text', required: true },
        { key: 'what_happened', label: 'What happened', type: 'long_text', required: true },
        { key: 'injured', label: 'Was anyone injured?', type: 'boolean', required: true },
        { key: 'injury_details', label: 'Who was injured and how', type: 'long_text', required: true, show_if: { field: 'injured', equals: true } },
        {
          key: 'treatment', label: 'Treatment', type: 'select', required: false, show_if: { field: 'injured', equals: true },
          options: [
            { value: 'none', label: 'None' }, { value: 'first_aid', label: 'First aid on scene' },
            { value: 'ems', label: 'Transported by EMS' }, { value: 'clinic', label: 'Clinic or hospital visit' },
          ],
        },
        { key: 'witnesses', label: 'Witnesses', type: 'text', required: false },
        { key: 'supervisor_notified', label: 'Supervisor notified?', type: 'boolean', required: true },
      ],
    },
    {
      key: 'vehicle_damage_report',
      label: 'Vehicle Damage Report',
      description: 'Report damage to an apparatus or department vehicle.',
      requiresSignature: true,
      signatureStatement: 'I certify that the information in this report is true and complete to the best of my knowledge.',
      approval: 'officer',
      fields: [
        { key: 'incident_date', label: 'Date of incident', type: 'date', required: true },
        { key: 'vehicle', label: 'Vehicle or unit', type: 'text', required: true },
        { key: 'driver', label: 'Driver', type: 'text', required: true },
        { key: 'location', label: 'Location', type: 'text', required: true },
        { key: 'description', label: 'Description of the damage', type: 'long_text', required: true },
        { key: 'other_party', label: 'Another vehicle involved?', type: 'boolean', required: true },
        { key: 'other_party_details', label: 'Other party and insurance details', type: 'long_text', required: true, show_if: { field: 'other_party', equals: true } },
        { key: 'police_report', label: 'Police report filed?', type: 'boolean', required: true },
        { key: 'police_report_number', label: 'Report number', type: 'text', required: false, show_if: { field: 'police_report', equals: true } },
      ],
    },
    {
      key: 'equipment_issue_receipt',
      label: 'Equipment Issue Receipt',
      description: 'Acknowledge receiving issued equipment. No approval needed.',
      requiresSignature: true,
      signatureStatement: 'I acknowledge that I received the equipment listed and accept responsibility for it.',
      approval: 'none',
      fields: [
        { key: 'item', label: 'Item', type: 'text', required: true },
        { key: 'identifier', label: 'Serial or ID number', type: 'text', required: false },
        {
          key: 'condition', label: 'Condition', type: 'select', required: true,
          options: [{ value: 'new', label: 'New' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }],
        },
        { key: 'issued_on', label: 'Date issued', type: 'date', required: true },
        { key: 'notes', label: 'Notes', type: 'long_text', required: false },
      ],
    },
  ],
};
