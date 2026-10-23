'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLES, ROLE_LABELS, ROLE_LIST, isOfficeBound } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import Modal from '../../components/modals/Modal.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import TableState from '../../components/ui/TableState.js';
import Pager from '../../components/navigation/Pager.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import { ACCOUNTS_API } from '../../lib/api/identity.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';

const DEFAULT_PAGE_SIZE = 10;
const EMPTY_FORM = { employee_no: '', full_name: '', email: '', role: ROLES.OFFICE_STAFF, office_id: '', password: '' };

function AccountsManager() {
  const [filters, setFilters] = useState({ q: '', role: '', office_id: '', status: '' });
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [list, setList] = useState({ loading: true, items: [], total: 0, error: null });
  const [offices, setOffices] = useState([]);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'deactivate' | 'reset', account }
  const formDirty = useFormDirty(form);

  // Fallback focus. The control that started an action (a row's "⋮" button, or Add Account) is
  // remembered in pendingTrigger. Once the action has finished and its dialogs are closed, and ONLY
  // if that control is gone from the page (e.g. its row was filtered out by the reload) and focus has
  // fallen to <body>, focus goes to Add Account. Nothing runs when no action is pending, and focus the
  // user has moved elsewhere is never taken.
  const pendingTrigger = useRef(null);
  const addButtonRef = useRef(null);
  function rememberTrigger() {
    const active = document.activeElement;
    pendingTrigger.current = active && active !== document.body ? active : null;
  }
  // list is a dependency so this re-checks once a reload has been applied to the page.
  useEffect(() => {
    const trigger = pendingTrigger.current;
    if (!trigger || busy || form !== null || confirm !== null) return;
    pendingTrigger.current = null;
    if (trigger.isConnected) return; // still there: the dialog (or menu) already returned focus to it
    const active = document.activeElement;
    if (!active || active === document.body) addButtonRef.current?.focus();
  }, [list, form, confirm, busy]);

  // Offices come from the Catalogue service (accounts only store the office ID).
  useEffect(() => {
    apiFetch(OFFICES_API)
      .then((data) => setOffices(data.items))
      .catch((err) => setList((current) => ({ ...current, error: `Offices could not be loaded: ${err.message}` })));
  }, []);

  // Search waits for a short pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedQuery(filters.q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.q]);

  // Depend on the individual filter values, not the whole `filters` object: that object is replaced on
  // every keystroke in the search box, which would re-run the request before the debounce above fires.
  const { role, office_id, status } = filters;
  // Number of the newest request. A response that is no longer the newest (an older search, or a
  // reload after save/deactivate/reactivate/reset that a later request has overtaken) is ignored.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setList((current) => ({ ...current, loading: true, error: null }));
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
    if (role) params.set('role', role);
    if (office_id) params.set('office_id', office_id);
    if (status) params.set('status', status);
    try {
      const data = await apiFetch(`${ACCOUNTS_API}?${params}`);
      if (request !== latestRequest.current) return;
      setList({ loading: false, items: data.items, total: data.total, error: null });
    } catch (err) {
      if (request !== latestRequest.current) return;
      setList((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, [page, pageSize, appliedQuery, role, office_id, status]);

  useEffect(() => {
    load();
  }, [load]);

  const officeById = useMemo(() => new Map(offices.map((o) => [o.office_id, o])), [offices]);
  const officeLabel = (id) => {
    if (!id) return '—';
    const office = officeById.get(id);
    return office ? `${office.office_code}${office.is_active ? '' : ' (inactive)'}` : 'Unknown office';
  };
  // Inactive offices cannot be assigned, except the one an account already has (so the edit form can show it).
  const officeOptions = (currentId) => offices.filter((o) => o.is_active || o.office_id === currentId);

  // A new page size starts again at page 1; the filters and search stay as they are.
  function changePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key !== 'q') setPage(1);
  }

  function openForm(account) {
    rememberTrigger();
    setFieldErrors({});
    setFormError(null);
    setForm(
      account
        ? { id: account.account_id, employee_no: account.employee_no, full_name: account.full_name, email: account.email, role: account.role, office_id: account.office_id ?? '', password: '' }
        : { ...EMPTY_FORM },
    );
  }

  function changeRole(role) {
    setForm((current) => ({ ...current, role, office_id: isOfficeBound(role) ? current.office_id : '' }));
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const body = {
        employee_no: form.employee_no,
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        office_id: isOfficeBound(form.role) ? form.office_id || null : null,
      };
      if (form.id) await apiFetch(`${ACCOUNTS_API}/${form.id}`, { method: 'PUT', body });
      else await apiFetch(ACCOUNTS_API, { method: 'POST', body: { ...body, password: form.password } });
      setNotice(form.id ? 'Account updated.' : 'Account created.');
      setForm(null);
      await load();
    } catch (err) {
      setFieldErrors(err.details && typeof err.details === 'object' ? err.details : {});
      // Field problems show under their fields; anything else (503, 409 on last admin...) shows as a banner.
      setFormError(err.code === 'VALIDATION_ERROR' || err.code === 'EMAIL_TAKEN' || err.code === 'EMPLOYEE_NO_TAKEN' ? null : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    const { type, account } = confirm;
    setBusy(true);
    try {
      if (type === 'deactivate') {
        await apiFetch(`${ACCOUNTS_API}/${account.account_id}/deactivate`, { method: 'PATCH' });
        setNotice(`${account.full_name} was deactivated and signed out.`);
      } else {
        const result = await apiFetch(`${ACCOUNTS_API}/${account.account_id}/reset-password`, { method: 'POST' });
        setNotice(result.message);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setConfirm(null);
      setList((current) => ({ ...current, error: err.message }));
    } finally {
      setBusy(false);
    }
  }

  function askConfirm(type, account) {
    rememberTrigger();
    setConfirm({ type, account });
  }

  async function reactivate(account) {
    rememberTrigger();
    setBusy(true);
    try {
      await apiFetch(`${ACCOUNTS_API}/${account.account_id}/reactivate`, { method: 'PATCH' });
      setNotice(`${account.full_name} was reactivated.`);
      await load();
    } catch (err) {
      setList((current) => ({ ...current, error: err.message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={list.error} onDismiss={() => setList((current) => ({ ...current, error: null }))} />
      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" className="font-semibold hover:underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <label className="label" htmlFor="account-search">Search name</label>
            <input id="account-search" className="input" placeholder="Name, email or employee no." value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <label className="label" htmlFor="filter-role">Role</label>
            <select id="filter-role" className="input" value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
              <option value="">All roles</option>
              {ROLE_LIST.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-44">
            <label className="label" htmlFor="filter-office">Office</label>
            <select id="filter-office" className="input" value={filters.office_id} onChange={(e) => setFilter('office_id', e.target.value)}>
              <option value="">All offices</option>
              {offices.map((o) => (
                <option key={o.office_id} value={o.office_id}>{o.office_code}{o.is_active ? '' : ' (inactive)'}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-36">
            <label className="label" htmlFor="filter-status">Status</label>
            <select id="filter-status" className="input" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="ml-auto">
            <button ref={addButtonRef} type="button" className="btn-primary" onClick={() => openForm(null)}>+ Add Account</button>
          </div>
        </div>
      </div>

      <TableShell footer={<Pager page={page} pageSize={pageSize} total={list.total} onPage={setPage} onPageSizeChange={changePageSize} loading={list.loading} />}>
        <Table
          busy={list.loading}
          minWidth="52rem"
          head={
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Office</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          }
        >
              {list.loading ? (
                <TableState colSpan={6} kind="loading">Loading accounts…</TableState>
              ) : list.items.length === 0 ? (
                <TableState colSpan={6}>No accounts match.</TableState>
              ) : (
                list.items.map((account) => (
                  <tr key={account.account_id} className={`tr-row ${account.is_active ? '' : 'bg-table-hover'}`}>
                    <td className="td">
                      <p className="font-semibold text-slate-900">{account.full_name}</p>
                      <p className="text-xs text-slate-500">{account.employee_no}</p>
                    </td>
                    <td className="td">{account.email}</td>
                    <td className="td"><StatusBadge variant="role">{ROLE_LABELS[account.role]}</StatusBadge></td>
                    <td className="td">{officeLabel(account.office_id)}</td>
                    <td className="td">
                      <StatusBadge variant={account.is_active ? 'active' : 'inactive'}>{account.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActionMenu
                          label={`Actions for ${account.full_name}`}
                          items={
                            account.is_active
                              ? [
                                  { label: 'Edit', onSelect: () => openForm(account) },
                                  { label: 'Reset password', onSelect: () => askConfirm('reset', account) },
                                  { label: 'Deactivate', danger: true, onSelect: () => askConfirm('deactivate', account) },
                                ]
                              : [
                                  { label: 'Edit', onSelect: () => openForm(account) },
                                  { label: 'Reactivate', disabled: busy, onSelect: () => reactivate(account) },
                                ]
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
        </Table>
      </TableShell>
      <Modal
        open={form !== null}
        title={form?.id ? 'Edit Account' : 'Add Account'}
        dirty={formDirty}
        onClose={busy ? undefined : () => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <button type="submit" form="account-form" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </>
        }
      >
        {form ? (
          <form id="account-form" onSubmit={save} className="space-y-4" noValidate>
            <ErrorBanner message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="employee_no">Employee no.</label>
                <input id="employee_no" className="input" value={form.employee_no} onChange={(e) => setForm({ ...form, employee_no: e.target.value })} required autoFocus />
                {fieldErrors.employee_no ? <p className="mt-1 text-xs text-red-700">{fieldErrors.employee_no}</p> : null}
              </div>
              <div>
                <label className="label" htmlFor="full_name">Full name</label>
                <input id="full_name" className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
                {fieldErrors.full_name ? <p className="mt-1 text-xs text-red-700">{fieldErrors.full_name}</p> : null}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              {fieldErrors.email ? <p className="mt-1 text-xs text-red-700">{fieldErrors.email}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="role">Role</label>
                <select id="role" className="input" value={form.role} onChange={(e) => changeRole(e.target.value)}>
                  {ROLE_LIST.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
                {fieldErrors.role ? <p className="mt-1 text-xs text-red-700">{fieldErrors.role}</p> : null}
              </div>
              {isOfficeBound(form.role) ? (
                <div>
                  <label className="label" htmlFor="office_id">Office</label>
                  <select id="office_id" className="input" value={form.office_id} onChange={(e) => setForm({ ...form, office_id: e.target.value })}>
                    <option value="">Select an office</option>
                    {officeOptions(form.office_id).map((o) => (
                      <option key={o.office_id} value={o.office_id}>{o.office_code} — {o.office_name}{o.is_active ? '' : ' (inactive)'}</option>
                    ))}
                  </select>
                  {fieldErrors.office_id ? <p className="mt-1 text-xs text-red-700">{fieldErrors.office_id}</p> : null}
                </div>
              ) : null}
            </div>
            {!form.id ? (
              <div>
                <label className="label" htmlFor="password">Initial password</label>
                <input id="password" type="password" autoComplete="new-password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                <p className="mt-1 text-xs text-slate-500">At least 8 characters. The person can change it through a reset link.</p>
                {fieldErrors.password ? <p className="mt-1 text-xs text-red-700">{fieldErrors.password}</p> : null}
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.type === 'reset' ? 'Send password reset link?' : 'Deactivate account?'}
        message={
          confirm?.type === 'reset'
            ? `A time-limited reset link will be emailed to ${confirm?.account.email}. Their current password keeps working until they use it.`
            : `${confirm?.account.full_name} will be signed out and will not be able to sign in until you reactivate the account. Their records are kept.`
        }
        confirmLabel={confirm?.type === 'reset' ? 'Send link' : 'Deactivate'}
        danger={confirm?.type === 'deactivate'}
        busy={busy}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function AccountsPage() {
  return (
    <AppShell title="Accounts" subtitle="Create CCMS accounts and control who can sign in." allowedRoles={[ROLES.SUPER_ADMIN]}>
      <AccountsManager />
    </AppShell>
  );
}
