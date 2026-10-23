'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES } from 'ccms-shared/roles';
import AppShell from '../../components/layout/AppShell.js';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import OfficeCodeField from '../../components/forms/OfficeCodeField.js';
import Modal from '../../components/modals/Modal.js';
import RowActionMenu from '../../components/ui/RowActionMenu.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import TableState from '../../components/ui/TableState.js';
import { OFFICES_API } from '../../lib/api/catalogue.js';
import { apiFetch } from '../../lib/auth/session.js';
import { OFFICE_CODE_PREFIX, composeOfficeCode, officeCodeProblem, officePart, officeSaveError } from '../../lib/ui/office-code.js';
import { useFormDirty } from '../../lib/ui/useFormDirty.js';

// office_code is the whole code, or only the office part while an institution prefix is shown (OFFICE_CODE_PREFIX).
// legacy: an existing code that does not start with the prefix; it is shown and saved whole.
const EMPTY_FORM = { office_code: '', office_name: '', legacy: false };

function OfficesManager() {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null); // { id?, office_code, office_name, legacy }
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // office being deactivated
  const formDirty = useFormDirty(form);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch(OFFICES_API);
      setState({ loading: false, items: data.items, error: null });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return state.items;
    return state.items.filter((o) => o.office_code.toLowerCase().includes(term) || o.office_name.toLowerCase().includes(term));
  }, [state.items, search]);

  function openForm(office) {
    setFieldErrors({});
    setFormError(null);
    if (!office) {
      setForm({ ...EMPTY_FORM });
      return;
    }
    // With a prefix, edit only the office part of a prefixed code, so saving never writes the prefix twice.
    const part = OFFICE_CODE_PREFIX ? officePart(OFFICE_CODE_PREFIX, office.office_code) : null;
    setForm({ id: office.office_id, office_code: part ?? office.office_code, office_name: office.office_name, legacy: Boolean(OFFICE_CODE_PREFIX) && part === null });
  }

  async function save(event) {
    event.preventDefault();
    const prefix = form.legacy ? null : OFFICE_CODE_PREFIX;
    const problem = officeCodeProblem(prefix, form.office_code);
    if (problem) {
      setFieldErrors({ office_code: problem });
      setFormError(null);
      return;
    }
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const body = { office_code: composeOfficeCode(prefix, form.office_code), office_name: form.office_name };
      if (form.id) await apiFetch(`${OFFICES_API}/${form.id}`, { method: 'PUT', body });
      else await apiFetch(OFFICES_API, { method: 'POST', body });
      setForm(null);
      await reload();
    } catch (err) {
      // The service answers 409 for a code or name already in use and 400 with the field that is wrong;
      // officeSaveError turns those, 403 and network or server failures into plain messages.
      const { fieldErrors: fields, message } = officeSaveError(err, prefix);
      setFieldErrors(fields);
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(office, active) {
    setSaving(true);
    try {
      await apiFetch(`${OFFICES_API}/${office.office_id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'PATCH' });
      setConfirm(null);
      await reload();
    } catch (err) {
      setConfirm(null);
      setState((current) => ({ ...current, error: err.message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={state.error} onDismiss={() => setState((s) => ({ ...s, error: null }))} />

      <div className="card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-72">
            <label className="label" htmlFor="office-search">
              Search office
            </label>
            <input id="office-search" className="input" placeholder="Office name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" onClick={() => openForm(null)}>
            + Add Office
          </button>
        </div>
      </div>

      <TableShell>
        <Table
          busy={state.loading}
          head={
            <tr>
              <Th>Office name</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          }
        >
              {state.loading ? (
                <TableState colSpan={3} kind="loading">Loading offices…</TableState>
              ) : visible.length === 0 ? (
                <TableState colSpan={3}>
                  {state.items.length === 0 ? 'No offices yet. Add the first office from the Citizen’s Charter.' : 'No offices match your search.'}
                </TableState>
              ) : (
                visible.map((office) => (
                  <tr key={office.office_id} className={`tr-row ${office.is_active ? '' : 'bg-table-hover'}`}>
                    <td className="td">{office.office_name}</td>
                    <td className="td">
                      <StatusBadge variant={office.is_active ? 'active' : 'inactive'}>{office.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActionMenu
                          label={`Actions for ${office.office_name}`}
                          items={[
                            { label: 'Edit', onSelect: () => openForm(office) },
                            office.is_active
                              ? { label: 'Deactivate', danger: true, onSelect: () => setConfirm(office) }
                              : { label: 'Reactivate', disabled: saving, onSelect: () => setActive(office, true) },
                          ]}
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
        title={form?.id ? 'Edit Office' : 'Add Office'}
        dirty={formDirty}
        onClose={saving ? undefined : () => setForm(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="office-form" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {form ? (
          <form id="office-form" onSubmit={save} className="space-y-4">
            <ErrorBanner message={formError} />
            <OfficeCodeField
              prefix={OFFICE_CODE_PREFIX}
              legacy={form.legacy}
              value={form.office_code}
              onChange={(value) => setForm({ ...form, office_code: value })}
              error={fieldErrors.office_code}
              autoFocus
            />
            <div>
              <label className="label" htmlFor="office_name">
                Office name (as printed in the Charter)
              </label>
              <input id="office_name" className="input" value={form.office_name} onChange={(e) => setForm({ ...form, office_name: e.target.value })} required maxLength={200} />
              {fieldErrors.office_name ? <p className="mt-1 text-xs text-red-700">{fieldErrors.office_name}</p> : null}
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title="Deactivate office?"
        message={
          confirm
            ? `${confirm.office_name} will no longer be offered when adding accounts or services. Existing records that use it keep showing it. You can reactivate it later.`
            : ''
        }
        confirmLabel="Deactivate"
        danger
        busy={saving}
        onConfirm={() => setActive(confirm, false)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function OfficesPage() {
  return (
    <AppShell title="Offices" subtitle="The office list as printed in the Citizen's Charter." allowedRoles={[ROLES.SUPER_ADMIN]}>
      <OfficesManager />
    </AppShell>
  );
}
