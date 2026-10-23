'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { landingForRole } from 'ccms-shared/nav';
import { activeNavHref, appNavForRole } from '../../lib/auth/permissions.js';
import { ROLES, ROLE_LABELS } from 'ccms-shared/roles';
import { BRAND } from '../../lib/constants/brand.js';
import { ROLE_NOT_RECOGNIZED, ROLE_NOT_RECOGNIZED_MESSAGE, isRoleAllowed } from '../../lib/auth/guards.js';
import { getAccessToken, redirectToLogin, refreshSession, sessionRejection } from '../../lib/auth/session.js';
import { useSignOut } from '../../lib/auth/useSignOut.js';
import Breadcrumb from '../navigation/Breadcrumb.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import ErrorBanner from '../feedback/ErrorBanner.js';
import BrandMark from '../ui/BrandMark.js';
import NavIcon from './NavIcon.js';
import RowActionMenu from '../ui/RowActionMenu.js';

function initials(name) {
  return (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

// Active verified session and sidebar state. Populated only after verification post-hydration.
// On server and during first client hydration, activeSessionUser is null, guaranteeing
// identical initial loading markup and zero hydration mismatch.
let activeSessionUser = null;
let activeSidebarCollapsed = null;

function getInitialState() {
  if (activeSessionUser) {
    return { status: 'ready', user: activeSessionUser, message: null };
  }
  return { status: 'loading', user: null, message: null };
}

function getInitialCollapsed() {
  if (activeSidebarCollapsed !== null) {
    return activeSidebarCollapsed;
  }
  return false;
}

function persistCollapsed(value) {
  activeSidebarCollapsed = value;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem('ccms_sidebar_collapsed', String(value));
    } catch {
      /* storage blocked or unavailable */
    }
  }
}

/**
 * Layout for every signed-in page: header with the user and Sign out, and navigation that shows
 * only the current role's pages. Pass allowedRoles to keep other roles off a page (the API still
 * enforces access on the server).
 */
