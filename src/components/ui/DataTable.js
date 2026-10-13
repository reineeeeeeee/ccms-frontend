'use client';

import { useEffect, useRef, useState } from 'react';
import TableState from './TableState.js';

/**
 * Accessible truncated text cell with inline keyboard/touch expansion.
 * - Single-line CSS ellipsis while collapsed.
 * - The expand control only appears when the rendered text is actually clipped
 *   (scrollWidth > clientWidth), re-measured on resize and when the text changes.
 * - Full original text stays in the data, in the `title`, and in the toggle's aria-label.
 */
export function TruncatedCell({
  text,
  subtitle,
  href,
  onClick,
  className = '',
}) {
  const [expanded, setExpanded] = useState(false);
  // Starts false so server and first client render match (no hydration mismatch).
  const [isTruncated, setIsTruncated] = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return undefined; // an expanded cell is not clipped; keep the toggle
    const measure = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  const showToggle = isTruncated || expanded;

  const content = (
    <span
      ref={textRef}
      className={`block font-semibold text-slate-900 hover:underline ${expanded ? 'whitespace-normal break-words' : 'truncate'}`}
    >
      {text}
    </span>
  );

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1" title={text}>
          {href ? (
            <a href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] rounded">
              {content}
            </a>
          ) : onClick ? (
            <button
              type="button"
              onClick={onClick}
              className="block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] rounded w-full"
            >
              {content}
            </button>
          ) : (
            content
          )}
        </div>
        {showToggle ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse title: ${text}` : `Expand title: ${text}`}
            className="shrink-0 rounded px-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
          >
            {expanded ? '▲' : '…'}
          </button>
        ) : null}
      </div>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500 truncate" title={subtitle}>{subtitle}</p> : null}
    </div>
  );
}

/**
 * Reusable CCMS DataTable presentation component.
 * Recreates the desktop table UI based on the Citizen's Charter visual standard:
 * - White container with rounded warm beige borders.
 * - Summary count bar above the table.
 * - Deep maroon (#3D0606, same as the sidebar) table header with white uppercase labels.
 * - Horizontal light beige dividers with comfortable row height.
 * - Responsive table scroll container for tablet and mobile viewports.
 * - Reusable pagination footer.
 */
export default function DataTable({
  columns = [],
  data = [],
  keyExtractor = (item, idx) => item.id ?? item.service_id ?? idx,
  rowClassName = () => '',
  loading = false,
  loadingMessage = 'Loading…',
  emptyMessage = 'No records found.',
  error = null,
  summaryText = null,
  totalCount = null,
  countLabel = 'records',
  summaryLeftSlot = null,
  summaryRightSlot = null,
  pagination = null, // { page, pageSize, total, onPage }
  className = '',
}) {
  const hasSummary = summaryText || summaryLeftSlot || totalCount !== null || summaryRightSlot;
  const colCount = columns.length;

  // Pagination calculation matching existing CCMS logic
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? 20;
  const total = pagination?.total ?? data.length;
  const onPage = pagination?.onPage;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={`rounded-2xl border border-[#EAE3D9] bg-white overflow-hidden shadow-none ${className}`.trim()}>
      {/* Optional Summary Bar above header */}
      {hasSummary ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-[#F2ECE4]">
          <div className="text-sm text-stone-600">
            {summaryLeftSlot ?? (summaryText ? <p>{summaryText}</p> : null)}
          </div>
          <div>
            {summaryRightSlot ?? (
              totalCount !== null ? (
                <div className="text-right">
                  <span className="block text-base font-bold text-stone-900 leading-tight">
                    {totalCount}
                  </span>
                  <span className="block text-xs text-stone-500 leading-tight">
                    {countLabel}
                  </span>
                </div>
              ) : null
            )}
          </div>
        </div>
      ) : null}

      {/* Responsive Table Scroll Container */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-left border-collapse">
          <thead className="table-head">
            <tr>
              {columns.map((col) => {
                const alignClass =
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left';

                return (
                  <th
                    key={col.key || col.header}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={`px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white ${alignClass} ${col.headerClassName || ''}`}
                  >
                    {col.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F2ECE4] bg-white">
            {error ? (
              <TableState colSpan={colCount} kind="error">{error}</TableState>
            ) : loading ? (
              <TableState colSpan={colCount} kind="loading">{loadingMessage}</TableState>
            ) : data.length === 0 ? (
              <TableState colSpan={colCount}>{emptyMessage}</TableState>
            ) : (
              data.map((item, idx) => {
                const key = keyExtractor(item, idx);
                const customRowClass = typeof rowClassName === 'function' ? rowClassName(item, idx) : rowClassName;

                return (
                  <tr
                    key={key}
                    className={`hover:bg-[#FAF7F2]/50 transition-colors ${customRowClass}`.trim()}
                  >
                    {columns.map((col) => {
                      const alignClass =
                        col.align === 'right'
                          ? 'text-right'
                          : col.align === 'center'
                            ? 'text-center'
                            : 'text-left';

                      return (
                        <td
                          key={col.key || col.header}
                          className={`px-6 py-4 text-sm text-slate-700 align-middle ${alignClass} ${col.className || ''}`}
                        >
                          {col.render ? col.render(item, idx) : item[col.key]}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination && total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F2ECE4] px-6 py-3.5 text-sm">
          <div className="text-xs text-stone-500 font-medium leading-tight">
            Page
            <div className="text-sm font-semibold text-stone-900">{page}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPage?.(page - 1)}
              className="rounded-xl border border-[#E5DDD3] bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPage?.(page + 1)}
              className="rounded-xl border border-[#E5DDD3] bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

DataTable.TruncatedCell = TruncatedCell;
