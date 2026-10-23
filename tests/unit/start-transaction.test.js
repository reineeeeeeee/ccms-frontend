import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLE_LIST, ROLES } from 'ccms-shared/roles';
import { SERVICE_LIST_PAGE_SIZE, TRANSACTIONS_API, getServiceDetail, getServiceStandard, listOpenTransactions, listStartableServices, postTransaction } from '../../src/lib/api/transactions.js';
import { appNavForRole } from '../../src/lib/auth/permissions.js';
import {
  CLIENT_TYPES,
  EMPTY_START_FORM,
  MESSAGES,
  NO_DOCUMENTS_KEY,
  allConfirmed,
  buildStartBody,
  conflictTransaction,
  filterServices,
  formatStandardDuration,
  requirementItems,
  serviceOptionLabel,
  standardLoadResult,
  startErrorResult,
  startErrors,
  statusLabel,
} from '../../src/lib/ui/start-transaction.js';

// Mocked answers shaped like the real contract (Operations start.js, Core standards.js and documents.js).
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const apiError = (status, code, message = 'x', details = null) => Object.assign(new Error(message), { name: 'ApiError', status, code, details });
const SERVICE = '11111111-1111-4111-8111-111111111111';
const COUNTER = '22222222-2222-4222-8222-222222222222';
const STANDARD = { standard_id: 's1', duration_days: 1, duration_hours: 2, duration_minutes: 30, service_code: 'CAMP-ADMIN-CLR-001', service_name: 'Issuance of Clearance', office_id: 'o1', office_code: 'CAMP-ADMIN', classification: 'SIMPLE' };
const DOCS = [
  { document_id: 'd1', document_name: 'Valid ID', is_mandatory: true, notes: null },
  { document_id: 'd2', document_name: 'Request letter', is_mandatory: true, notes: 'Signed' },
  { document_id: 'd3', document_name: 'Optional photo', is_mandatory: false, notes: null },
];
const form = (over = {}) => ({ ...EMPTY_START_FORM, service_id: SERVICE, client_type: 'STUDENT', ...over });
const itemsOf = requirementItems(DOCS);
const allChecked = { d1: true, d2: true };

describe('who can start a transaction', () => {
  it('Start Transaction is no longer a menu item for any role: it is the Add Transaction button on the Transactions page', () => {
    for (const role of ROLE_LIST) {
      assert.ok(!appNavForRole(role).some((i) => i.href === '/transactions/new' || i.label === 'Start Transaction'), role);
    }
    const list = read('src/app/transactions/page.js');
    assert.ok(list.includes('href="/transactions/new"'));
    assert.ok(list.includes('<AddTransactionButton'));
  });

  it('the page is limited to the three roles by the app shell, and the existing menus are unchanged', () => {
    assert.match(read('src/app/transactions/new/page.js'), /allowedRoles=\{\[ROLES\.SUPER_ADMIN, ROLES\.OFFICE_HEAD, ROLES\.OFFICE_STAFF\]\}/);
    for (const role of ROLE_LIST) {
      const nav = appNavForRole(role);
      assert.equal(nav[0].href, '/', role);
      assert.ok(nav.some((i) => i.href === '/services'), role);
      assert.equal(nav.some((i) => i.href === '/settings'), role === ROLES.EXECUTIVE, role); // Transaction Settings: header icon on Transactions, menu item only for Executive
    }
    assert.equal(appNavForRole(ROLES.SUPER_ADMIN).some((i) => i.href === '/logs'), true);
    assert.equal(appNavForRole(ROLES.OFFICE_STAFF).some((i) => i.href === '/logs'), false);
  });
});

