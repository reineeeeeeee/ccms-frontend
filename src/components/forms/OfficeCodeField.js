'use client';

import { OFFICE_CODE_MAX, composeOfficeCode } from '../../lib/ui/office-code.js';

/**
 * The Office code input of the Add and Edit Office form.
 * - No prefix (today): the plain, full-code input.
 * - With a prefix: the institution prefix as fixed text ("PUP-") joined to an input for the office part
 *   ("OSAS"), and the full code underneath. An existing code without the prefix (not re-coded yet) is
 *   shown whole and unchanged, so saving never writes the prefix twice.
 * `value` is the office part when there is a prefix and the whole code otherwise. `legacy` marks an existing
 * code that does not start with the prefix: it is shown whole, as the plain input.
 */
export default function OfficeCodeField({ id = 'office_code', prefix = null, legacy = false, value, onChange, error, autoFocus = false }) {
  const separate = Boolean(prefix) && !legacy;
  const maxLength = separate ? Math.max(1, OFFICE_CODE_MAX - prefix.length - 1) : OFFICE_CODE_MAX;
  const errorId = `${id}-error`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        Office code
      </label>
      {separate ? (
        <div className="flex items-stretch">
          <span className="inline-flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-700" data-testid="office-code-prefix">
            {prefix}-
          </span>
          <input
            id={id}
            className="input rounded-l-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required
            maxLength={maxLength}
            autoFocus={autoFocus}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : `${id}-full`}
          />
        </div>
      ) : (
        <input
          id={id}
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          maxLength={OFFICE_CODE_MAX}
          autoFocus={autoFocus}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      )}
      {separate ? (
        <p id={`${id}-full`} className="mt-1 text-xs text-slate-500" aria-live="polite">
          Full code: <span className="font-semibold text-slate-700">{composeOfficeCode(prefix, value) || `${prefix}-`}</span>
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
