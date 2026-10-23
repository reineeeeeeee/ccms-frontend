'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../../components/layout/AppShell.js';
import StatusBanner from '../../../components/feedback/StatusBanner.js';
import { classificationLabel } from '../../../lib/api/catalogue.js';
import { getServiceStandardAsOf, listRecordsOnDate } from '../../../lib/api/backdate.js';
import { getSettings, listCounters } from '../../../lib/api/operations.js';
import { getServiceDetail, getServiceStandard, listOpenTransactions, listStartableServices, postTransaction } from '../../../lib/api/transactions.js';
import { BACKDATE_MESSAGES, BACKDATE_REASON_MAX, EMPTY_PAST, backdateErrors, isAmbiguousWrite, manilaDateOf, pastStandardMessage, withBackdate } from '../../../lib/ui/backdate.js';
import { COMPLIANCE_LABELS, complianceState, describeElapsed, describeVariance } from '../../../lib/ui/complete-transaction.js';
import StatusBadge from '../../../components/ui/StatusBadge.js';
import { formatDate, formatDateTime } from '../../../lib/ui/date-format.js';
import {
  CLIENT_TYPES,
  EMAIL_MAX,
  EMPTY_START_FORM,
  REFERENCE_MAX,
  allConfirmed,
  buildStartBody,
  clientTypeLabel,
  conflictTransaction,
  filterServices,
  formatStandardDuration,
  requirementItems,
  serviceOptionLabel,
  standardLoadResult,
  startErrorResult,
  startErrors,
  statusLabel,
} from '../../../lib/ui/start-transaction.js';

// The element to focus for each field error, so a keyboard or screen-reader user lands on the first problem.
const FIELD_ID = { started_at: 'start-past-start', ended_at: 'start-past-end', backdate_reason: 'start-past-reason', service: 'start-service', client_type: 'start-client-type', client_reference: 'start-reference', client_email: 'start-email', counter: 'start-counter', requirements: 'start-requirements' };
const FIELD_ORDER = ['service', 'standard', 'started_at', 'ended_at', 'backdate_reason', 'client_type', 'client_reference', 'client_email', 'requirements', 'counter'];

function Section({ title, children, id }) {
  return (
    <section className="card p-5" aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-lg">
        {title}
      </h2>
      {children}
    </section>
  );
}

const FieldError = ({ id, children }) => (children ? <p id={id} className="mt-1 text-xs text-red-700">{children}</p> : null);

