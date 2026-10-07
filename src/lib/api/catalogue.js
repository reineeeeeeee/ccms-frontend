// Catalogue (offices, services, public list) as the browser calls it, through the gateway.
// Everything returned here is plain text or data; pages render it through React (escaped), never as HTML.

export const CATALOGUE_API = '/api/catalogue';
export const OFFICES_API = `${CATALOGUE_API}/offices`;
export const SERVICES_API = `${CATALOGUE_API}/services`;
export const PUBLIC_SERVICES_API = `${CATALOGUE_API}/public/services`;

export const CLASSIFICATIONS = [
  { value: 'SIMPLE', label: 'Simple' },
  { value: 'COMPLEX', label: 'Complex' },
  { value: 'HIGHLY_TECHNICAL', label: 'Highly Technical' },
];
export const TRANSACTION_TYPES = [
  { value: 'G2C', label: 'G2C (Government to Citizen)' },
  { value: 'G2G', label: 'G2G (Government to Government)' },
  { value: 'G2B', label: 'G2B (Government to Business)' },
];
export const DURATION_UNITS = [
  { value: 'MINUTES', label: 'Minutes' },
  { value: 'HOURS', label: 'Hours' },
  { value: 'WORKING_DAYS', label: 'Working days' },
];

export function classificationLabel(value) {
  return CLASSIFICATIONS.find((c) => c.value === value)?.label ?? value;
}

const UNIT_WORDS = { MINUTES: ['minute', 'minutes'], HOURS: ['hour', 'hours'], WORKING_DAYS: ['working day', 'working days'] };

/** "7 minutes", "1 hour", "3 working days". */
export function standardText(value, unit) {
  const words = UNIT_WORDS[unit];
  if (!words || value == null) return '';
  return `${value} ${Number(value) === 1 ? words[0] : words[1]}`;
}
