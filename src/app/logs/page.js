'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ROLES, ROLE_LABELS } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import AuditValue from '../../components/ui/AuditValue.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import TableState from '../../components/ui/TableState.js';
import Pager from '../../components/navigation/Pager.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { ACCOUNTS_API } from '../../lib/api/identity.js';
import { listAuditEvents } from '../../lib/api/logs.js';
import { apiFetch } from '../../lib/auth/session.js';
import {
  EMPTY_AUDIT_FILTERS,
  actorOf,
  auditErrorResult,
  auditFilterErrors,
  auditValueTree,
  buildNameMap,
  entityName,
  entityTypeLabel,
  searchProblem,
  searchToFilters,
  shortId,
  splitDateTime,
} from '../../lib/ui/audit-log.js';
import { formatDateTime } from '../../lib/ui/date-format.js';

const COLUMNS = 6;
const EMPTY_PAGE = { items: [], total: 0, page: 1 };

/** Read-only audit log: search and dates go to the service (never filtering one loaded page), newest first, expandable before/after. */
function AuditLog() {
  const [draft, setDraft] = useState({ search: '', from: '', to: '' });
  const [applied, setApplied] = useState({ ...EMPTY_AUDIT_FILTERS });
  const [appliedSearch, setAppliedSearch] = useState(null); // { text, field, value } for the status line
  const [pageSize, setPageSize] = useState(10);
  const [fieldErrors, setFieldErrors] = useState({});
  const [state, setState] = useState({ loading: true, ...EMPTY_PAGE, error: null });
  const [expanded, setExpanded] = useState(() => new Set());
  const [offices, setOffices] = useState(() => new Map());
  const [accounts, setAccounts] = useState([]);
  const [seen, setSeen] = useState({ actions: [], types: [] });
  const latest = useRef(0); // the newest request; an older answer that arrives late is thrown away

  function accept(data, page) {
    setState({ loading: false, items: data.items ?? [], total: data.total ?? 0, page: data.page ?? page, error: null });
    setExpanded(new Set());
    setSeen((current) => {
      const merge = (known, values) => [...new Set([...known, ...values.filter(Boolean)])].sort();
      return { actions: merge(current.actions, (data.items ?? []).map((e) => e.action)), types: merge(current.types, (data.items ?? []).map((e) => e.entity_type)) };
    });
  }

  // First load (newest entries, no filters), plus the office and account names shown in the table.
  useEffect(() => {
    let cancelled = false;
    const id = ++latest.current;
    listAuditEvents(EMPTY_AUDIT_FILTERS, 1, apiFetch, 10)
      .then((data) => {
        if (!cancelled && id === latest.current) accept(data, 1);
      })
      .catch((err) => {
        if (cancelled || id !== latest.current) return;
        setState({ loading: false, ...EMPTY_PAGE, error: auditErrorResult(err).message });
      });
    apiFetch(OFFICES_API)
      .then((data) => !cancelled && setOffices(new Map((data.items ?? []).map((o) => [o.office_id, { code: o.office_code, name: o.office_name }]))))
      .catch(() => {}); // names are a convenience; the ID is shown without them
    apiFetch(`${ACCOUNTS_API}?page_size=100`)
      .then((data) => !cancelled && setAccounts(data.items ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const names = useMemo(() => buildNameMap(accounts, state.items), [accounts, state.items]);

  async function run(filters, page, search = appliedSearch, requestedPageSize = pageSize) {
    const id = ++latest.current;
    setApplied(filters);
    setAppliedSearch(search);
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await listAuditEvents(filters, page, apiFetch, requestedPageSize);
      if (id === latest.current) accept(data, page);
    } catch (err) {
      if (id !== latest.current) return;
      const { message, fieldErrors: fields } = auditErrorResult(err);
      setFieldErrors({ ...(fields.from ? { from: fields.from } : {}), ...(fields.to ? { to: fields.to } : {}), ...(fields.actor || fields.action || fields.entity_type ? { search: fields.actor ?? fields.action ?? fields.entity_type } : {}) });
      setState({ loading: false, ...EMPTY_PAGE, error: message });
    }
  }

  function apply(event) {
    event.preventDefault();
    const match = searchToFilters(draft.search, seen);
    const filters = { ...EMPTY_AUDIT_FILTERS, ...match.filter, from: draft.from, to: draft.to };
    const errors = auditFilterErrors(filters);
    const tooLong = searchProblem(draft.search);
    if (tooLong) errors.search = tooLong;
    delete errors.actor;
    delete errors.action;
    delete errors.entity_type;
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    // A new search or date range always starts again at page 1.
    run(filters, 1, match.field ? { text: draft.search.trim(), field: match.field, value: match.value } : null);
  }

  function clear() {
    setDraft({ search: '', from: '', to: '' });
    setFieldErrors({});
    run({ ...EMPTY_AUDIT_FILTERS }, 1, null);
  }

  function changePageSize(value) {
    const nextPageSize = Number(value);
    setPageSize(nextPageSize);
    run(applied, 1, appliedSearch, nextPageSize);
  }

  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const set = (name) => (e) => setDraft({ ...draft, [name]: e.target.value });
  const fieldError = (name) => (fieldErrors[name] ? <p id={`audit-${name}-error`} className="mt-1 text-xs text-red-700">{fieldErrors[name]}</p> : null);
  const describedBy = (name, extra) => [fieldErrors[name] ? `audit-${name}-error` : null, extra].filter(Boolean).join(' ') || undefined;
  const filtered = Object.keys(EMPTY_AUDIT_FILTERS).some((key) => applied[key]);
  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((current) => ({ ...current, error: null }))} />

      <form className="card p-4" onSubmit={apply} noValidate aria-label="Filter the audit log">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-full sm:w-64">
            <label className="label" htmlFor="audit-search">
              Search
            </label>
            <input
              id="audit-search"
              type="text"
              className="input"
              value={draft.search}
              onChange={set('search')}
              placeholder="Search by user ID, action or entity"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={fieldErrors.search ? true : undefined}
              aria-describedby={describedBy('search', 'audit-search-help')}
            />
            <p id="audit-search-help" className="sr-only">
              Matches a full user ID, an exact action such as ACCOUNT_CREATED, or an entity type such as account. Names are not searchable.
            </p>
            {fieldError('search')}
          </div>
          <div className="w-full sm:w-36">
            <label className="label" htmlFor="audit-from">
              Start date
            </label>
            <input id="audit-from" type="date" className="input" value={draft.from} onChange={set('from')} aria-invalid={fieldErrors.from ? true : undefined} aria-describedby={describedBy('from')} />
            {fieldError('from')}
          </div>
          <div className="w-full sm:w-36">
            <label className="label" htmlFor="audit-to">
              End date
            </label>
            <input id="audit-to" type="date" className="input" value={draft.to} onChange={set('to')} aria-invalid={fieldErrors.to ? true : undefined} aria-describedby={describedBy('to')} />
            {fieldError('to')}
          </div>
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
        </div>
      </form>

      <TableShell
        footer={
          <Pager
            page={state.page}
            pageSize={pageSize}
            total={state.total}
            onPage={(nextPage) => run(applied, nextPage)}
            onPageSizeChange={changePageSize}
            loading={state.loading}
          />
        }
      >
        <Table
          minWidth="40rem"
          busy={state.loading}
          head={
            <tr>
              <Th>Date &amp; time</Th>
              <Th>Done by</Th>
              <Th>Action</Th>
              <Th>Affected entity</Th>
              <Th>Office</Th>
              <Th className="w-12">
                <span className="sr-only">Details</span>
              </Th>
            </tr>
          }
        >
              {state.loading && state.items.length === 0 ? (
                <TableState colSpan={COLUMNS} kind="loading">Loading audit log...</TableState>
              ) : state.items.length === 0 ? (
                <TableState colSpan={COLUMNS}>
                  {state.error
                    ? 'The audit log could not be loaded.'
                    : filtered
                      ? appliedSearch && !applied.from && !applied.to
                        ? `No entries match "${appliedSearch.text}". Search needs a full user ID, an exact action such as ACCOUNT_CREATED, or an entity type such as account.`
                        : 'No entries match these filters.'
                      : 'No audit entries yet.'}
                </TableState>
              ) : (
                state.items.map((event) => {
                  const open = expanded.has(event.audit_id);
                  const actorId = actorOf(event);
                  const actorNameText = names.get(event.actor_user_id) ?? '';
                  const { date, time } = splitDateTime(formatDateTime(event.occurred_at) || '-');
                  const office = event.office_id ? offices.get(event.office_id) : null;
                  const subject = entityName(event);
                  const detailId = `audit-detail-${event.audit_id}`;
                  const roleLabel = ROLE_LABELS[event.actor_role] ?? (event.actor_role === 'system' ? 'System' : event.actor_role || '');
                  return (
                    <Fragment key={event.audit_id}>
                      {/* The whole row opens and closes the details with a click; the arrow button is the keyboard and screen-reader control for the same thing. */}
                      <tr className={`tr-row cursor-pointer ${open ? 'bg-table-hover' : ''}`} onClick={() => toggle(event.audit_id)}>
                        <td className="td">
                          <span className="block whitespace-nowrap font-semibold text-slate-900">{date}</span>
                          {time ? <span className="block whitespace-nowrap text-slate-500">{time}</span> : null}
                        </td>
                        <td className="td">
                          {actorNameText ? (
                            <span className="block font-semibold text-slate-900" title={actorId || undefined}>{actorNameText}</span>
                          ) : (
                            <span className="block font-mono font-semibold text-slate-900" title={actorId || undefined}>{shortId(actorId) || '-'}</span>
                          )}
                          {roleLabel ? <span className="block text-slate-500">{roleLabel}</span> : null}
                        </td>
                        <td className="td">
                          <span className="inline-flex max-w-full items-center rounded-full border border-[#F0DDB0] bg-[#FBEFCF] px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-[#5C3B00]">{event.action || '-'}</span>
                        </td>
                        <td className="td">
                          {subject ? (
                            <span className="block font-semibold text-slate-900">{subject}</span>
                          ) : (
                            <span className="block font-mono font-semibold text-slate-900" title={event.entity_id || undefined}>{shortId(event.entity_id) || '-'}</span>
                          )}
                          {event.entity_type ? <span className="block text-slate-500">{entityTypeLabel(event.entity_type)}</span> : null}
                        </td>
                        <td className="td">
                          {event.office_id ? (
                            office ? (
                              <>
                                <span className="block font-bold text-slate-900">{office.code}</span>
                                <span className="block text-slate-500">{office.name}</span>
                              </>
                            ) : (
                              <span className="block font-mono font-semibold text-slate-900" title={event.office_id}>{shortId(event.office_id)}</span>
                            )
                          ) : (
                            <span className="block font-bold text-slate-900">Campus-wide</span>
                          )}
                        </td>
                        <td className="td w-12 text-right">
                          <button
                            type="button"
                            className="row-icon-button"
                            aria-expanded={open}
                            aria-controls={open ? detailId : undefined}
                            aria-label={`${open ? 'Hide' : 'Show'} details of ${event.action}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(event.audit_id);
                            }}
                          >
                            <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m7.5 4.5 5 5.5-5 5.5" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr id={detailId} className="bg-table-hover">
                          <td className="px-4 py-4" colSpan={COLUMNS}>
                            <dl className="mb-4 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
                              <div>
                                <dt className="font-semibold text-slate-500">Actor ID</dt>
                                <dd className="break-all font-mono">{actorId || '-'}</dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-slate-500">Entity ID</dt>
                                <dd className="break-all font-mono">{event.entity_id || '-'}</dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-slate-500">Audit entry ID</dt>
                                <dd className="break-all font-mono">{event.audit_id}</dd>
                              </div>
                            </dl>
                            <div className="grid gap-4 md:grid-cols-2">
                              <section aria-label="Before" className="rounded-lg border border-[#E7DFD7] bg-white p-4">
                                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-500">Before</h3>
                                <AuditValue node={auditValueTree(event.before_value)} />
                              </section>
                              <section aria-label="After" className="rounded-lg border border-[#E7DFD7] bg-white p-4">
                                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-500">After</h3>
                                <AuditValue node={auditValueTree(event.after_value)} />
                              </section>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
        </Table>
      </TableShell>
    </div>
  );
}

export default function LogsPage() {
  return (
    <AppShell
      title="Audit logs"
      subtitle="A read-only record of changes made in CCMS, newest first. Dates are Manila calendar days (Asia/Manila)."
      allowedRoles={[ROLES.SUPER_ADMIN]}
    >
      <AuditLog />
    </AppShell>
  );
}
