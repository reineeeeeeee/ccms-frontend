'use client';

import { useEffect, useState } from 'react';
import { landingForRole } from 'ccms-shared/nav';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import { BRAND } from '../../lib/constants/brand.js';
import { ROLE_NOT_RECOGNIZED, ROLE_NOT_RECOGNIZED_MESSAGE } from '../../lib/auth/guards.js';
import { clearToken, refreshSession, revokeServerSession, sessionRejection, signIn } from '../../lib/auth/session.js';
import { LOGIN_NOTICES, noticeAfterRetry, parseLoginNotice } from '../../lib/auth/sign-out-flow.js';
import BrandMark from '../../components/ui/BrandMark.js';

// The ?signed_out=1 retry, shared while it runs so React Strict Mode's second effect run in
// development does not send a second revocation request.
let pendingRetry = null;
function retryRevocation() {
  pendingRetry ??= revokeServerSession().finally(() => {
    pendingRetry = null;
  });
  return pendingRetry;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState(null); // a LOGIN_NOTICES code, never text from the URL
  const [retry, setRetry] = useState({ busy: false, result: null });

  // Already signed in (valid refresh cookie)? Go straight to the role's page.
  // After "Sign out" (?signed_out=1) never do that: Identity could not confirm the sign-out, so try
  // the revocation once more here and only report a failure if this attempt fails too.
  useEffect(() => {
    let cancelled = false;
    const search = window.location.search;
    if (new URLSearchParams(search).has('signed_out')) {
      clearToken();
      const requested = parseLoginNotice(search);
      retryRevocation().then((revoked) => {
        window.history.replaceState(null, '', window.location.pathname);
        if (cancelled) return;
        setNotice(noticeAfterRetry({ requested, retryRevoked: revoked }));
        setChecking(false);
      });
      return () => {
        cancelled = true;
      };
    }
    refreshSession()
      .then((user) => {
        if (cancelled) return;
        if (user) {
          window.location.assign(landingForRole(user.role));
          return;
        }
        // A session whose role is not recognized was dropped: say why and keep the form here.
        if (sessionRejection() === ROLE_NOT_RECOGNIZED) setError(ROLE_NOT_RECOGNIZED_MESSAGE);
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await signIn(email, password);
      window.location.assign(landingForRole(user.role));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function retryRevoke() {
    setRetry({ busy: true, result: null });
    const revoked = await revokeServerSession();
    if (revoked) setNotice(null);
    setRetry({ busy: false, result: revoked ? 'revoked' : 'failed' });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F4EF] text-sm text-[#7A756D]">
        Checking your session…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh] w-full flex-col lg:flex-row">
      {/* Left branding panel: ~49% on desktop with deep maroon gradient and subtle warm ambient glow */}
      <div
        className="relative flex w-full flex-col justify-between overflow-hidden px-8 py-10 sm:px-12 sm:py-12 lg:w-[49.2%] lg:min-h-[100dvh] lg:px-14 lg:py-14"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 85% 15%, rgba(229, 181, 43, 0.26) 0%, rgba(107, 15, 15, 0.35) 45%, transparent 70%), linear-gradient(145deg, #3D0606 0%, #520909 52%, #6B0F0F 100%)',
        }}
      >
        {/* Header: official PUP logo and university brand text */}
        <div className="flex items-center gap-3.5">
          <BrandMark size={48} />
          <div>
            <p className="text-[17px] font-bold leading-tight tracking-tight text-white">{BRAND.campus}</p>
            <p className="mt-0.5 text-xs font-medium tracking-wide text-white/70">{BRAND.system}</p>
          </div>
        </div>

        {/* Lower-middle main title block with horizontal gold accent line */}
        <div className="my-16 lg:my-auto lg:pt-16 lg:pb-12">
          <div className="mb-6 h-1 w-12 rounded-full bg-[#E5B52B]" />
          <h1 className="max-w-lg text-3xl font-bold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-[42px]">
            Citizen&apos;s Charter
            <br />
            Compliance/Monitoring
            <br />
            System
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-white/80 sm:text-base">
            Monitor how each office keeps the promises in the Citizen&apos;s Charter.
          </p>
        </div>

        {/* Left footer note */}
        <p className="text-xs tracking-wide text-white/50">Staff sign-in only.</p>
      </div>

      {/* Right sign-in panel: ~51% on desktop with warm off-white background */}
      <div className="flex w-full flex-1 items-center justify-center bg-[#F7F4EF] p-4 sm:p-8 lg:w-[50.8%] lg:min-h-[100dvh] lg:p-12">
        <div className="w-full max-w-[526px] rounded-2xl border border-[#E8E3D9] bg-white p-7 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.04)] sm:p-10">
          <form onSubmit={onSubmit} className="space-y-6" noValidate>
            {notice ? (
              <div className="space-y-2">
                <ErrorBanner message={LOGIN_NOTICES[notice]} />
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-secondary px-3 py-1.5" onClick={retryRevoke} disabled={retry.busy}>
                    {retry.busy ? 'Trying again…' : 'Try again'}
                  </button>
                  {retry.result === 'failed' ? (
                    <span role="status" className="text-xs text-slate-600">
                      Still could not reach the server.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : retry.result === 'revoked' ? (
              <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                The server confirmed that your session has ended.
              </p>
            ) : null}

            {/* Card heading and subtitle */}
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[#520909] sm:text-[30px]">Sign in</h2>
              <p className="mt-1 text-sm text-[#7A756D] sm:text-[15px]">Use your CCMS account.</p>
            </div>

            {/* EMAIL field */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B655B]" htmlFor="email">
                EMAIL
              </label>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-4 text-[#8C857B]" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </span>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  className="h-14 w-full rounded-xl border border-[#DFD9CE] bg-white pl-12 pr-4 text-base text-[#2B2724] placeholder:text-[#A39C91] transition-colors focus:border-[#520909] focus:outline-none focus:ring-1 focus:ring-[#520909]"
                  placeholder="name@pup.edu.ph"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            {/* PASSWORD field with Show/Hide toggle */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B655B]" htmlFor="password">
                PASSWORD
              </label>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-4 text-[#8C857B]" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="h-14 w-full rounded-xl border border-[#DFD9CE] bg-white pl-12 pr-20 text-base text-[#2B2724] placeholder:text-[#A39C91] transition-colors focus:border-[#520909] focus:outline-none focus:ring-1 focus:ring-[#520909]"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-4 rounded px-1.5 py-1 text-sm font-semibold text-[#520909] transition-colors hover:text-[#6B0F0F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B52B]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Submit button: full width maroon button matching reference */}
            <div className="pt-2">
              <button
                type="submit"
                className="flex h-14 w-full items-center justify-center rounded-xl bg-[#520909] text-base font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-[#6B0F0F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B52B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>

            <ErrorBanner message={error} />

            <p className="text-center text-xs text-[#7A756D]">
              Forgot your password? Ask a Super Admin to send you a reset link.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