function StartTransaction({ user }) {
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  const [services, setServices] = useState({ loading: true, items: [], error: null });
  const [settings, setSettings] = useState({ loaded: false, countersEnabled: false, error: null });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...EMPTY_START_FORM });
  const [standard, setStandard] = useState({ state: 'idle', data: null, kind: null, message: null }); // idle | loading | ready | blocked
  const [documents, setDocuments] = useState({ state: 'idle', items: [], message: null }); // idle | loading | ready | failed
  const [checks, setChecks] = useState({});
  const [counters, setCounters] = useState({ state: 'idle', items: [], message: null }); // idle | loading | ready | failed
  const [fieldErrors, setFieldErrors] = useState({});
  const [banner, setBanner] = useState(null); // { kind, message, conflict }
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [past, setPast] = useState({ ...EMPTY_PAST }); // "Record past transaction": what the person typed (Manila time)
  const [pastStandard, setPastStandard] = useState({ state: 'idle', data: null, message: null }); // the standard of the day of the typed start
  const [lock, setLock] = useState(null); // after an unclear past write: null | { checked, state, records }
  const latestPastStandard = useRef(0);
  const submittingRef = useRef(false); // set synchronously, so a double click cannot send two requests
  const latestService = useRef(0); // an answer for a service that is no longer chosen is ignored

  // The service list and the settings (are counters in use?) load once.
  useEffect(() => {
    let cancelled = false;
    listStartableServices({ isSuperAdmin })
      .then((items) => !cancelled && setServices({ loading: false, items, error: null }))
      .catch((err) => !cancelled && setServices({ loading: false, items: [], error: err.status === 403 ? 'You do not have permission to see the services.' : 'The services could not be loaded. Reload the page to try again.' }));
    getSettings()
      .then((data) => !cancelled && setSettings({ loaded: true, countersEnabled: data.counters_enabled === true, error: null }))
      .catch(() => !cancelled && setSettings({ loaded: false, countersEnabled: false, error: 'The counter setting could not be loaded, so a transaction cannot be started yet. Reload the page to try again.' }));
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const selected = useMemo(() => services.items.find((s) => s.service_id === form.service_id) ?? null, [services.items, form.service_id]);
  const visibleServices = useMemo(() => {
    const matches = filterServices(services.items, search);
    return selected && !matches.includes(selected) ? [selected, ...matches] : matches;
  }, [services.items, search, selected]);
  const items = useMemo(() => requirementItems(documents.items), [documents.items]);
  const countersEnabled = settings.countersEnabled;

  // Loads what depends on the chosen service: its standard in force today, its documents and (if used) its office's counters.
  async function loadForService(serviceId, officeId) {
    const request = ++latestService.current;
    const current = () => request === latestService.current;
    setStandard({ state: 'loading', data: null, kind: null, message: null });
    setDocuments({ state: 'loading', items: [], message: null });
    setCounters({ state: countersEnabled ? 'loading' : 'idle', items: [], message: null });
    const [standardResult, detailResult, counterResult] = await Promise.allSettled([
      getServiceStandard(serviceId),
      getServiceDetail(serviceId),
      countersEnabled ? listCounters(officeId) : Promise.resolve(null),
    ]);
    if (!current()) return;
    if (standardResult.status === 'fulfilled') setStandard({ state: 'ready', data: standardResult.value, kind: null, message: null });
    else {
      const { kind, message } = standardLoadResult(standardResult.reason);
      setStandard({ state: 'blocked', data: null, kind, message });
    }
    if (detailResult.status === 'fulfilled') setDocuments({ state: 'ready', items: detailResult.value.documents ?? [], message: null });
    else setDocuments({ state: 'failed', items: [], message: 'The required documents could not be loaded, so a transaction cannot be started. Please try again.' });
    if (countersEnabled) {
      if (counterResult.status === 'fulfilled') setCounters({ state: 'ready', items: (counterResult.value?.items ?? []).filter((c) => c.is_active), message: null });
      else setCounters({ state: 'failed', items: [], message: 'The counters could not be loaded. Please try again.' });
    }
  }

  function chooseService(serviceId) {
    setBanner(null);
    setFieldErrors({});
    setChecks({});
    setForm((f) => ({ ...f, service_id: serviceId, counter_id: '' }));
    const service = services.items.find((s) => s.service_id === serviceId);
    if (!service) {
      latestService.current += 1;
      setStandard({ state: 'idle', data: null, kind: null, message: null });
      setDocuments({ state: 'idle', items: [], message: null });
      setCounters({ state: 'idle', items: [], message: null });
      return;
    }
    loadForService(serviceId, service.office_id);
    if (past.enabled) loadPastStandard(serviceId, past.started_at);
  }

  const set = (name) => (e) => {
    setForm((f) => ({ ...f, [name]: e.target.value }));
    setFieldErrors((errors) => ({ ...errors, [name]: undefined }));
  };

  // The standard of the day of the typed start, from Core (the date is exactly what the person typed; nothing is worked out here).
  async function loadPastStandard(serviceId, startedAt) {
    const request = ++latestPastStandard.current;
    const date = manilaDateOf(startedAt);
    if (!serviceId || !date) {
      setPastStandard({ state: 'idle', data: null, message: null });
      return;
    }
    setPastStandard({ state: 'loading', data: null, message: null });
    try {
      const data = await getServiceStandardAsOf(serviceId, date);
      if (request === latestPastStandard.current) setPastStandard({ state: 'ready', data, message: null });
    } catch (err) {
      if (request !== latestPastStandard.current) return;
      const { message } = standardLoadResult(err);
      setPastStandard({ state: 'blocked', data: null, message: err?.status === 404 && err.code === 'STANDARD_NOT_FOUND' ? `No standard was in force for this service on ${formatDate(date)}.` : message });
    }
  }

  function setPastField(name, value) {
    setPast((p) => ({ ...p, [name]: value }));
    setFieldErrors((errors) => ({ ...errors, [name]: undefined }));
    if (name === 'started_at') loadPastStandard(form.service_id, value);
  }

  function togglePast(enabled) {
    setBanner(null);
    setFieldErrors({});
    setPast(enabled ? { ...past, enabled: true } : { ...EMPTY_PAST });
    if (enabled) loadPastStandard(form.service_id, past.started_at);
    else {
      latestPastStandard.current += 1;
      setPastStandard({ state: 'idle', data: null, message: null });
      setLock(null);
    }
  }

  function validatePastField(name) {
    const found = backdateErrors(past, Date.now())[name];
    setFieldErrors((errors) => ({ ...errors, [name]: found }));
  }

  // After an unclear write: look at what is saved for this service on that day before anything can be sent again.
  async function checkSavedRecords() {
    const date = manilaDateOf(past.started_at);
    if (!date || !form.service_id) return;
    setLock((l) => ({ ...l, state: 'loading' }));
    try {
      const data = await listRecordsOnDate({ serviceId: form.service_id, date });
      setLock({ checked: true, state: 'done', records: data.items ?? [] });
    } catch {
      setLock({ checked: false, state: 'failed', records: [] });
    }
  }

  const documentsReady = documents.state === 'ready';
  // In past mode "idle" means no valid start date has been typed yet: Start stays available so that its message can say so.
  const standardOk = past.enabled ? pastStandard.state === 'ready' || pastStandard.state === 'idle' : standard.state === 'ready';
  const locked = Boolean(lock) && !lock.checked;
  const ready = Boolean(form.service_id) && standardOk && documentsReady && allConfirmed(items, checks) && !locked;

  function focusFirst(errors) {
    const first = FIELD_ORDER.find((key) => errors[key]);
    const target = first && document.getElementById(FIELD_ID[first] ?? 'start-service');
    if (target) target.focus();
  }

  async function explainConflict(kind) {
    try {
      const open = await listOpenTransactions({ counterId: kind === 'counter_busy' ? form.counter_id : undefined });
      return conflictTransaction(kind, open, user.id);
    } catch {
      return null; // the message alone is still true
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (submittingRef.current || locked) return; // locked: an earlier past write is unconfirmed, so check the saved records first
    setBanner(null);
    const errors = { ...startErrors({ form, standard: past.enabled ? pastStandard.data : standard.data, items, checks, countersEnabled }), ...backdateErrors(past, Date.now()) };
    if (past.enabled && errors.started_at) delete errors.standard; // the missing start is the real reason; say that one
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      focusFirst(errors);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const transaction = await postTransaction(withBackdate(buildStartBody({ form, countersEnabled }), past));
      setLock(null);
      setResult(transaction);
    } catch (err) {
      const { kind, fieldErrors: fields, message: baseMessage } = startErrorResult(err);
      const message = past.enabled && kind === 'standard' ? pastStandardMessage(err) ?? baseMessage : baseMessage;
      if (past.enabled && isAmbiguousWrite(err)) setLock({ checked: false, state: 'idle', records: [] });
      setFieldErrors(fields);
      const conflict = kind === 'open' || kind === 'counter_busy' ? await explainConflict(kind) : null;
      setBanner(message ? { kind, message, conflict } : null);
      if (Object.keys(fields).length) focusFirst(fields);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function startAnother() {
    latestService.current += 1;
    setResult(null);
    setForm({ ...EMPTY_START_FORM });
    setChecks({});
    setSearch('');
    setFieldErrors({});
    setBanner(null);
    setStandard({ state: 'idle', data: null, kind: null, message: null });
    setDocuments({ state: 'idle', items: [], message: null });
    setCounters({ state: 'idle', items: [], message: null });
    setPast({ ...EMPTY_PAST });
    setPastStandard({ state: 'idle', data: null, message: null });
    setLock(null);
  }

  // ---- The transaction that was just started, exactly as the server returned it ----
  if (result) {
    return (
      <div className="space-y-4">
        <StatusBanner variant="success" message={result.is_backdated === true ? (result.ended_at ? 'The past transaction has been recorded.' : 'The past transaction has been started.') : 'The transaction has been started.'} />
        <section className="card p-6" aria-labelledby="started-heading">
          <h2 id="started-heading" className="text-lg">Tracking number</h2>
          <p className="mt-1 font-mono text-2xl font-semibold text-slate-900" data-testid="tracking-no">{result.tracking_no}</p>
          <p className="mt-1 text-sm text-slate-600">
            Status: <span className="font-semibold text-slate-900" data-testid="status">{statusLabel(result.status)}</span>
          </p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service</dt>
              <dd className="text-sm text-slate-800">{result.service_name} ({result.service_code})</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Office</dt>
              <dd className="text-sm text-slate-800">{result.office_code}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standard saved with it</dt>
              <dd className="text-sm text-slate-800">{formatStandardDuration({ duration_days: result.standard_duration_days, duration_hours: result.standard_duration_hours, duration_minutes: result.standard_duration_minutes })}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Started</dt>
              <dd className="text-sm text-slate-800">{formatDateTime(result.started_at) || '-'} (Asia/Manila)</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client type</dt>
              <dd className="text-sm text-slate-800">{clientTypeLabel(result.client_type)}</dd>
            </div>
            {result.ended_at ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ended</dt>
                <dd className="text-sm text-slate-800" data-testid="ended-at">{formatDateTime(result.ended_at) || '-'} (Asia/Manila)</dd>
              </div>
            ) : null}
            {result.is_backdated === true ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entered after the fact</dt>
                <dd className="text-sm text-slate-800" data-testid="backdated">Yes{result.backdate_reason ? <span className="block whitespace-pre-line text-xs text-slate-600" data-testid="backdate-reason">{result.backdate_reason}</span> : null}</dd>
              </div>
            ) : null}
            {result.counter_label ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Counter</dt>
                <dd className="text-sm text-slate-800">{result.counter_label}</dd>
              </div>
            ) : null}
          </dl>
          {complianceState(result) !== 'none' ? (
            <div className="mt-5 border-t border-line pt-4" data-testid="compliance">
              <h3 className="text-sm font-semibold text-slate-700">Compliance</h3>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <StatusBadge variant={complianceState(result)}><span data-testid="compliance-label">{COMPLIANCE_LABELS[complianceState(result)]}</span></StatusBadge>
                {describeElapsed(result.elapsed_working_minutes) ? <span className="text-sm text-slate-700" data-testid="elapsed">{describeElapsed(result.elapsed_working_minutes)} of working time</span> : null}
                {describeVariance(result.variance_minutes) ? <span className="text-sm text-slate-700" data-testid="variance">{describeVariance(result.variance_minutes)}</span> : null}
              </div>
              {complianceState(result) === 'pending' ? <p className="mt-2 text-sm text-slate-600">The result has not been computed yet. Open the transaction later to see it.</p> : null}
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" onClick={startAnother}>
              Start another transaction
            </button>
            {result.transaction_id ? (
              <Link href={`/transactions/${result.transaction_id}`} className="btn-secondary">
                View transaction
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  const std = standard.data;
  return (
    <form className="space-y-4" noValidate onSubmit={submit} aria-label="Start a transaction">
      {services.error ? <StatusBanner variant="error" message={services.error} /> : null}
      {settings.error ? <StatusBanner variant="error" message={settings.error} /> : null}
      {banner ? (
        <StatusBanner variant="error" onDismiss={() => setBanner(null)} dismissAriaLabel="Dismiss error">
          <span className="block font-semibold" data-testid="start-error">{banner.message}</span>
          {banner.conflict ? (
            <span className="mt-1 block" data-testid="conflict">
              Open transaction: <span className="font-mono font-semibold">{banner.conflict.tracking_no}</span> ({statusLabel(banner.conflict.status)})
            </span>
          ) : null}
        </StatusBanner>
      ) : null}

      <Section title="Service" id="service-heading">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <div>
            <label className="label" htmlFor="start-filter">Find a service</label>
            <input id="start-filter" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code or office" autoComplete="off" disabled={services.loading} />
          </div>
          <div>
            <label className="label" htmlFor="start-service">Service</label>
            <select
              id="start-service"
              className="input"
              value={form.service_id}
              onChange={(e) => chooseService(e.target.value)}
              disabled={services.loading || services.items.length === 0}
              aria-invalid={fieldErrors.service ? true : undefined}
              aria-describedby={fieldErrors.service ? 'start-service-error' : undefined}
            >
              <option value="">{services.loading ? 'Loading services…' : services.items.length === 0 ? 'No active services' : 'Select a service'}</option>
              {visibleServices.map((service) => (
                <option key={service.service_id} value={service.service_id}>
                  {serviceOptionLabel(service)}
                </option>
              ))}
            </select>
            <FieldError id="start-service-error">{fieldErrors.service}</FieldError>
            {!services.loading && search.trim() && visibleServices.length === 0 ? <p className="mt-1 text-xs text-slate-500">No service matches &ldquo;{search.trim()}&rdquo;.</p> : null}
          </div>
        </div>
      </Section>

      <Section title="Record past transaction" id="past-heading">
        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input id="start-past" type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#800000]" checked={past.enabled} onChange={(e) => togglePast(e.target.checked)} />
          <span>
            This transaction already happened. I am entering its time after the fact.
            <span className="block text-xs text-slate-500">All times are Manila time (Asia/Manila). The standard in force on the day of the start is applied by the system.</span>
          </span>
        </label>
        {past.enabled ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="start-past-start">Started (Manila time)</label>
                <input id="start-past-start" type="datetime-local" className="input" value={past.started_at} onChange={(e) => setPastField('started_at', e.target.value)} onBlur={() => validatePastField('started_at')} aria-invalid={fieldErrors.started_at ? true : undefined} aria-describedby={fieldErrors.started_at ? 'start-past-start-error' : undefined} />
                <FieldError id="start-past-start-error">{fieldErrors.started_at}</FieldError>
              </div>
              <div>
                <label className="flex items-center gap-2 pt-6 text-sm text-slate-800">
                  <input id="start-manual-end" type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#800000]" checked={past.manual_end} onChange={(e) => setPast((p) => ({ ...p, manual_end: e.target.checked, ended_at: e.target.checked ? p.ended_at : '' }))} />
                  Enter end time manually
                </label>
              </div>
            </div>
            {past.manual_end ? (
              <div className="sm:w-1/2">
                <label className="label" htmlFor="start-past-end">Ended (Manila time)</label>
                <input id="start-past-end" type="datetime-local" className="input" value={past.ended_at} onChange={(e) => setPastField('ended_at', e.target.value)} onBlur={() => validatePastField('ended_at')} aria-invalid={fieldErrors.ended_at ? true : undefined} aria-describedby={fieldErrors.ended_at ? 'start-past-end-error' : undefined} />
                <FieldError id="start-past-end-error">{fieldErrors.ended_at}</FieldError>
                <p className="mt-1 text-xs text-slate-500">With an end time, the transaction is recorded as completed in one step and the system works out the result.</p>
              </div>
            ) : null}
            <div>
              <label className="label" htmlFor="start-past-reason">Why is this entered after the fact?</label>
              <textarea id="start-past-reason" className="input min-h-20" value={past.reason} maxLength={BACKDATE_REASON_MAX} onChange={(e) => setPastField('reason', e.target.value)} onBlur={() => validatePastField('backdate_reason')} aria-invalid={fieldErrors.backdate_reason ? true : undefined} aria-describedby={fieldErrors.backdate_reason ? 'start-past-reason-error' : undefined} />
              <FieldError id="start-past-reason-error">{fieldErrors.backdate_reason}</FieldError>
            </div>
          </div>
        ) : null}
      </Section>

      {lock ? (
        <section className="card border-amber-300 p-5" aria-labelledby="lock-heading" data-testid="unclear-write">
          <h2 id="lock-heading" className="mb-2 text-lg">Check before trying again</h2>
          <p className="text-sm text-slate-700">{BACKDATE_MESSAGES.ambiguous}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" onClick={checkSavedRecords} disabled={lock.state === 'loading' || !manilaDateOf(past.started_at)}>
              {lock.state === 'loading' ? 'Checking…' : lock.checked ? 'Check again' : 'Check saved records'}
            </button>
            {lock.state === 'failed' ? <span className="text-sm text-red-700">{BACKDATE_MESSAGES.checkFailed}</span> : null}
          </div>
          {lock.checked ? (
            <div className="mt-3 text-sm text-slate-700" data-testid="saved-records">
              {lock.records.length === 0 ? <p>No record of this service starting on that day was found. You can submit again.</p> : (
                <>
                  <p>Records of this service that started on that day (if yours is here, do not submit again):</p>
                  <ul className="mt-2 space-y-1">
                    {lock.records.map((r) => (
                      <li key={r.transaction_id}>
                        <span className="font-mono font-semibold">{r.tracking_no}</span> ({statusLabel(r.status)}, started {formatDateTime(r.started_at) || '-'}){r.is_backdated ? ', entered after the fact' : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      <Section title={past.enabled ? 'Standard in force on the day of the start' : 'Standard in force today'} id="standard-heading">
        {past.enabled ? (
          <div aria-live="polite">
            {pastStandard.state === 'idle' ? <p className="text-sm text-slate-500">Enter the start date to see the standard in force that day.</p> : null}
            {pastStandard.state === 'loading' ? <p className="text-sm text-slate-500">Loading the standard…</p> : null}
            {pastStandard.state === 'blocked' ? <StatusBanner variant="error" message={pastStandard.message} /> : null}
            {pastStandard.state === 'ready' && pastStandard.data ? (
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standard time</dt>
                  <dd className="text-sm font-semibold text-slate-900" data-testid="past-standard-duration">{formatStandardDuration(pastStandard.data)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Classification</dt>
                  <dd className="text-sm text-slate-800">{classificationLabel(pastStandard.data.classification)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Office</dt>
                  <dd className="text-sm text-slate-800">{pastStandard.data.office_code}</dd>
                </div>
              </dl>
            ) : null}
            <FieldError id="start-standard-error">{fieldErrors.standard}</FieldError>
          </div>
        ) : (
        <>
        <div aria-live="polite">
          {standard.state === 'idle' ? <p className="text-sm text-slate-500">Choose a service to see its standard.</p> : null}
          {standard.state === 'loading' ? <p className="text-sm text-slate-500">Loading the standard…</p> : null}
          {standard.state === 'blocked' ? (
            <div className="space-y-3">
              <StatusBanner variant="error" message={standard.message} />
              {standard.kind === 'unavailable' ? (
                <button type="button" className="btn-secondary" onClick={() => loadForService(form.service_id, selected?.office_id)}>
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
          {standard.state === 'ready' && std ? (
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standard time</dt>
                <dd className="text-sm font-semibold text-slate-900" data-testid="standard-duration">{formatStandardDuration(std)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Classification</dt>
                <dd className="text-sm text-slate-800">{classificationLabel(std.classification)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Office</dt>
                <dd className="text-sm text-slate-800">{std.office_code}</dd>
              </div>
            </dl>
          ) : null}
        </div>
        {standard.state === 'ready' ? <p className="mt-3 text-xs text-slate-500">This standard is saved with the transaction when you start it, so later changes to the Charter do not change it.</p> : null}
        <FieldError id="start-standard-error">{fieldErrors.standard}</FieldError>
        </>
        )}
      </Section>

      <Section title="Required documents" id="documents-heading">
        <fieldset id="start-requirements" tabIndex={-1} aria-describedby={fieldErrors.requirements ? 'start-requirements-error' : undefined} className="focus:outline-none">
          <legend className="sr-only">Confirm each required document is present</legend>
          {documents.state === 'idle' ? <p className="text-sm text-slate-500">Choose a service to see its required documents.</p> : null}
          {documents.state === 'loading' ? <p className="text-sm text-slate-500">Loading the required documents…</p> : null}
          {documents.state === 'failed' ? (
            <div className="space-y-3">
              <StatusBanner variant="error" message={documents.message} />
              <button type="button" className="btn-secondary" onClick={() => loadForService(form.service_id, selected?.office_id)}>
                Try again
              </button>
            </div>
          ) : null}
          {documentsReady ? (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-3 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#800000]"
                      checked={checks[item.id] === true}
                      onChange={(e) => {
                        setChecks((c) => ({ ...c, [item.id]: e.target.checked }));
                        setFieldErrors((errors) => ({ ...errors, requirements: undefined }));
                      }}
                    />
                    <span>
                      {item.label}
                      {item.notes ? <span className="block text-xs text-slate-500">{item.notes}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>
        <FieldError id="start-requirements-error">{fieldErrors.requirements}</FieldError>
      </Section>

      <Section title="Client" id="client-heading">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="start-client-type">Client type</label>
            <select id="start-client-type" className="input" value={form.client_type} onChange={set('client_type')} required aria-invalid={fieldErrors.client_type ? true : undefined} aria-describedby={fieldErrors.client_type ? 'start-client-type-error' : undefined}>
              <option value="">Select a client type</option>
              {CLIENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <FieldError id="start-client-type-error">{fieldErrors.client_type}</FieldError>
          </div>
          <div>
            <label className="label" htmlFor="start-reference">Client reference (optional)</label>
            <input id="start-reference" className="input" value={form.client_reference} onChange={set('client_reference')} maxLength={REFERENCE_MAX} autoComplete="off" aria-invalid={fieldErrors.client_reference ? true : undefined} aria-describedby={fieldErrors.client_reference ? 'start-reference-error' : undefined} />
            <FieldError id="start-reference-error">{fieldErrors.client_reference}</FieldError>
          </div>
          <div>
            <label className="label" htmlFor="start-email">Client email (optional)</label>
            <input id="start-email" type="email" className="input" value={form.client_email} onChange={set('client_email')} maxLength={EMAIL_MAX} autoComplete="off" aria-invalid={fieldErrors.client_email ? true : undefined} aria-describedby={fieldErrors.client_email ? 'start-email-error' : undefined} />
            <FieldError id="start-email-error">{fieldErrors.client_email}</FieldError>
          </div>
        </div>
      </Section>

      {countersEnabled ? (
        <Section title="Counter" id="counter-heading">
          <div className="w-full sm:w-80">
            <label className="label" htmlFor="start-counter">Your counter</label>
            <select
              id="start-counter"
              className="input"
              value={form.counter_id}
              onChange={set('counter_id')}
              disabled={counters.state !== 'ready' || counters.items.length === 0}
              aria-invalid={fieldErrors.counter ? true : undefined}
              aria-describedby={fieldErrors.counter ? 'start-counter-error' : undefined}
            >
              <option value="">
                {counters.state === 'idle' ? 'Choose a service first' : counters.state === 'loading' ? 'Loading counters…' : counters.items.length === 0 ? 'No active counters' : 'Select your counter'}
              </option>
              {counters.items.map((counter) => (
                <option key={counter.counter_id} value={counter.counter_id}>{counter.label}</option>
              ))}
            </select>
            <FieldError id="start-counter-error">{fieldErrors.counter}</FieldError>
            {counters.state === 'failed' ? <p className="mt-1 text-xs text-red-700">{counters.message}</p> : null}
            {counters.state === 'ready' && counters.items.length === 0 ? <p className="mt-1 text-xs text-slate-500">This office has no active counters. Ask a Super Admin to add one.</p> : null}
          </div>
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={submitting || !ready || !settings.loaded}>
          {submitting ? 'Starting…' : past.enabled ? (past.manual_end ? 'Record past transaction' : 'Start past transaction') : 'Start transaction'}
        </button>
        {!ready && form.service_id ? <span className="text-sm text-slate-500">Confirm every required document to continue.</span> : null}
      </div>
    </form>
  );
}

export default function StartTransactionPage() {
  return (
    <AppShell
      title="Start transaction"
      subtitle="Record a new service transaction. The standard in force today is saved with it."
      breadcrumb={[{ label: 'Transactions', href: '/transactions' }, { label: 'Add Transaction' }]}
      allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}
    >
      {(user) => <StartTransaction user={user} />}
    </AppShell>
  );
}
