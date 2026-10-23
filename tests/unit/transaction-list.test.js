import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLE_LIST, ROLES } from 'ccms-shared/roles';
import { TRANSACTIONS_API, listTransactionPage } from '../../src/lib/api/transactions.js';
import { activeNavHref, appNavForRole, transactionsNav } from '../../src/lib/auth/permissions.js';
import { formatDateTime } from '../../src/lib/ui/date-format.js';
import { EMPTY_TX_FILTERS, LIST_MESSAGES, STATUS_OPTIONS, activeFilters, backToListHref, emptyMessage, transactionHref, filterErrors, filtersToSearch, hasFilters, listErrorResult, searchToFilters } from '../../src/lib/ui/transaction-list.js';
import { canCancel } from '../../src/lib/ui/cancel-transaction.js';
import { canComplete } from '../../src/lib/ui/complete-transaction.js';
import { canHold, canResume } from '../../src/lib/ui/hold-transaction.js';

// MOCKED fetchers and error objects shaped like the real contract (Operations list.js, access.js, http.js parsePaging).
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const SERVICE = '11111111-1111-4111-8111-111111111111';
const COUNTER = '22222222-2222-4222-8222-222222222222';
const OFFICE = '33333333-3333-4333-8333-333333333333';

describe('navigation by role', () => {
  it('Super Admin, Office Head and Office Staff get a Transactions item; Executive and unknown roles do not', () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]) {
      assert.deepEqual(transactionsNav(role), { section: 'Main', label: 'Transactions', href: '/transactions' }, role);
      assert.ok(appNavForRole(role).some((i) => i.href === '/transactions'), role);
    }
    assert.equal(transactionsNav(ROLES.EXECUTIVE), null);
    assert.ok(!appNavForRole(ROLES.EXECUTIVE).some((i) => i.href === '/transactions' || i.href === '/transactions/new'));
    for (const role of ['admin', undefined, null, '']) assert.deepEqual(appNavForRole(role), []);
    assert.ok(ROLE_LIST.includes(ROLES.EXECUTIVE));
  });
  it('the menu item is a convenience: the page itself refuses other roles and the server stays authoritative', () => {
    const list = strip(read('src/app/transactions/page.js'));
    assert.ok(/allowedRoles=\{\[ROLES\.SUPER_ADMIN, ROLES\.OFFICE_HEAD, ROLES\.OFFICE_STAFF\]\}/.test(list));
    assert.ok(!/ROLES\.EXECUTIVE/.test(list));
    // Scope is never worked out here: no filter by user, office or started_by is built from the signed-in person.
    assert.ok(!/started_by|user\.id|user\.officeId|office_id:\s*user/.test(list));
  });
  it('the longest matching menu address is current, so /transactions/new keeps Transactions current', () => {
    const items = appNavForRole(ROLES.OFFICE_HEAD);
    assert.equal(activeNavHref(items, '/transactions/new'), '/transactions'); // Start Transaction is not a menu item any more
    assert.equal(activeNavHref(items, '/transactions'), '/transactions');
    assert.equal(activeNavHref(items, '/transactions/44444444-4444-4444-8444-444444444444'), '/transactions');
    assert.equal(activeNavHref(items, '/services/abc'), '/services');
    assert.equal(activeNavHref(items, '/nowhere'), null);
  });
});

