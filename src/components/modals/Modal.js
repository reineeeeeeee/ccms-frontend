'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { register } from '../../lib/ui/dirty-registry.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, innermost last: only the top one handles Escape, Tab and stray focus.
const openStack = [];

function focusables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

function focusSafely(el) {
  if (el && el.isConnected && typeof el.focus === 'function') {
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  }
  return false;
}

/**
 * Accessible modal: labelled by its title, focus moves inside on open (an autoFocus field keeps it),
 * Tab stays inside, Escape closes when onClose is given (pass none to block dismissal, e.g. while
 * saving), and focus returns to the control that opened it (or returnFocusRef) on close.
 * dirty (optional) tells Sign out that the open form has unsaved changes.
 */
export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  widthClass = 'max-w-lg',
  role = 'dialog',
  describedBy,
  initialFocusRef,
  returnFocusRef,
  dirty,
}) {
  const titleId = useId();
  const stackId = useId();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const dirtyRef = useRef(Boolean(dirty));
  const tracksDirty = dirty !== undefined;

  // Remember what had focus just before opening (read while rendering, before any autoFocus runs).
  const [opener, setOpener] = useState({ open: false, element: null });
  if (open !== opener.open) {
    setOpener({ open, element: open && typeof document !== 'undefined' ? document.activeElement : null });
  }

  useEffect(() => {
    onCloseRef.current = onClose;
    dirtyRef.current = Boolean(dirty);
  });

  useEffect(() => {
    if (!open || !tracksDirty) return undefined;
    return register(stackId, () => dirtyRef.current);
  }, [open, tracksDirty, stackId]);

  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const trigger = opener.element;
    const returnTarget = returnFocusRef?.current;
    openStack.push(stackId);
    const isTop = () => openStack[openStack.length - 1] === stackId;

    if (panel && !panel.contains(document.activeElement)) {
      if (!focusSafely(initialFocusRef?.current)) {
        if (!focusSafely(focusables(panel)[0])) panel.focus({ preventScroll: true });
      }
    }

    const onKeyDown = (event) => {
      if (!isTop() || !panel) return;
      if (event.key === 'Escape') {
        if (onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panel.contains(active);
      if (event.shiftKey && (outside || active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Focus that escapes (a click outside, assistive tech) is brought back inside.
    const onFocusIn = (event) => {
      if (isTop() && panel && !panel.contains(event.target)) {
        if (!focusSafely(focusables(panel)[0])) panel.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      const index = openStack.lastIndexOf(stackId);
      if (index !== -1) openStack.splice(index, 1);
      // Give focus back; skip triggers that were removed from the page (e.g. a closed row menu).
      if (!focusSafely(returnTarget)) focusSafely(trigger);
    };
  }, [open, opener.element, stackId, initialFocusRef, returnFocusRef]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`relative w-full ${widthClass} card max-h-[90vh] overflow-y-auto focus:outline-none`}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 id={titleId} className="text-xl">
            {title}
          </h2>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