describe('loading the services of the office (MOCKED fetcher)', () => {
  it('Office Head and Staff ask for the list without a status filter (the service already limits it to their active office services)', async () => {
    const urls = [];
    const items = await listStartableServices({}, async (url) => (urls.push(url), { items: [{ service_id: 'a', is_active: true }], total: 1 }));
    assert.deepEqual(urls, [`/api/catalogue/services?page=1&page_size=${SERVICE_LIST_PAGE_SIZE}`]);
    assert.equal(items.length, 1);
  });

  it('Super Admin asks for active services only, and every page is read', async () => {
    const urls = [];
    const page = (n) => ({ items: Array.from({ length: n === 3 ? 20 : 100 }, (_, i) => ({ service_id: `s${n}-${i}`, is_active: true })), total: 220 });
    const items = await listStartableServices({ isSuperAdmin: true }, async (url) => (urls.push(url), page(Number(/page=(\d+)/.exec(url)[1]))));
    assert.deepEqual(urls, ['/api/catalogue/services?status=active&page=1&page_size=100', '/api/catalogue/services?status=active&page=2&page_size=100', '/api/catalogue/services?status=active&page=3&page_size=100']);
    assert.equal(items.length, 220);
  });

  it('an inactive service is never offered, even if one slips into the answer', async () => {
    const items = await listStartableServices({}, async () => ({ items: [{ service_id: 'a', is_active: true }, { service_id: 'b', is_active: false }], total: 2 }));
    assert.deepEqual(items.map((s) => s.service_id), ['a']);
  });

  it('filters by name, code or office and keeps the order; options read "Name (CODE)"', () => {
    const services = [
      { service_id: '1', service_name: 'Issuance of Clearance', service_code: 'CAMP-ADMIN-CLR-001', office_code: 'CAMP-ADMIN' },
      { service_id: '2', service_name: 'Counseling Service', service_code: 'CAMP-OSAS-CNS-002', office_code: 'CAMP-OSAS' },
    ];
    assert.deepEqual(filterServices(services, 'clear').map((s) => s.service_id), ['1']);
    assert.deepEqual(filterServices(services, 'osas').map((s) => s.service_id), ['2']);
    assert.deepEqual(filterServices(services, 'cns-002').map((s) => s.service_id), ['2']);
    assert.deepEqual(filterServices(services, '  ').map((s) => s.service_id), ['1', '2']);
    assert.equal(serviceOptionLabel(services[0]), 'Issuance of Clearance (CAMP-ADMIN-CLR-001)');
  });
});