describe('the request (MOCKED fetcher)', () => {
  it('sends only the filters that have a value, trimmed, with the service\'s own parameter names', async () => {
    const urls = [];
    const fetcher = async (url) => (urls.push(url), { items: [] });
    await listTransactionPage({ ...EMPTY_TX_FILTERS, status: 'COMPLETED', service_id: SERVICE, counter_id: COUNTER, office_id: OFFICE, from: '2026-10-01', to: '2026-10-31', q: '  CAMP-ADMIN-2026  ' }, 3, 50, fetcher);
    const url = new URL(urls[0], 'http://x');
    assert.equal(url.pathname, TRANSACTIONS_API);
    assert.deepEqual(Object.fromEntries(url.searchParams), { status: 'COMPLETED', service_id: SERVICE, counter_id: COUNTER, office_id: OFFICE, q: 'CAMP-ADMIN-2026', page: '3', page_size: '50' });
  });
  it('without filters it asks for the page only', async () => {
    const urls = [];
    await listTransactionPage(EMPTY_TX_FILTERS, 1, 20, async (url) => (urls.push(url), {}));
    assert.equal(urls[0], `${TRANSACTIONS_API}?page=1&page_size=20`);
    await listTransactionPage(undefined, 2, 10, async (url) => (urls.push(url), {}));
    assert.equal(urls[1], `${TRANSACTIONS_API}?page=2&page_size=10`);
  });
  it('ignores blank and non-text values, never sends a sort or a role/owner filter', async () => {
    const urls = [];
    await listTransactionPage({ status: '   ', service_id: null, q: 5, from: '', sort: 'asc', started_by: 'me' }, 1, 20, async (url) => (urls.push(url), {}));
    assert.equal(urls[0], `${TRANSACTIONS_API}?page=1&page_size=20`);
  });
  it('offers exactly the statuses the service knows', () => {
    assert.deepEqual(STATUS_OPTIONS.map((s) => s.value), ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'AUTO_CLOSED']);
    assert.deepEqual(STATUS_OPTIONS.map((s) => s.label), ['In progress', 'On hold', 'Completed', 'Cancelled', 'Auto-closed']);
  });
});

