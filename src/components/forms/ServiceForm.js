'use client';

import { useState } from 'react';
import { CLASSIFICATIONS, DURATION_UNITS, TRANSACTION_TYPES } from '../../lib/api/catalogue.js';
import { PROCEDURE_LIMIT, canUseStepEditor, procedureFields, procedureForBody, procedureProblem, toStepMode, toTextMode } from '../../lib/ui/procedure-steps.js';
import DateHint from './DateHint.js';
import ProcedureStepsEditor from './ProcedureStepsEditor.js';

export const EMPTY_SERVICE_FORM = {
  office_id: '',
  service_code: '',
  service_name: '',
  classification: 'SIMPLE',
  transaction_type: 'G2C',
  // Procedure: processing_steps is the text; procedure_mode/procedure_steps are the step editor's view of it
  // (the editor is used only when the stored text round-trips exactly, see lib/ui/procedure-steps.js).
  processing_steps: '',
  procedure_mode: 'steps',
  procedure_steps: [],
  fees: '',
  who_may_avail: '',
  duration_value: '',
  duration_unit: 'WORKING_DAYS',
  effective_from: '',
  charter_reference: '',
};

export function serviceToForm(service) {
  return {
    ...EMPTY_SERVICE_FORM,
    office_id: service.office_id,
    service_code: service.service_code,
    service_name: service.service_name,
    classification: service.classification,
    transaction_type: service.transaction_type,
    ...procedureFields(service.processing_steps),
    fees: service.fees ?? '',
    who_may_avail: service.who_may_avail ?? '',
  };
}

/** Request body for POST (with standard) or PUT (without). */
export function formToBody(form, withStandard) {
  const body = {
    office_id: form.office_id,
    service_code: form.service_code,
    service_name: form.service_name,
    classification: form.classification,
    transaction_type: form.transaction_type,
    // Step editor: the numbered text. Text box: exactly what is in it. Empty is no procedure.
    processing_steps: procedureForBody(form),
    fees: form.fees.trim() === '' ? null : form.fees,
    who_may_avail: form.who_may_avail.trim() === '' ? null : form.who_may_avail,
  };
  if (withStandard) {
    body.standard = {
      duration_value: Number(form.duration_value),
      duration_unit: form.duration_unit,
      effective_from: form.effective_from,
      charter_reference: form.charter_reference,
    };
  }
  return body;
}

function FieldError({ errors, name }) {
  return errors?.[name] ? <p className="mt-1 text-xs text-red-700">{errors[name]}</p> : null;
}

