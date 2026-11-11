// Project stages, in the order they happen. Used by every status
// picker, filter, badge and export, so they always match.
export const PROJECT_STATUSES = [
  { value: 'lighting_design', label: 'Lighting Design' },
  { value: 'tender', label: 'Tender' },
  { value: 'job_in_hand', label: 'Job In Hand' },
  { value: 'letter_of_intent', label: 'Letter of Intent' },
  { value: 'submittal', label: 'Submittal' },
  { value: 'samples_comments', label: 'Samples & Comments' },
  { value: 'approval_code_b', label: 'Approval - Code B' },
  { value: 'lpo_order_confirmation', label: 'LPO / Order Confirmation' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'invoice_payment', label: 'Invoice & Payment' },
  { value: 'om_manual_warranty', label: 'O & M Manual / Warranty Certificate' },
];

export const DEFAULT_PROJECT_STATUS = 'tender';

export const PROJECT_STATUS_LABELS = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.value, s.label]));

export function projectStatusLabel(value) {
  return PROJECT_STATUS_LABELS[value] || value || '';
}

// Position in the list (for sorting by stage); unknown values go last
export function projectStatusRank(valueOrLabel) {
  const i = PROJECT_STATUSES.findIndex((s) => s.value === valueOrLabel || s.label === valueOrLabel);
  return i === -1 ? PROJECT_STATUSES.length : i;
}

// Progress follows the stage: Lighting Design 5%, Tender 10%,
// Job In Hand 20% … O & M / Warranty 100%.
// (The database applies the same rule, so they can never disagree.)
export function projectProgress(status) {
  if (status === 'lighting_design') return 5;
  const i = PROJECT_STATUSES.findIndex((s) => s.value === status);
  return i === -1 ? 10 : i * 10; // tender is 2nd in the list → 10
}