export default function AppShell({ title, subtitle, eyebrow, breadcrumb, headerRight, allowedRoles, pageClassName, titleClassName, subtitleClassName, children }) {
  const pathname = usePathname();
  const [state, setState] = useState(getInitialState);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(getInitialCollapsed);
  const signOutControl = useSignOut();
  const signOutButtonRef = useRef(null);

  const toggleCollapsed = () => {
    setCollapsedState((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((user) => {
        if (cancelled) return;
        if (user) {
          activeSessionUser = user;
          if (activeSidebarCollapsed === null && typeof window !== 'undefined') {
            try {
              const stored = window.sessionStorage.getItem('ccms_sidebar_collapsed');
              if (stored !== null) {
                const isCollapsed = stored === 'true';
                activeSidebarCollapsed = isCollapsed;
                setCollapsedState(isCollapsed);
              } else {
                activeSidebarCollapsed = false;
              }
            } catch {
              activeSidebarCollapsed = false;
            }
          }
          setState({ status: 'ready', user, message: null });
        } else if (sessionRejection() === ROLE_NOT_RECOGNIZED) {
          activeSessionUser = null;
          setState({ status: 'rejected', user: null, message: ROLE_NOT_RECOGNIZED_MESSAGE });
        } else {
          activeSessionUser = null;
          redirectToLogin();
        }
      })
      .catch((err) => {
        if (!cancelled) {
          activeSessionUser = null;
          setState({ status: 'error', user: null, message: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the session alive quietly and notice a revoked one.
  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    const timer = setInterval(async () => {
      try {
        if (!(await getAccessToken())) redirectToLogin();
      } catch {
        /* offline: try again on the next tick */
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [state.status]);

  if (state.status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Checking your session…</div>;
  }
  if (state.status === 'rejected') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <ErrorBanner message={state.message} />
        {/* A full page load on purpose: the sign-in page starts from a clean session. */}
        <a className="btn-primary" href="/login">
          Go to sign in
        </a>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <ErrorBanner message={state.message} />
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const { user } = state;
  // The shared nav calls the signed-in landing page "Home"; this app shows it as "Dashboard".
  const nav = appNavForRole(user.role).map((item) => (item.href === '/' && item.label === 'Home' ? { ...item, label: 'Dashboard' } : item));
  const activeHref = activeNavHref(nav, pathname);
  const sections = [...new Set(nav.map((item) => item.section))];
  const allowed = isRoleAllowed(user, allowedRoles);

  return (
    <div className="min-h-screen bg-page lg:flex">
      {/* Geometry follows the reference screenshot (253px wide crop, 1x): 256px sidebar, 61px header,
          38px items on a 40px pitch, 12px free space on the right, active bar flush with the left edge. */}
      <aside
        id="app-sidebar"
        className={`${menuOpen ? 'block' : 'hidden'} font-sans relative w-full shrink-0 bg-[#3D0606] text-white transition-all duration-200 lg:sticky lg:top-0 lg:block lg:h-screen lg:self-start ${
          collapsed ? 'lg:w-[72px]' : 'lg:w-[220px]'
        }`}
      >
        {/* Floating circular toggle button straddling the right edge */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden lg:flex absolute -right-4 top-5 z-30 h-8 w-8 items-center justify-center rounded-full bg-white text-[#3D0606] shadow-md border border-slate-200/80 hover:bg-slate-50 hover:scale-105 active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5B53A]"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
          </svg>
        </button>

        {/* Inner vertical scrolling container */}
        <div className="flex h-full flex-col overflow-y-auto">
          {/* Branding Header */}
          <div
            className={`flex h-[72px] shrink-0 border-b border-white/10 bg-[#3D0606] transition-all duration-200 ${
              collapsed
                ? 'items-center justify-center px-2'
                : 'items-center px-4'
            }`}
          >
            <div className={`flex items-center min-w-0 ${collapsed ? 'justify-center' : 'gap-3'}`}>
              <div className="shrink-0 flex items-center justify-center">
                <BrandMark size={collapsed ? 34 : 36} />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold leading-tight tracking-tight text-white">{BRAND.campus}</p>
                  <p className="truncate text-[10px] font-semibold leading-tight text-[#E5B53A] mt-0.5">{BRAND.system}</p>
                </div>
              )}
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className={`space-y-5 py-4 ${collapsed ? 'px-1.5' : 'px-2.5'}`} aria-label="Main navigation">
            {sections.map((section) => (
              <div key={section}>
                {collapsed ? (
                  <div className="my-2 border-t border-white/10 mx-2" aria-hidden="true" />
                ) : (
                  <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[#E5B53A]">
                    {section}
                  </p>
                )}
                <ul className="space-y-1">
                  {nav
                    .filter((item) => item.section === section)
                    .map((item) => {
                      const active = item.href === activeHref;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            title={item.label}
                            className={`group relative flex h-10 items-center rounded-lg text-xs font-medium transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E5B53A] ${
                              active
                                ? 'bg-[#783535] text-white shadow-sm font-semibold'
                                : 'text-white/80 hover:bg-white/10 hover:text-white'
                            } ${
                              collapsed
                                ? 'w-10 mx-auto justify-center px-0'
                                : 'w-full px-2.5'
                            }`}
                          >
                            {active && (
                              <span
                                className="absolute left-1 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-[#E5B53A]"
                                aria-hidden="true"
                              />
                            )}
                            {collapsed ? (
                              <>
                                <NavIcon href={item.href} />
                                <span className="sr-only">{item.label}</span>
                              </>
                            ) : (
                              <span className={`flex items-center gap-2.5 ${active ? 'pl-1.5' : ''}`}>
                                <NavIcon href={item.href} />
                                <span className="truncate">{item.label}</span>
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className={`min-w-0 flex-1 ${pageClassName ?? ''}`.trim()}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <button type="button" className="btn-secondary px-3 py-1.5 lg:hidden" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="app-sidebar">
              Menu
            </button>
            {breadcrumb ? <Breadcrumb items={breadcrumb} className="text-base text-slate-800" /> : <span className="text-base font-bold text-slate-800">{title}</span>}
          </div>
          <RowActionMenu
            label={`Account menu for ${user.fullName}`}
            buttonRef={signOutButtonRef}
            triggerClassName="flex items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700"
            trigger={
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-950 text-sm font-bold text-white" aria-hidden="true">
                  {initials(user.fullName)}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block truncate text-sm font-bold text-slate-900">{user.fullName}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {ROLE_LABELS[user.role]}
                    {user.role === ROLES.SUPER_ADMIN ? ' · All Offices' : ''}
                  </span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 8 5 5 5-5" />
                </svg>
              </>
            }
            items={[{ label: signOutControl.busy ? 'Signing out…' : 'Sign out', disabled: signOutControl.busy, onSelect: signOutControl.request }]}
          />
        </header>

        <main className="px-4 py-6 sm:px-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
              <h1 className={titleClassName ?? 'text-3xl'}>{title}</h1>
              {subtitle ? <p className={subtitleClassName ?? 'mt-1 text-sm text-slate-600'}>{subtitle}</p> : null}
            </div>
            {allowed && headerRight ? (typeof headerRight === 'function' ? headerRight(user) : headerRight) : null}
          </div>
          {allowed ? (
            typeof children === 'function' ? children(user) : children
          ) : (
            <div className="card p-6">
              <p className="text-sm text-slate-700">Your role does not have access to this page.</p>
              <Link className="btn-primary mt-4" href={landingForRole(user.role)}>
                Go to my home
              </Link>
            </div>
          )}
        </main>
      </div>
      <ConfirmDialog {...signOutControl.dialogProps} returnFocusRef={signOutButtonRef} />
    </div>
  );
}
