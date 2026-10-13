import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

// The browser session client (src/lib/auth/session.js) with a fake window, sessionStorage and fetch.
// Roles are the canonical lowercase values from ccms-shared/roles (what Identity puts in the token).
const claims = { sub: 'u1', employee_no: 'E-1', full_name: 'Test User', role: 'super_admin', office_id: null };
const jwt = (extra = {}) => `h.${Buffer.from(JSON.stringify({ ...claims, ...extra })).toString('base64url')}.s`;
const tokenResponse = (expiresIn = 900, extra = {}) => new Response(JSON.stringify({ access_token: jwt(extra), expires_in: expiresIn }), { status: 200 });

let store;
let calls;
let nextResponses;
let counter = 0;
let jar;

beforeEach(() => {
  store = new Map();
  calls = [];
  nextResponses = [];
  jar = new Map();
  globalThis.document = {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(line) {
      const [pair, ...attrs] = line.split('; ');
      const [k, v] = pair.split('=');
      if (attrs.some((a) => a === 'max-age=0')) jar.delete(k);
      else jar.set(k, v);
    },
  };
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: { pathname: '/services', assign: (url) => calls.push(`assign ${url}`) },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`fetch ${url}`);
    if (init.headers?.authorization) calls.push(`auth ${url}`);
    const next = nextResponses.shift();
    if (next instanceof Error) throw next;
    return next ?? new Response('{}', { status: 500 });
  };
});

// A fresh copy of the module is what a new page load sees (module state is lost, sessionStorage stays).
const freshPage = () => import(`../../src/lib/auth/session.js?page=${++counter}`);

describe('session client', () => {
  it('keeps the access token across page loads without calling Identity', async () => {
    const first = await freshPage();
    nextResponses.push(tokenResponse());
    await first.signIn('a@b.c', 'pw');
    calls.length = 0;
    const second = await freshPage();
    const user = await second.refreshSession();
    assert.equal(user.role, 'super_admin');
    assert.deepEqual(calls, [], 'a still-valid token needs no call to Identity');
    assert.ok(await second.getAccessToken());
  });

  it('ignores an expired saved token and asks Identity', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt(), expiresAt: Date.now() - 1000 }));
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 401 }));
    assert.equal(await page.refreshSession(), null);
    assert.deepEqual(calls, ['fetch /api/identity/auth/refresh']);
    assert.equal(store.has('ccms_access'), false);
  });

  it('an expired or revoked refresh token (401) signs the user out', async () => {
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 401 }));
    assert.equal(await page.refreshSession(), null);
  });

  it('Identity down (502) shows a clear message instead of signing out', async () => {
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 502 }));
    await assert.rejects(page.refreshSession(), (e) => e.code === 'IDENTITY_UNAVAILABLE' && /sign-in service is not available/.test(e.message));
    nextResponses.push(new Error('connect ECONNREFUSED'));
    await assert.rejects(page.refreshSession(), (e) => e.code === 'IDENTITY_UNAVAILABLE');
    assert.ok(!calls.some((c) => c.startsWith('assign')), 'no redirect to a sign-in page that is also down');
  });

  it('with Identity down, a token that is close to expiry but still valid keeps working', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt(), expiresAt: Date.now() + 10_000 }));
    jar.set('ccms_signed_in', '1');
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 503 }));
    assert.ok(await page.getAccessToken());
  });

  it('with Identity down and the token expired, the user is told, not redirected', async () => {
    const page = await freshPage();
    nextResponses.push(new Response('{}', { status: 502 }));
    await assert.rejects(page.getAccessToken(), (e) => e.code === 'IDENTITY_UNAVAILABLE');
  });

  it('signing out in another app on the same host makes this one drop its saved token', async () => {
    const first = await freshPage();
    nextResponses.push(tokenResponse());
    await first.signIn('a@b.c', 'pw');
    jar.delete('ccms_signed_in'); // what a sign-out in another app (another port, same host) does
    calls.length = 0;
    const second = await freshPage();
    nextResponses.push(new Response('{}', { status: 401 }));
    assert.equal(await second.refreshSession(), null, 'no saved token is trusted; Identity says the session is gone');
    assert.ok(calls.some((c) => c.includes('/auth/refresh')));
  });

  it('sign out clears the saved token', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse());
    await page.signIn('a@b.c', 'pw');
    assert.ok(store.has('ccms_access'));
    nextResponses.push(new Response(null, { status: 204 }));
    await page.signOut();
    assert.equal(store.has('ccms_access'), false);
    assert.ok(calls.includes('assign /'));
  });

  it('sign out goes to the sign-in page to finish the job when Identity could not be reached', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse());
    await page.signIn('a@b.c', 'pw');
    nextResponses.push(new Response('not found', { status: 404 }));
    await page.signOut();
    assert.equal(store.has('ccms_access'), false);
    assert.ok(calls.includes('assign /login?signed_out=1&notice=revoke_failed'));
  });

  it('sign out with Identity unreachable (network error) still clears the token and does not reject', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse());
    await page.signIn('a@b.c', 'pw');
    nextResponses.push(new Error('connect ECONNREFUSED'));
    const result = await page.signOut();
    assert.equal(result.revoked, false);
    assert.equal(store.has('ccms_access'), false);
    assert.equal(jar.has('ccms_signed_in'), false);
    assert.deepEqual(calls.filter((c) => c.includes('/auth/logout')), ['fetch /api/identity/auth/logout'], 'revoked once');
    assert.ok(calls.includes('assign /login?signed_out=1&notice=revoke_failed'));
  });
});

