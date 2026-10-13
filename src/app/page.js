'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../components/layout/AppShell.js';
import PublicHeader from '../components/layout/PublicHeader.js';
import ErrorBanner from '../components/feedback/ErrorBanner.js';
import Pager from '../components/navigation/Pager.js';
import StatusBadge from '../components/ui/StatusBadge.js';
import { BRAND } from '../lib/constants/brand.js';
import { currentUser, mightBeSignedIn, refreshSession } from '../lib/auth/session.js';
import { publicFetch, toQuery } from '../lib/api/client.js';
import { PUBLIC_SERVICES_API, classificationLabel } from '../lib/api/catalogue.js';

const PAGE_SIZE = 12;
const API = PUBLIC_SERVICES_API;

// Quick links under the hero. Each one does something real on this page.
const TILES = [
  { title: 'Browse all services', text: 'See every service the University offers, A to Z.', action: 'browse', icon: 'M4 6h16M4 12h16M4 18h10' },
  { title: 'Find by office', text: 'Type an office name to see only its services.', action: 'search', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6' },
  { title: 'What to bring', text: 'Open any service to see its requirements and steps.', action: 'browse', icon: 'M9 12l2 2 4-4M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z' },
];

function TileIcon({ path }) {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-maroon-50 text-maroon-800">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
        <path d={path} />
      </svg>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="ml-4 h-5 w-5 shrink-0 self-center text-slate-500" aria-hidden="true">
      <circle cx="9" cy="9" r="6" />
      <path d="M14 14l4 4" strokeLinecap="round" />
    </svg>
  );
}

// Search text, the page and the public services list, shared by the signed-out and signed-in home.
function useCatalogue() {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, items: [], total: 0, error: null });
  // Office names seen in the services loaded so far. The API has no office list for the public page,
  // so this is not every office, only the ones that have appeared in results.
  const [offices, setOffices] = useState([]);

  useEffect(() => {
    let cancelled = false;
    publicFetch(`${API}${toQuery({ search, page, page_size: PAGE_SIZE })}`)
      .then((data) => {
        if (cancelled) return;
        setState({ loading: false, items: data.items ?? [], total: data.total ?? 0, error: null });
        setOffices((known) => {
          const names = new Set(known);
          for (const item of data.items ?? []) if (item.office_name) names.add(item.office_name);
          return names.size === known.length ? known : [...names].sort((a, b) => a.localeCompare(b));
        });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, items: [], total: 0, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [search, page]);

  function onSubmit(event) {
    event.preventDefault();
    setState((s) => ({ ...s, loading: true }));
    setPage(1);
    setSearch(input);
  }

  function onClear() {
    setInput('');
    setSearch('');
    setPage(1);
  }

  // Option B: choosing an office searches for its name (the existing `search` parameter).
  function onOffice(name) {
    if (!name) return onClear();
    setState((s) => ({ ...s, loading: true }));
    setInput(name);
    setSearch(name);
    setPage(1);
  }

  function browseAll() {
    setInput('');
    setSearch('');
    setPage(1);
    document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' });
  }

  return { input, setInput, search, page, setPage, state, offices, onSubmit, onClear, onOffice, browseAll };
}

function OfficeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
      <path d="M3 17h14M5 17V7l5-3 5 3v10M8 17v-4h4v4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-4 w-4 shrink-0 self-center" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 1.5" />
    </svg>
  );
}