describe('the standard snapshot (MOCKED)', () => {
  it('asks Core for the standard in force today without an asOf date: the browser never works the date out', async () => {
    const urls = [];
    await getServiceStandard(SERVICE, async (url) => (urls.push(url), STANDARD));
    assert.deepEqual(urls, [`/api/catalogue/services/${SERVICE}/standard`]);
    const code = read('src/lib/api/transactions.js').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /asOf|new Date|toISOString/);
  });

  it('shows the three parts of the standard as given, without calculating anything', () => {
    assert.equal(formatStandardDuration(STANDARD), '1 day 2 hours 30 minutes');
    assert.equal(formatStandardDuration({ duration_days: 3, duration_hours: 0, duration_minutes: 0 }), '3 days');
    assert.equal(formatStandardDuration({ duration_days: 0, duration_hours: 1, duration_minutes: 1 }), '1 hour 1 minute');
    assert.equal(formatStandardDuration({ duration_days: 0, duration_hours: 0, duration_minutes: 45 }), '45 minutes');
    assert.equal(formatStandardDuration({ duration_days: 0, duration_hours: 0, duration_minutes: 0 }), 'No duration set');
    assert.equal(formatStandardDuration(null), '');
  });

  it('a service with no standard in force blocks the start and says why', () => {
    const result = standardLoadResult(apiError(404, 'STANDARD_NOT_FOUND', 'No standard is in force for this service on 2026-10-23'));
    assert.equal(result.kind, 'none');
    assert.match(result.message, /No standard is in force for this service today/);
  });

  it('an inactive or missing service, a 403 and an unavailable catalogue each block with a clear message', () => {
    assert.equal(standardLoadResult(apiError(409, 'SERVICE_INACTIVE')).kind, 'inactive');
    assert.equal(standardLoadResult(apiError(404, 'SERVICE_NOT_FOUND')).kind, 'notfound');
    assert.deepEqual(standardLoadResult(apiError(403, 'FORBIDDEN', 'Insufficient role at x.js')), { kind: 'forbidden', message: MESSAGES.forbidden });
    for (const status of [502, 503, 504, 500]) {
      const r = standardLoadResult(apiError(status, 'X', 'pg: boom at core.js:9'));
      assert.equal(r.kind, 'unavailable');
      assert.doesNotMatch(r.message, /pg|boom|core\.js/);
    }
    assert.equal(standardLoadResult(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.')).message, 'Cannot reach the server. Check your connection and try again.');
  });
});

describe('the required-documents checklist', () => {
  it('has one checkbox for each mandatory document and none for optional ones', () => {
    assert.deepEqual(itemsOf.map((i) => i.id), ['d1', 'd2']);
    assert.deepEqual(itemsOf.map((i) => i.label), ['Valid ID', 'Request letter']);
    assert.equal(itemsOf[1].notes, 'Signed');
  });

  it('starts with nothing checked, and needs every item checked', () => {
    assert.equal(allConfirmed(itemsOf, {}), false);
    assert.equal(allConfirmed(itemsOf, { d1: true }), false);
    assert.equal(allConfirmed(itemsOf, { d1: true, d2: false }), false);
    assert.equal(allConfirmed(itemsOf, allChecked), true);
    assert.equal(allConfirmed(itemsOf, { d1: 'yes', d2: 1 }), false, 'only a real true counts');
    assert.equal(allConfirmed([], {}), false, 'an empty checklist never counts as confirmed');
  });

  it('a service with no mandatory document still needs one explicit confirmation (the server requires requirements_confirmed)', () => {
    const none = requirementItems([{ document_id: 'd3', document_name: 'Optional photo', is_mandatory: false }]);
    assert.deepEqual(none.map((i) => i.id), [NO_DOCUMENTS_KEY]);
    assert.equal(allConfirmed(none, {}), false);
    assert.equal(allConfirmed(none, { [NO_DOCUMENTS_KEY]: true }), true);
    assert.deepEqual(requirementItems([]).map((i) => i.id), [NO_DOCUMENTS_KEY]);
    assert.deepEqual(requirementItems(undefined).map((i) => i.id), [NO_DOCUMENTS_KEY]);
  });

  it('is rebuilt from the new service\'s documents, so a checked item cannot carry over', () => {
    const other = requirementItems([{ document_id: 'x9', document_name: 'Other form', is_mandatory: true }]);
    assert.equal(allConfirmed(other, allChecked), false);
    const page = read('src/app/transactions/new/page.js');
    assert.match(page, /function chooseService\(serviceId\) \{[\s\S]*?setChecks\(\{\}\);/);
  });

  it('gets its documents from the service detail (Core), where each document says is_mandatory', async () => {
    const urls = [];
    const detail = await getServiceDetail(SERVICE, async (url) => (urls.push(url), { service: {}, standards: [], documents: DOCS }));
    assert.deepEqual(urls, [`/api/catalogue/services/${SERVICE}`]);
    assert.equal(detail.documents.length, 3);
  });
});

describe('the client fields and early validation', () => {
  const ready = { standard: STANDARD, items: itemsOf, checks: allChecked, countersEnabled: false };

  it('a complete form has no errors; reference and email are optional', () => {
    assert.deepEqual(startErrors({ form: form(), ...ready }), {});
    assert.deepEqual(startErrors({ form: form({ client_reference: 'REF-1', client_email: 'a@b.co' }), ...ready }), {});
  });

  it('the client type is required and must be one the service supports', () => {
    assert.deepEqual(CLIENT_TYPES.map((t) => t.value), ['STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL']);
    assert.equal(startErrors({ form: form({ client_type: '' }), ...ready }).client_type, MESSAGES.clientType);
    assert.equal(startErrors({ form: form({ client_type: 'student' }), ...ready }).client_type, MESSAGES.clientType);
    assert.equal(startErrors({ form: form({ client_type: 'CITIZEN' }), ...ready }).client_type, MESSAGES.clientType);
  });

  it('an email is checked only when one is given', () => {
    for (const bad of ['nope', 'a@b', '@b.co', 'a b@c.co', 'a@@b.co']) assert.equal(startErrors({ form: form({ client_email: bad }), ...ready }).client_email, MESSAGES.email, bad);
    assert.equal(startErrors({ form: form({ client_email: '   ' }), ...ready }).client_email, undefined);
    assert.equal(startErrors({ form: form({ client_email: `${'a'.repeat(250)}@b.co` }), ...ready }).client_email, MESSAGES.emailLong);
  });

  it('a long client reference is refused', () => {
    assert.equal(startErrors({ form: form({ client_reference: 'x'.repeat(100) }), ...ready }).client_reference, undefined);
    assert.equal(startErrors({ form: form({ client_reference: 'x'.repeat(101) }), ...ready }).client_reference, MESSAGES.reference);
  });

  it('missing documents, no service and no loaded standard are each reported', () => {
    assert.equal(startErrors({ form: form(), ...ready, checks: { d1: true } }).requirements, MESSAGES.requirements);
    assert.equal(startErrors({ form: form({ service_id: '' }), ...ready }).service, MESSAGES.service);
    assert.equal(startErrors({ form: form(), ...ready, standard: null }).standard, MESSAGES.standardMissing);
  });

  it('when counters are enabled a counter must be chosen, and never a default one', () => {
    assert.equal(startErrors({ form: form(), ...ready, countersEnabled: true }).counter, MESSAGES.counter);
    assert.equal(startErrors({ form: form({ counter_id: COUNTER }), ...ready, countersEnabled: true }).counter, undefined);
    assert.equal(EMPTY_START_FORM.counter_id, '');
    assert.equal(startErrors({ form: form(), ...ready, countersEnabled: false }).counter, undefined);
  });
});

describe('the request that is sent (MOCKED fetcher; the body matches Operations parseStartInput)', () => {
  it('has exactly the accepted fields, trimmed, with requirements_confirmed true', () => {
    assert.deepEqual(
      buildStartBody({ form: form({ client_reference: '  REF-7 ', client_email: ' a@b.co ' }), countersEnabled: false }),
      { service_id: SERVICE, client_type: 'STUDENT', requirements_confirmed: true, client_reference: 'REF-7', client_email: 'a@b.co' },
    );
  });

  it('leaves out an empty reference and email, and the counter when counters are off', () => {
    assert.deepEqual(buildStartBody({ form: form({ client_reference: '  ', client_email: '', counter_id: COUNTER }), countersEnabled: false }), { service_id: SERVICE, client_type: 'STUDENT', requirements_confirmed: true });
  });

  it('adds the chosen counter when counters are enabled', () => {
    assert.equal(buildStartBody({ form: form({ counter_id: COUNTER }), countersEnabled: true }).counter_id, COUNTER);
  });

  it('never carries a tracking number, status, standard or audit data: the server sets those', () => {
    const body = buildStartBody({ form: form({ client_reference: 'R', client_email: 'a@b.co', counter_id: COUNTER }), countersEnabled: true });
    assert.deepEqual(Object.keys(body).sort(), ['client_email', 'client_reference', 'client_type', 'counter_id', 'requirements_confirmed', 'service_id']);
    const page = read('src/app/transactions/new/page.js') + read('src/lib/ui/start-transaction.js') + read('src/lib/api/transactions.js');
    assert.doesNotMatch(page.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n'), /tracking_no\s*[:=]|audit|recordAudit|padStart/i);
  });

  it('POSTs to /api/operations/transactions and returns what the server answered', async () => {
    const calls = [];
    const answer = { transaction_id: 't1', tracking_no: 'CAMP-ADMIN-20261023-0001', status: 'IN_PROGRESS' };
    const out = await postTransaction({ service_id: SERVICE }, async (url, init) => (calls.push([url, init]), answer));
    assert.deepEqual(calls, [[TRANSACTIONS_API, { method: 'POST', body: { service_id: SERVICE } }]]);
    assert.equal(TRANSACTIONS_API, '/api/operations/transactions');
    assert.equal(out, answer, 'the tracking number shown is the server\'s, untouched');
  });

  it('the success view prints the tracking number and status from the response, not a value of its own', () => {
    const page = read('src/app/transactions/new/page.js');
    assert.match(page, /\{result\.tracking_no\}/);
    assert.match(page, /statusLabel\(result\.status\)/);
    assert.equal(statusLabel('IN_PROGRESS'), 'In progress');
    assert.equal(statusLabel('ON_HOLD'), 'On hold');
  });
});

describe('what a refused start says', () => {
  it('maps the server\'s 400 details onto the fields', () => {
    const r = startErrorResult(apiError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { client_type: 'Client type is required', client_email: 'Enter a valid email address', requirements_confirmed: 'Confirm that all required documents are present before starting', counter_id: 'Choose your counter', service_id: 'Choose a service' }));
    assert.equal(r.kind, 'validation');
    assert.deepEqual(r.fieldErrors, { client_type: 'Client type is required', client_email: 'Enter a valid email address', requirements: 'Confirm that all required documents are present before starting', counter: 'Choose your counter', service: 'Choose a service' });
    assert.equal(r.message, null);
  });

  it('names a duplicate open transaction and a busy counter', () => {
    assert.deepEqual(startErrorResult(apiError(409, 'OPEN_TRANSACTION_EXISTS')), { kind: 'open', fieldErrors: {}, message: 'You already have an open transaction. Complete or hand it over first.' });
    assert.deepEqual(startErrorResult(apiError(409, 'COUNTER_BUSY')), { kind: 'counter_busy', fieldErrors: {}, message: 'This counter already has an open transaction.' });
  });

  it('explains an inactive service and a service with no standard in force', () => {
    assert.equal(startErrorResult(apiError(409, 'SERVICE_INACTIVE')).kind, 'inactive');
    assert.match(startErrorResult(apiError(409, 'STANDARD_NOT_IN_FORCE')).message, /No standard is in force/);
    assert.equal(startErrorResult(apiError(404, 'SERVICE_NOT_FOUND')).kind, 'notfound');
  });

  it('a catalogue timeout (after the server\'s own retry) is one clear message, with no retry loop of our own', () => {
    for (const status of [502, 503, 504]) assert.deepEqual(startErrorResult(apiError(status, 'CATALOGUE_UNAVAILABLE', 'Cannot reach the service catalogue right now. Try again, or record the transaction later as a backdated entry.')), { kind: 'unavailable', fieldErrors: {}, message: MESSAGES.catalogueDown });
    assert.doesNotMatch(read('src/app/transactions/new/page.js'), /setTimeout|setInterval|retry\(/);
  });

  it('401, 403, network and server errors are safe and never show server detail', () => {
    assert.equal(startErrorResult(apiError(401, 'UNAUTHORIZED')).kind, 'auth');
    const forbidden = startErrorResult(apiError(403, 'FORBIDDEN', 'Insufficient role at /srv/a.js:1'));
    assert.deepEqual([forbidden.kind, forbidden.message], ['forbidden', MESSAGES.forbidden]);
    assert.equal(startErrorResult(apiError(undefined, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.')).kind, 'network');
    for (const status of [500, 501]) {
      const r = startErrorResult(apiError(status, 'INTERNAL_ERROR', 'TypeError at pg.js:9'));
      assert.deepEqual([r.kind, r.message], ['server', MESSAGES.serverError]);
    }
  });

  it('after a conflict it can name the open transaction: the person\'s own, or the one on that counter', async () => {
    const open = [
      { tracking_no: 'CAMP-ADMIN-20261023-0002', status: 'IN_PROGRESS', started_by: 'other' },
      { tracking_no: 'CAMP-ADMIN-20261023-0001', status: 'ON_HOLD', started_by: 'me' },
    ];
    assert.equal(conflictTransaction('open', open, 'me').tracking_no, 'CAMP-ADMIN-20261023-0001');
    assert.equal(conflictTransaction('open', open, 'nobody'), null);
    assert.equal(conflictTransaction('counter_busy', open, 'me').tracking_no, 'CAMP-ADMIN-20261023-0002');
    assert.equal(conflictTransaction('counter_busy', [], 'me'), null);
    const urls = [];
    const found = await listOpenTransactions({ counterId: COUNTER }, async (url) => (urls.push(url), { items: [] }));
    assert.deepEqual(urls, [`/api/operations/transactions?status=IN_PROGRESS&counter_id=${COUNTER}&page_size=50`, `/api/operations/transactions?status=ON_HOLD&counter_id=${COUNTER}&page_size=50`]);
    assert.deepEqual(found, []);
  });
});

describe('the screen\'s own guards (source checks, not a browser)', () => {
  const page = read('src/app/transactions/new/page.js');

  it('blocks a second submission while one is running, and the button says so', () => {
    assert.match(page, /const submittingRef = useRef\(false\)/);
    assert.match(page, /if \(submittingRef\.current \|\| locked\) return;/);
    assert.match(page, /submittingRef\.current = true;/);
    assert.match(page, /disabled=\{submitting \|\| !ready \|\| !settings\.loaded\}/);
    assert.match(page, /\{submitting \? 'Starting…' : past\.enabled \? \(past\.manual_end \? 'Record past transaction' : 'Start past transaction'\) : 'Start transaction'\}/);
  });

  it('the Start button stays disabled until the service, its standard and every document confirmation are in place', () => {
    assert.match(page, /const standardOk = past\.enabled \? pastStandard\.state === 'ready' \|\| pastStandard\.state === 'idle' : standard\.state === 'ready';/);
    assert.match(page, /const ready = Boolean\(form\.service_id\) && standardOk && documentsReady && allConfirmed\(items, checks\) && !locked;/);
  });

  it('ignores the answer for a service that is no longer chosen', () => {
    assert.match(page, /const latestService = useRef\(0\)/);
    assert.match(page, /if \(!current\(\)\) return;/);
  });

  it('shows the counter picker only when counters are enabled, loaded from the service, with no default', () => {
    assert.match(page, /\{countersEnabled \? \(\s*<Section title="Counter"/);
    assert.match(page, /filter\(\(c\) => c\.is_active\)/);
    assert.match(page, /listCounters\(officeId\)/);
  });

  it('does not mutate anything but the one POST, and never touches audit', () => {
    const code = page.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.equal([...code.matchAll(/postTransaction\(/g)].length, 1);
    assert.doesNotMatch(code, /\bPUT\b|\bPATCH\b|\bDELETE\b|apiFetch\(/);
  });
});
