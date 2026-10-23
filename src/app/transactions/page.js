'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import TableState from '../../components/ui/TableState.js';
import Pager from '../../components/navigation/Pager.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { listCounters } from '../../lib/api/operations.js';
import { listStartableServices, listTransactionPage } from '../../lib/api/transactions.js';
import { apiFetch } from '../../lib/auth/session.js';
import { COMPLIANCE_LABELS, complianceState } from '../../lib/ui/complete-transaction.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { EMPTY_TX_FILTERS, STATUS_OPTIONS, TRACKING_MAX, emptyMessage, filterErrors, filtersToSearch, hasFilters, listErrorResult, searchToFilters, transactionHref } from '../../lib/ui/transaction-list.js';
import { serviceOptionLabel, statusLabel } from '../../lib/ui/start-transaction.js';

const COLUMNS = 8;
const EMPTY_PAGE = { items: [], total: 0, page: 1 };

/** Role-scoped list: the service decides which rows this person may see; filters, order and paging are all the service's. */
function TransactionList({ user }) {
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  // Where the list starts: the filters and page in the address (so Back from a transaction returns to the same view).
  const address = useSearchParams().toString();
  const [start] = useState(() => searchToFilters(address));
  const [draft, setDraft] = useState(start.filters);
  const [applied, setApplied] = useState(start.filters);
  const [pageSize, setPageSize] = useState(start.pageSize);
  const [fieldErrors, setFieldErrors] = useState({});
  const [state, setState] = useState({ loading: true, ...EMPTY_PAGE, error: null });
  const [options, setOptions] = useState({ services: [], counters: [], offices: [] });
  const latest = useRef(0); // the newest request; an older answer that arrives late is thrown away

  async function run(filters, page, size) {
    const id = ++latest.current;
    setApplied(filters);
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listTransactionPage(filters, page, size);
      if (id !== latest.current) return;
      setState({ loading: false, items: data.items ?? [], total: data.total ?? 0, page: data.page ?? page, error: null });
      window.history.replaceState(null, '', `${window.location.pathname}${filtersToSearch(filters, page, size)}`);
    } catch (err) {
      if (id !== latest.current) return;
      const { message, fieldErrors: fields } = listErrorResult(err);
      setFieldErrors(fields);
      setState({ loading: false, ...EMPTY_PAGE, error: message ?? 'Please correct the highlighted filters.' });
    }
  }

  // First load, plus the choices for the Service, Counter and (Super Admin) Office filters. The choices are a convenience:
  // if one list cannot be loaded the filter just has fewer options and the table still works.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the list the address bar describes
    run(start.filters, start.page, start.pageSize);
    Promise.allSettled([listStartableServices({ isSuperAdmin }), listCounters(undefined), isSuperAdmin ? apiFetch(OFFICES_API) : Promise.resolve(null)]).then(([services, counters, offices]) => {
      if (cancelled) return;
      setOptions({
        services: services.status === 'fulfilled' ? services.value : [],
        counters: counters.status === 'fulfilled' ? counters.value?.items ?? [] : [],
        offices: offices.status === 'fulfilled' ? offices.value?.items ?? [] : [],
      });
    });
    return () => {
      cancelled = true;
      latest.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once: the starting view never changes
  }, [isSuperAdmin]);

  function apply(event) {
    event.preventDefault();
    const errors = filterErrors(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    run(draft, 1, pageSize); // any change of filters starts again at page 1
  }

  function clear() {
    setDraft({ ...EMPTY_TX_FILTERS });
    setFieldErrors({});
    run({ ...EMPTY_TX_FILTERS }, 1, pageSize);
  }

  function changePageSize(value) {
    const size = Number(value);
    setPageSize(size);
    run(applied, 1, size);
  }

  const set = (name) => (e) => {
    setDraft({ ...draft, [name]: e.target.value });
    setFieldErrors((errors) => ({ ...errors, [name]: undefined }));
  };
  const fieldError = (name) => (fieldErrors[name] ? <p id={`tx-${name}-error`} className="mt-1 text-xs text-red-700">{fieldErrors[name]}</p> : null);
  const describedBy = (name, extra) => [fieldErrors[name] ? `tx-${name}-error` : null, extra].filter(Boolean).join(' ') || undefined;
  const filtered = hasFilters(applied);
  const showCounter = options.counters.length > 0;

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((current) => ({ ...current, error: null }))} />

      <form className="card p-4" onSubmit={apply} noValidate aria-label="Filter the transactions">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-full sm:w-44">
            <label className="label" htmlFor="tx-q">Tracking number</label>
            <input id="tx-q" className="input" value={draft.q} onChange={set('q')} maxLength={TRACKING_MAX} placeholder="Full or the start" autoComplete="off" spellCheck={false} aria-invalid={fieldErrors.q ? true : undefined} aria-describedby={describedBy('q')} />
            {fieldError('q')}
          </div>
          <div className="w-full sm:w-36">
            <label className="label" htmlFor="tx-status">Status</label>
            <select id="tx-status" className="input" value={draft.status} onChange={set('status')} aria-invalid={fieldErrors.status ? true : undefined} aria-describedby={describedBy('status')}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {fieldError('status')}
          </div>
          <div className="w-full sm:w-56">
            <label className="label" htmlFor="tx-service">Service</label>
            <select id="tx-service" className="input" value={draft.service_id} onChange={set('service_id')} aria-invalid={fieldErrors.service_id ? true : undefined} aria-describedby={describedBy('service_id')}>
              <option value="">All services</option>
              {options.services.map((s) => <option key={s.service_id} value={s.service_id}>{serviceOptionLabel(s)}</option>)}
            </select>
            {fieldError('service_id')}
          </div>
          {isSuperAdmin ? (
            <div className="w-full sm:w-44">
              <label className="label" htmlFor="tx-office">Office</label>
              <select id="tx-office" className="input" value={draft.office_id} onChange={set('office_id')} aria-invalid={fieldErrors.office_id ? true : undefined} aria-describedby={describedBy('office_id')}>
                <option value="">All offices</option>
                {options.offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.office_code}</option>)}
              </select>
              {fieldError('office_id')}
            </div>
          ) : null}
          {showCounter ? (
            <div className="w-full sm:w-40">
              <label className="label" htmlFor="tx-counter">Counter</label>
              <select id="tx-counter" className="input" value={draft.counter_id} onChange={set('counter_id')} aria-invalid={fieldErrors.counter_id ? true : undefined} aria-describedby={describedBy('counter_id')}>
                <option value="">All counters</option>
                {options.counters.map((c) => <option key={c.counter_id} value={c.counter_id}>{c.label}{c.is_active ? '' : ' (inactive)'}</option>)}
              </select>
              {fieldError('counter_id')}
            </div>
          ) : null}
          <div className="flex items-center gap-3 sm:mt-[21px]">
            <button
              type={filtered ? 'button' : 'submit'}
              className={filtered ? 'btn border border-maroon-800 bg-transparent px-3! text-maroon-800 hover:bg-maroon-50' : 'btn-primary px-3!'}
              onClick={filtered ? clear : undefined}
              disabled={state.loading}
            >
              {filtered ? 'Clear filters' : 'Apply filters'}
            </button>
          </div>
          <AddTransactionButton className="w-full justify-center sm:ml-auto sm:mt-[21px] sm:w-auto" />
        </div>
      </form>

      <TableShell
        footer={<Pager page={state.page} pageSize={pageSize} total={state.total} onPage={(next) => run(applied, next, pageSize)} onPageSizeChange={changePageSize} loading={state.loading} />}
      >
        <Table
          minWidth="52rem"
          busy={state.loading}
          head={
            <tr>
              <Th>Tracking number</Th>
              <Th>Service</Th>
              <Th>Office</Th>
              <Th>Counter</Th>
              <Th>Status</Th>
              <Th>Started</Th>
              <Th>Ended</Th>
              <Th>Result</Th>
            </tr>
          }
        >
          {state.loading && state.items.length === 0 ? (
            <TableState colSpan={COLUMNS} kind="loading">Loading transactions...</TableState>
          ) : state.items.length === 0 ? (
            <TableState colSpan={COLUMNS}>{emptyMessage({ error: state.error, filtered })}</TableState>
          ) : (
            state.items.map((t) => {
              const result = complianceState(t);
              return (
                <tr key={t.transaction_id} className="tr-row" data-testid="tx-row">
                  <td className="td">
                    <Link href={transactionHref(t.transaction_id, filtersToSearch(applied, state.page, pageSize))} className="font-mono font-semibold text-maroon-800 underline-offset-2 hover:underline">{t.tracking_no}</Link>
                    {t.is_backdated === true ? <span className="block text-xs text-slate-500">Entered after the fact</span> : null}
                  </td>
                  <td className="td">
                    <span className="block font-semibold text-slate-900">{t.service_name}</span>
                    <span className="block text-slate-500">{t.service_code}</span>
                  </td>
                  <td className="td"><span className="block font-semibold text-slate-900">{t.office_code}</span></td>
                  <td className="td">{t.counter_label || '-'}</td>
                  <td className="td"><StatusBadge variant={String(t.status).toLowerCase()}>{statusLabel(t.status)}</StatusBadge></td>
                  <td className="td whitespace-nowrap">{formatDateTime(t.started_at) || '-'}</td>
                  <td className="td whitespace-nowrap">{formatDateTime(t.ended_at) || '-'}</td>
                  <td className="td">{result === 'none' ? '-' : <StatusBadge variant={result}>{COMPLIANCE_LABELS[result]}</StatusBadge>}</td>
                </tr>
              );
            })
          )}
        </Table>
      </TableShell>
    </div>
  );
}