function ServiceResults({ catalogue }) {
  const { search, page, setPage, state, offices, onClear, onOffice } = catalogue;
  const selectedOffice = offices.includes(search) ? search : '';
  return (
    <section id="services" className="scroll-mt-4">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-sans text-3xl font-bold text-maroon-950">{search ? `Results for "${search}"` : 'All services'}</h2>
          {!state.loading && !state.error ? (
            <p className="mt-1 text-sm text-slate-500">
              Showing {state.total} {state.total === 1 ? 'service' : 'services'}
            </p>
          ) : null}
        </div>
        {offices.length > 0 ? (
          <div className="w-full sm:w-72">
            <label className="label" htmlFor="office-filter">
              Office
            </label>
            <select id="office-filter" className="input rounded-lg" value={selectedOffice} onChange={(e) => onOffice(e.target.value)} aria-describedby="office-filter-note">
              <option value="">All offices</option>
              {offices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p id="office-filter-note" className="sr-only">
              This list only includes offices from the services loaded so far.
            </p>
          </div>
        ) : null}
      </div>
      <ErrorBanner message={state.error} />
      {state.loading && !state.error ? <p className="text-sm text-slate-500">Loading services…</p> : null}
      {!state.loading && !state.error && state.items.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-maroon-50 text-maroon-800">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden="true">
              <path d={search ? 'M11 5a6 6 0 100 12 6 6 0 000-12zM20 20l-4-4' : 'M9 12l2 2 4-4M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z'} />
            </svg>
          </span>
          {search ? (
            <>
              <p className="mt-4 font-semibold text-slate-900">No services match {`"${search}"`}</p>
              <p className="mt-1 max-w-sm text-sm text-slate-600">Check the spelling, or try a shorter service or office name.</p>
              <button type="button" className="btn-primary mt-5" onClick={onClear}>
                Show all services
              </button>
            </>
          ) : (
            <>
              <p className="mt-4 font-semibold text-slate-900">No services are published yet</p>
              <p className="mt-1 max-w-sm text-sm text-slate-600">The list of services will appear here once the offices publish them. Please check back soon.</p>
            </>
          )}
        </div>
      ) : null}
      {state.items.length > 0 ? (
        <>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {state.items.map((item) => (
              <li key={item.service_id} className="flex min-w-0 flex-col rounded-2xl border border-[#EAE3D9] bg-white p-5">
                <div>
                  <StatusBadge variant={item.classification}>{classificationLabel(item.classification)}</StatusBadge>
                </div>
                <h3 className="mt-3 break-words font-sans text-lg font-bold leading-snug text-maroon-950">{item.service_name}</h3>
                <p className="mt-2 flex items-start gap-2 text-sm text-slate-500">
                  <OfficeIcon />
                  <span className="min-w-0 break-words">{item.office_name}</span>
                </p>
                <div className="mt-auto pt-4">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-[#EAE3D9] pt-3 text-sm text-slate-800">
                    <ClockIcon />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Standard</span>
                    <span className="min-w-0 break-words font-semibold">{item.standard_text}</span>
                  </div>
                  <Link href={`/public/${encodeURIComponent(item.service_id)}`} className="mt-3 inline-block text-sm font-semibold text-maroon-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
                    View requirements &rarr;
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="card mt-4">
            <Pager page={page} pageSize={PAGE_SIZE} total={state.total} onPage={setPage} />
          </div>
        </>
      ) : null}
    </section>
  );
}

// Signed in: the same page, shown as the Dashboard inside the app shell (sidebar and top bar), without the hero.
function SignedInHome() {
  const catalogue = useCatalogue();
  const { input, setInput, onSubmit } = catalogue;
  return (
    <AppShell title="Dashboard" subtitle="Find a service, see what to bring and how long it takes.">
      {/* No Search button: pressing Enter in the box searches. */}
      <form onSubmit={onSubmit} className="card mb-6 flex overflow-hidden" role="search">
        <label className="sr-only" htmlFor="home-search">
          Search services or offices
        </label>
        <SearchIcon />
        <input
          id="home-search"
          type="search"
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
          placeholder="Search by service or office name, then press Enter"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </form>
      <ServiceResults catalogue={catalogue} />
    </AppShell>
  );
}

// Signed out: the public landing page. No session needed and no redirect. Staff use Staff Login.
function PublicHome() {
  const catalogue = useCatalogue();
  const { input, setInput, onSubmit, browseAll } = catalogue;

  function focusSearch() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('public-search')?.focus();
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F3EC]">
      <section className="hero-bg relative text-white">
        <PublicHeader overlay />
        <div className="mx-auto max-w-3xl px-4 pb-28 pt-32 text-center sm:pt-36">
          <h1 className="font-sans text-3xl font-bold leading-tight text-white sm:text-5xl">Find a service. Know what to bring and how long it takes.</h1>
          <p className="mx-auto mt-5 max-w-xl text-white/90">Search the Citizen&rsquo;s Charter of {BRAND.campus} before you visit an office.</p>
          <form onSubmit={onSubmit} className="mx-auto mt-8 flex max-w-2xl overflow-hidden rounded-xl bg-white p-1.5 shadow-lg" role="search">
            <label className="sr-only" htmlFor="public-search">
              Search services or offices
            </label>
            <SearchIcon />
            <input
              id="public-search"
              type="search"
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-slate-900 placeholder:text-slate-500 focus:outline-none"
              placeholder="Search by service or office name"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="shrink-0 rounded-lg bg-gold-500 px-6 text-sm font-bold text-maroon-950 hover:bg-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-900">
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="relative z-10 mx-auto -mt-14 w-full max-w-6xl px-4" aria-label="Quick links">
        <ul className="grid gap-4 md:grid-cols-3">
          {TILES.map((tile) => (
            <li key={tile.title}>
              <button
                type="button"
                onClick={tile.action === 'browse' ? browseAll : focusSearch}
                className="flex h-full w-full items-start gap-4 rounded-2xl border border-[#EAE3D9] bg-white p-5 text-left shadow-md transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-800"
              >
                <TileIcon path={tile.icon} />
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-900">{tile.title}</span>
                  <span className="mt-1 block text-sm text-slate-600">{tile.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <ServiceResults catalogue={catalogue} />
      </main>

      <footer className="border-t border-[#EAE3D9] px-4 py-6 text-center text-sm text-slate-500">
        {BRAND.campus} &middot; {BRAND.fullName} &middot;{' '}
        <Link href="/login" className="font-semibold text-maroon-800 hover:underline">
          Staff login
        </Link>
      </footer>
    </div>
  );
}

export default function Landing() {
  // 'checking' until we know; visitors with no session marker are public at once (no network call).
  const [mode, setMode] = useState(() => {
    if (currentUser()) return 'signed-in';
    return mightBeSignedIn() ? 'checking' : 'public';
  });

  useEffect(() => {
    let cancelled = false;
    const check = mightBeSignedIn() ? refreshSession() : Promise.resolve(null);
    check
      .then((user) => {
        if (!cancelled) setMode(user ? 'signed-in' : 'public');
      })
      .catch(() => {
        if (!cancelled) setMode('public');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === 'signed-in') return <SignedInHome />;
  if (mode === 'public') return <PublicHome />;
  return <div className="min-h-screen bg-maroon-900" aria-busy="true" />;
}