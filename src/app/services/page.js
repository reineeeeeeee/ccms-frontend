'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import Modal from '../../components/modals/Modal.js';
import DataTable from '../../components/ui/DataTable.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import ServiceForm, { EMPTY_SERVICE_FORM, formToBody, serviceToForm } from '../../components/forms/ServiceForm.js';
import { toQuery } from '../../lib/api/client.js';
import { CATALOGUE_API, CLASSIFICATIONS, classificationLabel, standardText } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';

const API = CATALOGUE_API;
const PAGE_SIZE = 20;

function OfficePill({ user }) {
  const [office, setOffice] = useState(null);

  useEffect(() => {
    if (!user.officeId) return;
    apiFetch(`${API}/offices/${encodeURIComponent(user.officeId)}`)
      .then((data) => setOffice(data.office ?? null))
      .catch(() => setOffice(null)); // the name is only a label
  }, [user.officeId]);

  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-[#EAE3D9] bg-white px-4 py-2 text-sm text-slate-500" data-testid="own-office">
      Your office
      <span className="font-semibold text-slate-900">{office ? `${office.office_code} · ${office.office_name}` : '—'}</span>
    </p>
  );
}

function ServicesManager({ user }) {
  const isAdmin = user.role === ROLES.SUPER_ADMIN;
  // Office Head and Office Staff only ever see their own office's services (the API enforces it too).
  const ownOfficeOnly = user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF;
  const [filters, setFilters] = useState({ search: '', office_id: '', classification: '', status: 'active' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [offices, setOffices] = useState([]);
  const [state, setState] = useState({ loading: true, items: [], total: 0, error: null });
  const [form, setForm] = useState(null); // { id?, ...fields }
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const formDirty = useFormDirty(form);

  useEffect(() => {
    if (ownOfficeOnly) return; // own-office users have no office filter
    apiFetch(`${API}/offices`)
      .then((data) => setOffices(data.items ?? []))
      .catch(() => setOffices([])); // the office filter is optional
  }, [ownOfficeOnly]);

  const reload = useCallback(async () => {
    try {
      const query = toQuery({ ...applied, office_id: ownOfficeOnly ? undefined : applied.office_id, status: isAdmin ? applied.status : undefined, page, page_size: PAGE_SIZE });
      const data = await apiFetch(`${API}/services${query}`);
      setState({ loading: false, items: data.items, total: data.total, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [applied, page, isAdmin, ownOfficeOnly]);

  useEffect(() => {
    reload();
  }, [reload]);

  function applyFilters(next) {
    setFilters(next);
    setApplied(next);
    setPage(1);
    setState((s) => ({ ...s, loading: true }));
  }

  function openForm(service) {
    setFieldErrors({});
    setFormError(null);
    setForm(service ? { id: service.service_id, ...serviceToForm(service) } : { ...EMPTY_SERVICE_FORM });
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      if (form.id) await apiFetch(`${API}/services/${form.id}`, { method: 'PUT', body: formToBody(form, false) });
      else await apiFetch(`${API}/services`, { method: 'POST', body: formToBody(form, true) });
      setForm(null);
      await reload();
    } catch (err) {
      if (err.details && Object.keys(err.details).length > 0) setFieldErrors(err.details);
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(service, active) {
    setSaving(true);
    try {
      await apiFetch(`${API}/services/${service.service_id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'PATCH' });
      setConfirm(null);
      await reload();
    } catch (err) {
      setConfirm(null);
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setSaving(false);
    }
  }

  const activeOffices = offices.filter((o) => o.is_active);

  const tableColumns = [
    {
      key: 'service',
      header: 'SERVICE',
      render: (s) => (
        <DataTable.TruncatedCell
          text={s.service_name}
          subtitle={s.service_code}
          href={`/services/${encodeURIComponent(s.service_id)}`}
        />
      ),
    },
    ...(ownOfficeOnly
      ? []
      : [
        {
          key: 'office',
          header: 'OFFICE',
          width: 110,
          render: (s) => <span>{s.office_code}</span>,
        },
      ]),
    {
      key: 'classification',
      header: 'CLASSIFICATION',
      width: 170,
      render: (s) => (
        <StatusBadge variant={s.classification}>
          {classificationLabel(s.classification)}
        </StatusBadge>
      ),
    },
    {
      key: 'current_standard',
      header: 'CURRENT STANDARD',
      width: 200,
      render: (s) => {
        if (!s.current_standard) return <span className="text-stone-400">—</span>;
        if (s.current_standard.version_no) {
          return <span>v{s.current_standard.version_no} · In force</span>;
        }
        return (
          <span>
            {standardText(s.current_standard.duration_value, s.current_standard.duration_unit) || 'In force'}
          </span>
        );
      },
    },
    ...(isAdmin
      ? [
        {
          key: 'status',
          header: 'STATUS',
          width: 120,
          render: (s) => (
            <StatusBadge variant={s.is_active ? 'active' : 'inactive'}>
              {s.is_active ? 'Active' : 'Inactive'}
            </StatusBadge>
          ),
        },
      ]
      : []),
    {
      key: 'actions',
      header: 'ACTION',
      width: 80,
      align: 'right',
      render: (s) => (
        <RowActionMenu
          label={`Actions for ${s.service_name}`}
          items={[
            { label: 'View', href: `/services/${encodeURIComponent(s.service_id)}` },
            ...(isAdmin
              ? [
                { label: 'Edit', onSelect: () => openForm(s) },
                s.is_active
                  ? { label: 'Deactivate', onSelect: () => setConfirm({ service: s, active: false }) }
                  : { label: 'Reactivate', onSelect: () => setConfirm({ service: s, active: true }) },
              ]
              : []),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />

      <form
        className="rounded-2xl border border-[#EAE3D9] bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters(filters);
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-80">
            <label className="label" htmlFor="svc-search">
              Search
            </label>
            <div className="relative">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input id="svc-search" className="input pl-9" placeholder="Search by service name, code or office" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            </div>
          </div>
          {ownOfficeOnly ? null : offices.length > 0 ? (
            <div>
              <label className="label" htmlFor="svc-office">
                Office
              </label>
              <select id="svc-office" className="input" value={filters.office_id} onChange={(e) => applyFilters({ ...filters, office_id: e.target.value })}>
                <option value="">All offices</option>
                {offices.map((o) => (
                  <option key={o.office_id} value={o.office_id}>
                    {o.office_code}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="svc-class">
              Classification
            </label>
            <select id="svc-class" className="input" value={filters.classification} onChange={(e) => applyFilters({ ...filters, classification: e.target.value })}>
              <option value="">All</option>
              {CLASSIFICATIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {isAdmin ? (
            <div>
              <label className="label" htmlFor="svc-status">
                Status
              </label>
              <select id="svc-status" className="input" value={filters.status} onChange={(e) => applyFilters({ ...filters, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </select>
            </div>
          ) : null}
          <button type="submit" className="btn-secondary">
            Search
          </button>
          {isAdmin ? (
            <button type="button" className="btn-primary ml-auto" onClick={() => openForm(null)}>
              + Add Service
            </button>
          ) : null}
        </div>
      </form>

      <DataTable
        columns={tableColumns}
        data={state.items}
        keyExtractor={(s) => s.service_id}
        rowClassName={(s) => (s.is_active ? '' : 'bg-slate-50/70')}
        loading={state.loading}
        loadingMessage="Loading services…"
        emptyMessage="No services match your filters."
        summaryText={ownOfficeOnly ? 'Showing services of your office' : null}
        totalCount={state.total}
        countLabel="services"
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: state.total,
          onPage: setPage,
        }}
      />

      <Modal
        open={form !== null}
        title={form?.id ? 'Edit Service' : 'Add Service'}
        dirty={formDirty}
        widthClass="max-w-2xl"
        onClose={saving ? undefined : () => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="service-form" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {form ? (
          <div className="space-y-4">
            <ErrorBanner message={formError} />
            <ServiceForm id="service-form" form={form} setForm={setForm} errors={fieldErrors} offices={form.id ? offices : activeOffices} isNew={!form.id} onSubmit={save} />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.active ? 'Reactivate service?' : 'Deactivate service?'}
        message={
          confirm
            ? confirm.active
              ? `${confirm.service.service_name} will appear again in the catalogue and on the public page.`
              : `${confirm.service.service_name} will disappear from the public page and can no longer be used to start transactions. Existing records keep it. You can reactivate it later.`
            : ''
        }
        confirmLabel={confirm?.active ? 'Reactivate' : 'Deactivate'}
        danger={confirm ? !confirm.active : false}
        busy={saving}
        onConfirm={() => setActive(confirm.service, confirm.active)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function ServicesPage() {
  return (
    <AppShell
      title="Services"
      subtitle="The Citizen's Charter service catalogue."
      headerRight={(user) => (user.role === ROLES.OFFICE_HEAD || user.role === ROLES.OFFICE_STAFF ? <OfficePill user={user} /> : null)}
    >
      {(user) => <ServicesManager user={user} />}
    </AppShell>
  );
}
