'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import ConfirmDialog from '../../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../../components/feedback/ErrorBanner.js';
import Modal from '../../../components/modals/Modal.js';
import RowActionMenu from '../../../components/ui/RowActionMenu.js';
import StatusBadge from '../../../components/ui/StatusBadge.js';
import DateHint from '../../../components/forms/DateHint.js';
import ServiceForm, { formToBody, serviceToForm } from '../../../components/forms/ServiceForm.js';
import { formatDate } from '../../../lib/ui/date-format.js';
import { CATALOGUE_API, DURATION_UNITS, classificationLabel, standardText } from '../../../lib/api/catalogue.js';
import { apiFetch } from '../../../lib/auth/session.js';
import { useFormDirty } from '../../../lib/ui/useFormDirty.js';
import { parseDocumentNotes, parseProcedureSteps, splitLinks } from '../../../lib/ui/parseProcedure.js';

const API = CATALOGUE_API;
const EMPTY_STANDARD = { duration_value: '', duration_unit: 'WORKING_DAYS', effective_from: '', charter_reference: '' };
const EMPTY_DOC = { document_name: '', is_mandatory: true, notes: '' };

const NOT_SET = 'Not set';
const DETAIL_CARD = 'rounded-2xl border border-[#EAE3D9] bg-white p-6';
const CARD_TITLE = 'font-sans text-xl font-bold text-maroon-900';
const HEADER_CHIP = 'rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white';
const GLANCE_LABEL = 'text-xs font-bold uppercase tracking-wider text-slate-500';
const GLANCE_VALUE = 'mt-1 text-sm text-slate-900';
const GLANCE_EMPTY = 'mt-1 text-sm text-slate-500';

// Text with any http(s) addresses turned into links; everything else stays plain text.
function LinkedText({ text, linkLabel }) {
  return splitLinks(text).map((part, i) =>
    part.href ? (
      <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-maroon-800 underline">
        {linkLabel ?? part.href}
      </a>
    ) : (
      <span key={i}>{linkLabel ? part.text.replace(/[\s\-–·]+$/, ' ') : part.text}</span>
    ),
  );
}

function FieldError({ errors, name }) {
  return errors?.[name] ? <p className="mt-1 text-xs text-red-700">{errors[name]}</p> : null;
}

