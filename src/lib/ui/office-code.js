// Rules for office codes and the institution prefix (TT6, "PUP-OSAS"), as pure functions so they can be
// tested directly. The Core service owns the real rules: it stores the full code, keeps it unique in any
// letter case and limits it to 20 characters. Nothing here changes a code in the data; it only builds
// the full code to send and explains the service's answers.
//
// The institution prefix is NOT available yet: Core has no institution code (no field, no endpoint; its
// own notes list "TT6 institution and office codes" as not implemented). Until it exists, OFFICE_CODE_PREFIX
// stays null and the Offices form keeps the plain, full-code input it has always had.

/** The institution prefix the Offices form shows as fixed text, or null while Core cannot supply one. */
export const OFFICE_CODE_PREFIX = null;

export const OFFICE_CODE_MAX = 20;
export const CODE_TAKEN_MESSAGE = 'Office code already exists';
export const NAME_TAKEN_MESSAGE = 'Office name already exists';
export const INSTITUTION_CODE_MESSAGE = 'Institution code must be 2 to 10 uppercase letters or digits (for example PUP).';
export const FORBIDDEN_MESSAGE = 'You do not have permission to change offices. Ask a Super Admin.';
export const SERVER_ERROR_MESSAGE = 'The server could not save this office right now. Please try again in a few minutes.';

/** Error text for an institution code that is not 2-10 uppercase letters or digits, or null when it is fine. */
export function institutionCodeProblem(code) {
  return /^[A-Z0-9]{2,10}$/.test(String(code ?? '').trim()) ? null : INSTITUTION_CODE_MESSAGE;
}

/** The full office code from the fixed prefix and what the person typed: "PUP" + "OSAS" -> "PUP-OSAS". No prefix: just the code. */
export function composeOfficeCode(prefix, part) {
  const text = String(part ?? '').trim();
  return prefix ? `${prefix}-${text}` : text;
}

/** True when a stored code already starts with the prefix and a hyphen (any letter case). */
export function hasPrefix(prefix, code) {
  return Boolean(prefix) && String(code ?? '').toUpperCase().startsWith(`${String(prefix).toUpperCase()}-`);
}

/**
 * What the office part of a stored code is, for the Edit form: "PUP-OSAS" -> "OSAS", so saving never
 * writes "PUP-PUP-OSAS". A code without the prefix (an office that has not been re-coded yet) has no
 * separate part: returns null and the form shows the whole code as it is.
 */
export function officePart(prefix, code) {
  const text = String(code ?? '');
  return hasPrefix(prefix, text) ? text.slice(String(prefix).length + 1) : null;
}

/** Early feedback on the office part; Core checks again. Resolves to a message or null. */
export function officeCodeProblem(prefix, part) {
  const text = String(part ?? '').trim();
  if (!text) return 'Office code is required';
  const full = composeOfficeCode(prefix, text);
  if (full.length > OFFICE_CODE_MAX) {
    const room = prefix ? Math.max(0, OFFICE_CODE_MAX - String(prefix).length - 1) : OFFICE_CODE_MAX;
    return `The full code "${full}" is ${full.length} characters. Office codes can be at most ${OFFICE_CODE_MAX} characters including the hyphen, so the office part can be at most ${room}.`;
  }
  return null;
}

/** A failed office save as { fieldErrors, message }: field messages go under their inputs, message in the form's banner. */
export function officeSaveError(err, prefix = null) {
  const status = err?.status;
  const details = err?.details && typeof err.details === 'object' ? err.details : null;
  const fieldErrors = {};
  if (status === 409) {
    if (err.code === 'OFFICE_NAME_EXISTS' && !details?.office_code) fieldErrors.office_name = NAME_TAKEN_MESSAGE;
    else fieldErrors.office_code = CODE_TAKEN_MESSAGE;
    if (details?.office_name) fieldErrors.office_name = NAME_TAKEN_MESSAGE;
    return { fieldErrors, message: null };
  }
  if (status === 400 && details) {
    if (details.office_code) {
      fieldErrors.office_code = /20 characters/.test(String(details.office_code))
        ? `Office codes can be at most ${OFFICE_CODE_MAX} characters including the hyphen${prefix ? `, so the office part can be at most ${OFFICE_CODE_MAX - prefix.length - 1}` : ''}.`
        : String(details.office_code);
    }
    if (details.office_name) fieldErrors.office_name = String(details.office_name);
    if (details.institution_code) fieldErrors.institution_code = INSTITUTION_CODE_MESSAGE;
    if (Object.keys(fieldErrors).length) return { fieldErrors, message: null };
  }
  if (status === 403) return { fieldErrors, message: FORBIDDEN_MESSAGE };
  if (err?.code === 'NETWORK_ERROR') return { fieldErrors, message: err.message };
  if (status >= 500) return { fieldErrors, message: SERVER_ERROR_MESSAGE };
  return { fieldErrors, message: err?.message ?? 'Something went wrong. Please try again.' };
}