describe('session client: role claim', () => {
  for (const [label, extra] of [
    ['missing', { role: undefined }],
    ['not a string', { role: 7 }],
    ['wrong case', { role: 'SUPER_ADMIN' }],
    ['unknown', { role: 'citizen' }],
  ]) {
    it(`sign-in with a ${label} role is refused and nothing is stored`, async () => {
      const page = await freshPage();
      nextResponses.push(tokenResponse(900, extra));
      await assert.rejects(page.signIn('a@b.c', 'pw'), (e) => e.code === 'ROLE_NOT_RECOGNIZED' && e.message === 'Your account role is not recognized. Contact a Super Admin.');
      assert.equal(page.currentUser(), null);
      assert.equal(store.has('ccms_access'), false);
      assert.equal(jar.has('ccms_signed_in'), false);
    });
  }

  it('a refresh that returns an unrecognized role ends the session, explains why, and never sends that token', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse(900, { role: 'Super_Admin' }));
    assert.equal(await page.refreshSession(), null);
    assert.equal(page.sessionRejection(), 'ROLE_NOT_RECOGNIZED');
    assert.equal(store.has('ccms_access'), false);
    // apiFetch asks Identity again (refused again) and sends no bearer token anywhere.
    nextResponses.push(tokenResponse(900, { role: 'Super_Admin' }));
    await assert.rejects(page.apiFetch('/api/catalogue/offices'), (e) => e.code === 'SESSION_ENDED');
    assert.ok(!calls.some((c) => c.startsWith('auth ')), 'the rejected token was never sent');
    assert.ok(!calls.includes('fetch /api/catalogue/offices'));
  });

  it('a saved token with an unrecognized role is not reused after a page load', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt({ role: 'admin' }), expiresAt: Date.now() + 600_000 }));
    jar.set('ccms_signed_in', '1');
    const page = await freshPage();
    assert.equal(page.currentUser(), null);
    assert.equal(page.sessionRejection(), 'ROLE_NOT_RECOGNIZED');
    assert.equal(store.has('ccms_access'), false);
  });

  it('an expired saved token with a good role is not reported as a role problem', async () => {
    store.set('ccms_access', JSON.stringify({ token: jwt(), expiresAt: Date.now() - 1000 }));
    jar.set('ccms_signed_in', '1');
    const page = await freshPage();
    assert.equal(page.currentUser(), null);
    assert.equal(page.sessionRejection(), null);
  });

  it('a good sign-in after a rejection clears the rejection', async () => {
    const page = await freshPage();
    nextResponses.push(tokenResponse(900, { role: 'nope' }));
    await assert.rejects(page.signIn('a@b.c', 'pw'));
    nextResponses.push(tokenResponse());
    const user = await page.signIn('a@b.c', 'pw');
    assert.equal(user.role, 'super_admin');
    assert.equal(page.sessionRejection(), null);
  });
});