function ServiceDetail({ user, id }) {
  const isAdmin = user.role === ROLES.SUPER_ADMIN;
  const [state, setState] = useState({ loading: true, service: null, standards: [], documents: [], error: null });
  const [notice, setNotice] = useState(null);
  const [offices, setOffices] = useState([]);
  const [editForm, setEditForm] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [editError, setEditError] = useState(null);
  const [standard, setStandard] = useState({ ...EMPTY_STANDARD });
  const [standardErrors, setStandardErrors] = useState({});
  const [standardError, setStandardError] = useState(null);
  const [doc, setDoc] = useState(null); // { document_id?, ...fields }
  const [docErrors, setDocErrors] = useState({});
  const [docError, setDocError] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, item }
  const [saving, setSaving] = useState(false);
  const editDirty = useFormDirty(editForm);
  const docDirty = useFormDirty(doc);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/services/${encodeURIComponent(id)}`);
      setState({ loading: false, service: data.service, standards: data.standards ?? [], documents: data.documents ?? [], error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, service: null, error: err.message }));
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch(`${API}/offices`)
      .then((data) => setOffices(data.items ?? []))
      .catch(() => setOffices([]));
  }, [isAdmin]);

  const { service, standards, documents } = state;
  const current = service?.current_standard ?? null;

  function failWith(err, setErrors, setMessage) {
    setErrors(err.details && Object.keys(err.details).length > 0 ? err.details : {});
    setMessage(err.message);
  }

  async function saveService(event) {
    event.preventDefault();
    setSaving(true);
    setEditErrors({});
    setEditError(null);
    try {
      await apiFetch(`${API}/services/${id}`, { method: 'PUT', body: formToBody(editForm, false) });
      setEditForm(null);
      setNotice('Service saved.');
      await reload();
    } catch (err) {
      failWith(err, setEditErrors, setEditError);
    } finally {
      setSaving(false);
    }
  }

  async function addStandard(event) {
    event.preventDefault();
    setSaving(true);
    setStandardErrors({});
    setStandardError(null);
    try {
      await apiFetch(`${API}/services/${id}/standards`, {
        method: 'POST',
        body: {
          duration_value: Number(standard.duration_value),
          duration_unit: standard.duration_unit,
          effective_from: standard.effective_from,
          charter_reference: standard.charter_reference,
        },
      });
      setStandard({ ...EMPTY_STANDARD });
      setNotice('New standard version added.');
      await reload();
    } catch (err) {
      failWith(err, setStandardErrors, setStandardError);
    } finally {
      setSaving(false);
    }
  }

  async function saveDoc(event) {
    event.preventDefault();
    setSaving(true);
    setDocErrors({});
    setDocError(null);
    try {
      const body = { document_name: doc.document_name, is_mandatory: doc.is_mandatory, notes: doc.notes.trim() === '' ? null : doc.notes };
      if (doc.document_id) await apiFetch(`${API}/services/${id}/documents/${doc.document_id}`, { method: 'PUT', body });
      else await apiFetch(`${API}/services/${id}/documents`, { method: 'POST', body });
      setDoc(null);
      await reload();
    } catch (err) {
      failWith(err, setDocErrors, setDocError);
    } finally {
      setSaving(false);
    }
  }

  async function runConfirm() {
    setSaving(true);
    try {
      if (confirm.kind === 'document') await apiFetch(`${API}/services/${id}/documents/${confirm.item.document_id}`, { method: 'DELETE' });
      else if (confirm.kind === 'standard') await apiFetch(`${API}/services/${id}/standards/${confirm.item.standard_id}`, { method: 'DELETE' });
      else await apiFetch(`${API}/services/${id}/${confirm.kind}`, { method: 'PATCH' });
      setConfirm(null);
      await reload();
    } catch (err) {
      setConfirm(null);
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setSaving(false);
    }
  }

  // A version can be removed only while it is still in the future: newer than the one in force.
  const isFuture = (s) => (current ? s.version_no > current.version_no : true);

  if (state.loading) return <p className="text-sm text-slate-500">Loading service…</p>;
  if (!service) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={state.error ?? 'This service could not be found.'} />
      </div>
    );
  }

  const steps = parseProcedureSteps(service.processing_steps);

  const confirmText = {
    deactivate: ['Deactivate service?', 'Deactivate', `${service.service_name} will disappear from the public page and can no longer be used to start transactions. You can reactivate it later.`],
    reactivate: ['Reactivate service?', 'Reactivate', `${service.service_name} will appear again in the catalogue and on the public page.`],
    document: ['Remove document?', 'Remove', confirm?.item ? `${confirm.item.document_name} will be removed from the checklist.` : ''],
    standard: ['Delete standard version?', 'Delete', confirm?.item ? `Version ${confirm.item.version_no} has not started yet and will be deleted.` : ''],
  }[confirm?.kind ?? 'deactivate'];

  return (
    <div className="space-y-6">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />
      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" className="font-semibold hover:underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <header className="rounded-2xl bg-[#3D0606] px-5 py-4 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-80">
            <p className="text-xs font-bold uppercase tracking-wider text-[#E5B53A]">
              {service.office_name} &middot; {service.office_code}
            </p>
            <h2 className="mt-1 break-words font-sans text-xl font-bold leading-tight text-white sm:text-2xl">{service.service_name}</h2>
            <p className="mt-1.5 break-all text-sm text-white/90">
              Service code <span className="font-bold">{service.service_code}</span>
            </p>
          </div>
          <div className="ml-auto flex items-start gap-2">
            <div className="flex flex-col items-end gap-2">
              <StatusBadge variant={service.is_active ? 'active' : 'inactive'}>{service.is_active ? 'Active' : 'Inactive'}</StatusBadge>
              <div className="flex flex-wrap justify-end gap-2">
                <span className={HEADER_CHIP}>{classificationLabel(service.classification)}</span>
                {service.fees ? <span className={HEADER_CHIP}>{service.fees}</span> : null}
                {steps ? (
                  <span className={HEADER_CHIP}>
                    {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                  </span>
                ) : null}
              </div>
            </div>
            {isAdmin ? (
              <RowActionMenu
                vertical
                onDark
                label={`Actions for ${service.service_name}`}
                items={[
                  {
                    label: 'Edit',
                    onSelect: () => {
                      setEditErrors({});
                      setEditError(null);
                      setEditForm(serviceToForm(service));
                    },
                  },
                  { label: service.is_active ? 'Deactivate' : 'Reactivate', onSelect: () => setConfirm({ kind: service.is_active ? 'deactivate' : 'reactivate' }) },
                ]}
              />
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section className={DETAIL_CARD} aria-labelledby="procedure-heading">
            <h2 id="procedure-heading" className={CARD_TITLE}>Procedure steps</h2>
            <p className="mt-1 text-sm text-slate-500">Follow the steps in order. Each step shows where to go and who handles it.</p>
            {steps ? (
              <ol className="mt-6 space-y-6">
                {steps.map((step) => (
                  <li key={step.number} className="flex gap-4">
                    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-800 text-sm font-bold text-white">
                      {step.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">
                        <span className="sr-only">Step {step.number}: </span>
                        {step.title}
                        {step.aside ? <span className="ml-1 text-sm font-normal text-slate-500">{step.aside}</span> : null}
                      </p>
                      {step.location ? (
                        <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-500">
                          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M10 18s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
                            <circle cx="10" cy="8" r="2" />
                          </svg>
                          <span>{step.location}</span>
                        </p>
                      ) : null}
                      {step.instruction ? <p className="mt-1 text-sm text-slate-500">{step.instruction}</p> : null}
                      {step.substeps.length > 0 ? (
                        <ul className="mt-3 space-y-2">
                          {step.substeps.map((sub) => (
                            <li key={sub.label} className="rounded-xl bg-[#FAF7F2] px-4 py-3 text-sm text-slate-800">
                              <p>
                                <span className="font-bold text-maroon-800">{sub.label}</span> {sub.text}
                              </p>
                              {sub.roles.length > 0 ? (
                                <p className="mt-1.5 flex flex-wrap gap-1.5">
                                  {sub.roles.map((role) => (
                                    <span key={role} className="rounded-full bg-maroon-100 px-2.5 py-0.5 text-xs font-semibold text-maroon-800">
                                      {role}
                                    </span>
                                  ))}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : service.processing_steps ? (
              <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{service.processing_steps}</p>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No procedure steps recorded. {isAdmin ? 'Use Edit to add them.' : ''}</p>
            )}
          </section>

          <section className={DETAIL_CARD} aria-labelledby="documents-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="documents-heading" className={CARD_TITLE}>Required documents</h2>
                <p className="mt-1 text-sm text-slate-500">What a citizen should bring. Mandatory items are marked.</p>
              </div>
              {isAdmin ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setDocErrors({});
                    setDocError(null);
                    setDoc({ ...EMPTY_DOC });
                  }}
                >
                  + Add Document
                </button>
              ) : null}
            </div>
            {documents.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No required documents listed.</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {documents.map((d) => {
                  const parts = parseDocumentNotes(d.notes);
                  return (
                    <li key={d.document_id} className="rounded-xl border border-[#EAE3D9] p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 basis-60 font-semibold text-slate-900">{d.document_name}</p>
                          {d.is_mandatory ? (
                            <span className="badge shrink-0 bg-[#FFF4D9] text-[#9A6A00]">Mandatory</span>
                          ) : (
                            <span className="badge-inactive shrink-0">Optional</span>
                          )}
                        </div>
                        {isAdmin ? (
                          <RowActionMenu
                            label={`Actions for ${d.document_name}`}
                            items={[
                              {
                                label: 'Edit',
                                onSelect: () => {
                                  setDocErrors({});
                                  setDocError(null);
                                  setDoc({ document_id: d.document_id, document_name: d.document_name, is_mandatory: d.is_mandatory, notes: d.notes ?? '' });
                                },
                              },
                              { label: 'Remove', danger: true, onSelect: () => setConfirm({ kind: 'document', item: d }) },
                            ]}
                          />
                        ) : null}
                      </div>
                      {parts ? (
                        <dl className="mt-3 space-y-2 text-sm text-slate-700">
                          {parts.copies ? (
                            <div>
                              <dt className="inline font-bold text-slate-900">Copies: </dt>
                              <dd className="inline">{parts.copies}</dd>
                            </div>
                          ) : null}
                          {parts.where ? (
                            <div>
                              <dt className="inline font-bold text-slate-900">Where to secure: </dt>
                              <dd className="inline">
                                <LinkedText text={parts.where} linkLabel="Open link" />
                              </dd>
                            </div>
                          ) : null}
                          {parts.remarks ? (
                            <div>
                              <dt className="inline font-bold text-slate-900">Remarks: </dt>
                              <dd className="inline">
                                <LinkedText text={parts.remarks} />
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : d.notes ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                          <LinkedText text={d.notes} />
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section className={DETAIL_CARD} aria-labelledby="glance-heading">
            <h2 id="glance-heading" className={CARD_TITLE}>At a glance</h2>
            <dl className="mt-4 space-y-4">
              <div>
                <dt className={GLANCE_LABEL}>Fees</dt>
                <dd className={service.fees ? 'mt-1 break-words text-2xl font-bold text-maroon-800' : GLANCE_EMPTY}>{service.fees || NOT_SET}</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Who may avail</dt>
                <dd className={service.who_may_avail ? GLANCE_VALUE : GLANCE_EMPTY}>{service.who_may_avail || NOT_SET}</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Classification</dt>
                <dd className={GLANCE_VALUE}>{classificationLabel(service.classification)}</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Measurement</dt>
                <dd className={GLANCE_VALUE}>Timeliness</dd>
              </div>
              <div>
                <dt className={GLANCE_LABEL}>Transaction type</dt>
                <dd className={service.transaction_type ? GLANCE_VALUE : GLANCE_EMPTY}>{service.transaction_type || NOT_SET}</dd>
              </div>
            </dl>
          </section>

          <section className={DETAIL_CARD} aria-labelledby="standards-heading">
            <h2 id="standards-heading" className={CARD_TITLE}>Standards</h2>
            <p className="mt-1 text-sm text-slate-500">Each transaction is judged against the version in force on the day it started.</p>
            {standards.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No standard versions yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {standards.map((s) => {
                  const inForce = current && s.standard_id === current.standard_id;
                  return (
                    <li key={s.standard_id} className={`rounded-xl border p-4 ${inForce ? 'border-maroon-100 bg-maroon-50' : 'border-[#EAE3D9] bg-white'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">v{s.version_no}</span>
                          {inForce ? (
                            <StatusBadge variant="active">In force</StatusBadge>
                          ) : isFuture(s) ? (
                            <StatusBadge variant="complex">Upcoming</StatusBadge>
                          ) : (
                            <StatusBadge variant="inactive">Superseded</StatusBadge>
                          )}
                        </p>
                        {isAdmin && isFuture(s) ? (
                          <RowActionMenu
                            label={`Actions for version ${s.version_no}`}
                            items={[{ label: 'Delete', danger: true, onSelect: () => setConfirm({ kind: 'standard', item: s }) }]}
                          />
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-800">{standardText(s.duration_value, s.duration_unit)}</p>
                      <p className="mt-1 text-sm text-slate-700">
                        {formatDate(s.effective_from) || '-'} &rarr; {s.effective_to ? formatDate(s.effective_to) || '-' : 'Open'}
                      </p>
                      {s.charter_reference ? <p className="mt-1 text-xs text-slate-500">{s.charter_reference}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {isAdmin ? (
              <form onSubmit={addStandard} className="mt-5 border-t border-slate-200 pt-5">
                <h3 className="font-sans text-base font-bold text-slate-900">Add New Version</h3>
                <ErrorBanner message={standardError} />
                <div className="mt-3 grid gap-4">
                  <div>
                    <label className="label" htmlFor="std-value">
                      Duration value
                    </label>
                    <input id="std-value" type="number" min={1} step={1} className="input" value={standard.duration_value} onChange={(e) => setStandard({ ...standard, duration_value: e.target.value })} required />
                    <FieldError errors={standardErrors} name="duration_value" />
                  </div>
                  <div>
                    <label className="label" htmlFor="std-unit">
                      Duration unit
                    </label>
                    <select id="std-unit" className="input" value={standard.duration_unit} onChange={(e) => setStandard({ ...standard, duration_unit: e.target.value })}>
                      {DURATION_UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    <FieldError errors={standardErrors} name="duration_unit" />
                  </div>
                  <div>
                    <label className="label" htmlFor="std-from">
                      Effective from
                    </label>
                    <input id="std-from" type="date" className="input" value={standard.effective_from} onChange={(e) => setStandard({ ...standard, effective_from: e.target.value })} required aria-describedby="std-from-hint" />
                    <DateHint id="std-from-hint" />
                    <FieldError errors={standardErrors} name="effective_from" />
                  </div>
                  <div>
                    <label className="label" htmlFor="std-ref">
                      Charter reference
                    </label>
                    <input id="std-ref" className="input" value={standard.charter_reference} onChange={(e) => setStandard({ ...standard, charter_reference: e.target.value })} required maxLength={200} />
                    <FieldError errors={standardErrors} name="charter_reference" />
                  </div>
                </div>
                <button type="submit" className="btn-primary mt-4" disabled={saving}>
                  {saving ? 'Saving…' : 'Add version'}
                </button>
              </form>
            ) : null}
          </section>
        </div>
      </div>

      <Modal
        open={editForm !== null}
        title="Edit Service"
        dirty={editDirty}
        widthClass="max-w-2xl"
        onClose={saving ? undefined : () => setEditForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditForm(null)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="edit-service-form" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {editForm ? (
          <div className="space-y-4">
            <ErrorBanner message={editError} />
            <ServiceForm id="edit-service-form" form={editForm} setForm={setEditForm} errors={editErrors} offices={offices} isNew={false} onSubmit={saveService} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={doc !== null}
        title={doc?.document_id ? 'Edit Document' : 'Add Document'}
        dirty={docDirty}
        onClose={saving ? undefined : () => setDoc(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDoc(null)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="doc-form" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {doc ? (
          <form id="doc-form" onSubmit={saveDoc} className="space-y-4">
            <ErrorBanner message={docError} />
            <div>
              <label className="label" htmlFor="doc-name">
                Document name
              </label>
              <input id="doc-name" className="input" value={doc.document_name} onChange={(e) => setDoc({ ...doc, document_name: e.target.value })} required maxLength={200} autoFocus />
              <FieldError errors={docErrors} name="document_name" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={doc.is_mandatory} onChange={(e) => setDoc({ ...doc, is_mandatory: e.target.checked })} />
              Mandatory
            </label>
            <div>
              <label className="label" htmlFor="doc-notes">
                Notes (optional, plain text)
              </label>
              <textarea id="doc-notes" className="input" rows={3} value={doc.notes} onChange={(e) => setDoc({ ...doc, notes: e.target.value })} maxLength={1000} />
              <FieldError errors={docErrors} name="notes" />
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirmText[0]}
        message={confirmText[2]}
        confirmLabel={confirmText[1]}
        danger={confirm ? confirm.kind !== 'reactivate' : false}
        busy={saving}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function ServiceDetailPage() {
  const { id } = useParams();
  return (
    <AppShell
      title="Service Details"
      eyebrow={
        <Link href="/services" className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-maroon-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 4-6 6 6 6" />
      </svg>
      Back to services
    </Link>
      }
      subtitle="Standard, required documents and procedure steps.">
      {(user) => <ServiceDetail user={user} id={id} />}
    </AppShell>
  );
}