/**
 * The way into starting a transaction. It is only a link to /transactions/new: that page limits itself to Super Admin, Office Head and
 * Office Staff, and the Operations service decides again on every request, so showing or hiding this button grants nothing.
 */
/** The way into Transaction Settings (/settings): an icon at the right of the page heading. The page checks the role itself and the service decides what can be changed. */
function SettingsLink() {
  return (
    <Link href="/settings" className="btn-secondary h-10 w-10 px-0" aria-label="Transaction Settings" title="Transaction Settings" data-testid="transaction-settings">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6" />
      </svg>
    </Link>
  );
}

function AddTransactionButton({ className = '' }) {
  return (
    <Link href="/transactions/new" className={`btn-primary ${className}`.trim()} data-testid="add-transaction">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M10 4v12M4 10h12" />
      </svg>
      Add Transaction
    </Link>
  );
}

export default function TransactionsPage() {
  return (
    <AppShell
      title="Transactions"
      subtitle="Newest first. You only see the transactions your role allows. Dates are Manila calendar days (Asia/Manila)."
      allowedRoles={[ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]}
      headerRight={<SettingsLink />}
    >
      {(user) => (
        <Suspense fallback={null}>
          <TransactionList user={user} />
        </Suspense>
      )}
    </AppShell>
  );
}