describe('transaction filters', () => {
  it('does not accept or send the removed date filters', () => {
    assert.deepEqual(EMPTY_TX_FILTERS, { status: '', service_id: '', counter_id: '', office_id: '', q: '' });
    assert.deepEqual(activeFilters({ ...EMPTY_TX_FILTERS, from: '2026-10-01', to: '2026-10-31' }), {});
  });
  it('refuses an over-long tracking number by field', () => {
    assert.equal(filterErrors({ ...EMPTY_TX_FILTERS, q: 'x'.repeat(61) }).q, LIST_MESSAGES.trackingLong);
    assert.deepEqual(filterErrors({ ...EMPTY_TX_FILTERS, q: 'x'.repeat(60) }), {});
  });
  it('shows rows in Manila time with the shared formatter (MM/DD/YYYY h:mm AM/PM)', () => {
    assert.equal(formatDateTime('2026-10-23T06:05:00.000Z'), '10/23/2026 2:05 PM');
    assert.equal(formatDateTime('2026-10-23T16:30:00.000Z'), '10/24/2026 12:30 AM'); // past midnight in Manila
    assert.equal(formatDateTime(null), '');
    const list = strip(read('src/app/transactions/page.js'));
    assert.ok(/formatDateTime\(t\.started_at\)/.test(list) && /formatDateTime\(t\.ended_at\)/.test(list));
    assert.ok(!/toLocale|new Date\(|getTimezoneOffset|Intl\./.test(list));
  });
});

describe('filters, the address bar and paging', () => {
  it('knows when filters are applied', () => {
    assert.equal(hasFilters(EMPTY_TX_FILTERS), false);
    assert.equal(hasFilters({ ...EMPTY_TX_FILTERS, q: '   ' }), false);
    assert.equal(hasFilters({ ...EMPTY_TX_FILTERS, status: 'COMPLETED' }), true);
    assert.deepEqual(activeFilters({ ...EMPTY_TX_FILTERS, status: 'COMPLETED', q: ' A ' }), { status: 'COMPLETED', q: 'A' });
  });
  it('writes and reads the applied filters and page, so Back from a transaction returns to the same view', () => {
    const filters = { ...EMPTY_TX_FILTERS, status: 'CANCELLED', q: 'CAMP' };
    const search = filtersToSearch(filters, 3, 50);
    assert.deepEqual(searchToFilters(search), { filters, page: 3, pageSize: 50 });
    assert.equal(filtersToSearch(EMPTY_TX_FILTERS, 1, 20), '');
    assert.deepEqual(searchToFilters(''), { filters: EMPTY_TX_FILTERS, page: 1, pageSize: 20 });
  });
  it('falls back to the defaults on anything malformed in the address', () => {
    const r = searchToFilters('?status=HACKED&from=2026-02-30&to=nope&page=0&page_size=7&q=ok');
    assert.deepEqual(r, { filters: { ...EMPTY_TX_FILTERS, q: 'ok' }, page: 1, pageSize: 20 });
    assert.equal(searchToFilters('?page=abc').page, 1);
    assert.equal(searchToFilters('?page=2').page, 2);
  });
  it('starts again at page 1 whenever the filters or the page size change, and pages with the applied filters', () => {
    const list = strip(read('src/app/transactions/page.js'));
    assert.ok(/run\(draft, 1, pageSize\)/.test(list), 'Apply');
    assert.ok(/run\(\{ \.\.\.EMPTY_TX_FILTERS \}, 1, pageSize\)/.test(list), 'Clear');
    assert.ok(/run\(applied, 1, size\)/.test(list), 'page size');
    assert.ok(/onPage=\{\(next\) => run\(applied, next, pageSize\)\}/.test(list), 'paging keeps the applied filters, not the unapplied draft');
  });
  it('uses the shared table, pager, badge and states, and keeps the service\'s order (no sorting in the browser)', () => {
    const list = strip(read('src/app/transactions/page.js'));
    for (const name of ['TableShell', 'Table', 'Th', 'TableState', 'Pager', 'StatusBadge']) assert.ok(new RegExp(`\\b${name}\\b`).test(list), name);
    assert.ok(!/\.sort\(|\.reverse\(/.test(list));
  });
});

describe('answers and states', () => {
  it('maps validation by field, 401, 403, network and server failures', () => {
    const v = listErrorResult(apiError(400, 'VALIDATION_ERROR', 'x', { from: 'From must be a date (YYYY-MM-DD)', q: 'q must be 60 characters or fewer', other: 'ignored' }));
    assert.deepEqual([v.kind, v.fieldErrors], ['validation', { q: 'q must be 60 characters or fewer' }]);
    assert.equal(listErrorResult(apiError(401, 'UNAUTHORIZED')).kind, 'auth');
    const forbidden = listErrorResult(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/x.js'));
    assert.deepEqual([forbidden.kind, forbidden.message], ['forbidden', LIST_MESSAGES.forbidden]);
    assert.equal(listErrorResult(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server.')).message, 'Cannot reach the server.');
    const server = listErrorResult(apiError(500, 'INTERNAL_ERROR', 'TypeError at pg.js:9'));
    assert.deepEqual([server.kind, server.message], ['server', LIST_MESSAGES.serverError]);
  });
  it('words the empty table by what happened', () => {
    assert.equal(emptyMessage({ error: 'x', filtered: true }), LIST_MESSAGES.loadFailed);
    assert.equal(emptyMessage({ error: null, filtered: true }), LIST_MESSAGES.emptyFiltered);
    assert.equal(emptyMessage({ error: null, filtered: false }), LIST_MESSAGES.empty);
  });
  it('a late answer for older filters is thrown away, and a failed or refused request shows no old rows', () => {
    const list = strip(read('src/app/transactions/page.js'));
    assert.ok(/const id = \+\+latest\.current;/.test(list));
    assert.equal((list.match(/if \(id !== latest\.current\) return;/g) ?? []).length, 2); // success and failure
    assert.ok(/setState\(\{ loading: false, \.\.\.EMPTY_PAGE, error:/.test(list));
  });
});

describe('the detail page after CC027', () => {
  const detail = strip(read('src/app/transactions/[id]/page.js'));
  it('drops the transaction when the service refuses or no longer finds it, and never keeps another transaction\'s data', () => {
    assert.ok(/result\.kind === 'auth' \|\| result\.kind === 'forbidden' \|\| result\.kind === 'notfound'\) setTx\(null\)/.test(detail));
    assert.ok(/<TransactionDetail key=\{id\}/.test(detail), 'keyed by the address so state cannot carry over');
  });
  it('links back to the list, with the filters and page it was opened from', () => {
    assert.ok(/href=\{backHref\}/.test(detail));
    assert.ok(/backToListHref\(/.test(detail));
    assert.equal(transactionHref('abc', ''), '/transactions/abc');
    assert.equal(transactionHref('abc', '?status=COMPLETED&page=2'), '/transactions/abc?back=%3Fstatus%3DCOMPLETED%26page%3D2');
    assert.equal(backToListHref('?status=COMPLETED&page=2'), '/transactions?status=COMPLETED&page=2');
    assert.equal(backToListHref(''), '/transactions');
    assert.equal(backToListHref(null), '/transactions');
  });
  it('only known filters can come back out of the carried address (nothing else is followed)', () => {
    assert.equal(backToListHref('?status=HACKED&redirect=https://evil.example&x=1'), '/transactions');
    assert.equal(backToListHref('//evil.example'), '/transactions');
    assert.equal(backToListHref('?q=CAMP&started_by=me'), '/transactions?q=CAMP');
  });
  it('still guards Hold, Resume, Complete and Cancel with the same rules', () => {
    for (const guard of ['canHold(tx, holdEnabled)', 'canResume(tx)', 'canComplete(tx)', 'canCancel(tx, role)']) assert.ok(detail.includes(guard), guard);
    assert.equal(canHold({ status: 'IN_PROGRESS' }, true), true);
    assert.equal(canResume({ status: 'ON_HOLD' }), true);
    assert.equal(canComplete({ status: 'IN_PROGRESS' }), true);
    assert.equal(canCancel({ status: 'ON_HOLD' }, ROLES.OFFICE_HEAD), true);
    assert.equal(canCancel({ status: 'ON_HOLD' }, ROLES.OFFICE_STAFF), false);
    assert.equal(canComplete({ status: 'COMPLETED' }), false);
  });
  it('shows no receipt action: the service has no receipt endpoint for the browser (it sends receipt emails by itself)', () => {
    assert.ok(!/receipt/i.test(detail));
  });
});

describe('the path in the top bar', () => {
  const strip2 = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('the Add Transaction and Transaction Settings pages pass their path to the app shell, which shows it in the top bar instead of the maroon title', () => {
    const start = strip2(read('src/app/transactions/new/page.js'));
    const settings = strip2(read('src/app/settings/page.js'));
    const shell = strip2(read('src/components/layout/AppShell.js'));
    assert.ok(start.includes("breadcrumb={[{ label: 'Transactions', href: '/transactions' }, { label: 'Add Transaction' }]}"));
    assert.ok(settings.includes("breadcrumb={[{ label: 'Transactions', href: '/transactions' }, { label: 'Transaction Settings' }]}"));
    assert.ok(/breadcrumb \? <Breadcrumb items=\{breadcrumb\}/.test(shell));
    assert.ok(!/eyebrow=\{<Breadcrumb/.test(start + settings), 'not repeated above the heading');
  });
  it('the path is charcoal text and the current page is marked', () => {
    const crumb = read('src/components/navigation/Breadcrumb.js');
    assert.ok(crumb.includes('text-slate-800') && crumb.includes('text-slate-900') && !/maroon-9|text-maroon-8/.test(crumb.replace(/focus-visible:ring-maroon-700/g, '')));
    assert.ok(crumb.includes("aria-current={current ? 'page' : undefined}"));
  });
});