/** Add / edit service fields. The First Standard section only appears when adding. */
export default function ServiceForm({ id, form, setForm, errors, offices, isNew, onSubmit }) {
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  const [procedureError, setProcedureError] = useState(null);
  const stepMode = form.procedure_mode === 'steps';
  const changeProcedure = (change) => {
    setProcedureError(null);
    setForm({ ...form, ...change });
  };
  function submit(event) {
    const problem = procedureProblem(form);
    if (problem) {
      event.preventDefault();
      setProcedureError(problem);
      return;
    }
    onSubmit(event);
  }
  // errors from the API may be keyed "standard.duration_value" or "duration_value"
  const err = (name) => errors?.[name] ?? errors?.[`standard.${name}`];
  const errFor = (name) => ({ [name]: err(name) });
  return (
    <form id={id} onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor={`${id}-office`}>
          Office
        </label>
        <select id={`${id}-office`} className="input" value={form.office_id} onChange={set('office_id')} required>
          <option value="">Select an office</option>
          {offices.map((o) => (
            <option key={o.office_id} value={o.office_id}>
              {o.office_code} - {o.office_name}
            </option>
          ))}
        </select>
        <FieldError errors={errors} name="office_id" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor={`${id}-code`}>
            Service code
          </label>
          <input id={`${id}-code`} className="input" placeholder="OFFICE-ABBR-001" value={form.service_code} onChange={set('service_code')} required maxLength={40} />
          <FieldError errors={errors} name="service_code" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${id}-name`}>
            Service name
          </label>
          <input id={`${id}-name`} className="input" value={form.service_name} onChange={set('service_name')} required minLength={3} maxLength={100} />
          <FieldError errors={errors} name="service_name" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-class`}>
            Classification
          </label>
          <select id={`${id}-class`} className="input" value={form.classification} onChange={set('classification')}>
            {CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <FieldError errors={errors} name="classification" />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-type`}>
            Transaction type
          </label>
          <select id={`${id}-type`} className="input" value={form.transaction_type} onChange={set('transaction_type')}>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <FieldError errors={errors} name="transaction_type" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-fees`}>
            Fees (as published in the Charter)
          </label>
          <input id={`${id}-fees`} className="input" value={form.fees} onChange={set('fees')} maxLength={500} />
          <FieldError errors={errors} name="fees" />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-who-may-avail`}>
            Who may avail
          </label>
          <input id={`${id}-who-may-avail`} className="input" value={form.who_may_avail} onChange={set('who_may_avail')} maxLength={500} />
          <FieldError errors={errors} name="who_may_avail" />
        </div>
      </div>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="label mb-0" htmlFor={stepMode ? `${id}-step-1` : `${id}-steps`} id={`${id}-steps-label`}>
            Procedure steps (reference only, plain text)
          </label>
          {stepMode ? (
            <button type="button" className="btn-link" onClick={() => changeProcedure(toTextMode(form))}>
              Edit as text
            </button>
          ) : (
            <button
              type="button"
              className="btn-link"
              disabled={!canUseStepEditor(form.processing_steps)}
              onClick={() => changeProcedure(toStepMode(form))}
            >
              Use step editor
            </button>
          )}
        </div>
        {stepMode ? (
          <div className="mt-2">
            <ProcedureStepsEditor id={id} steps={form.procedure_steps} onChange={(steps) => changeProcedure({ procedure_steps: steps })} describedBy={procedureError || errors?.processing_steps ? `${id}-steps-error` : undefined} />
          </div>
        ) : (
          <>
            <textarea
              id={`${id}-steps`}
              className="input mt-2"
              rows={5}
              value={form.processing_steps}
              onChange={(e) => changeProcedure({ processing_steps: e.target.value })}
              maxLength={PROCEDURE_LIMIT}
              aria-describedby={canUseStepEditor(form.processing_steps) ? undefined : `${id}-steps-hint`}
            />
            {!canUseStepEditor(form.processing_steps) ? (
              <p id={`${id}-steps-hint`} className="mt-1 text-xs text-slate-500">
                This text has sub-steps, locations, responsible persons or other formatting the step editor cannot keep exactly, so it stays as text.
              </p>
            ) : null}
          </>
        )}
        {procedureError || errors?.processing_steps ? (
          <p id={`${id}-steps-error`} role="alert" className="mt-1 text-xs text-red-700">
            {procedureError ?? errors.processing_steps}
          </p>
        ) : null}
      </div>

      {isNew ? (
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-2 text-sm font-semibold text-maroon-800">First Standard</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${id}-dv`}>
                Duration value
              </label>
              <input id={`${id}-dv`} type="number" min={1} step={1} className="input" value={form.duration_value} onChange={set('duration_value')} required />
              <FieldError errors={errFor('duration_value')} name="duration_value" />
            </div>
            <div>
              <label className="label" htmlFor={`${id}-du`}>
                Duration unit
              </label>
              <select id={`${id}-du`} className="input" value={form.duration_unit} onChange={set('duration_unit')}>
                {DURATION_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <FieldError errors={errFor('duration_unit')} name="duration_unit" />
            </div>
            <div>
              <label className="label" htmlFor={`${id}-ef`}>
                Effective from
              </label>
              <input id={`${id}-ef`} type="date" className="input" value={form.effective_from} onChange={set('effective_from')} required aria-describedby={`${id}-ef-hint`} />
              <DateHint id={`${id}-ef-hint`} />
              <FieldError errors={errFor('effective_from')} name="effective_from" />
            </div>
            <div>
              <label className="label" htmlFor={`${id}-cr`}>
                Charter reference
              </label>
              <input id={`${id}-cr`} className="input" value={form.charter_reference} onChange={set('charter_reference')} required maxLength={200} />
              <FieldError errors={errFor('charter_reference')} name="charter_reference" />
            </div>
          </div>
        </fieldset>
      ) : null}
    </form>
  );
}
