import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from './primitives';
import { IconClose } from './icons';
import { useT } from '../i18n';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const overlays: symbol[] = [];

function pushOverlay(token: symbol): () => void {
  overlays.push(token);
  return () => {
    const at = overlays.indexOf(token);
    if (at >= 0) overlays.splice(at, 1);
  };
}

const isTopOverlay = (token: symbol) => overlays[overlays.length - 1] === token;

function trapTab(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (nodes.length === 0) {
    event.preventDefault();
    return;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Plays the exit animation, then closes. Without matchMedia (a test renderer)
 * or under reduced motion it closes at once, exactly as before.
 */
function useExit(onClose: () => void): { closing: boolean; requestClose: () => void } {
  const [closing, setClosing] = useState(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const requestClose = useCallback(() => {
    const animate =
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate) {
      latest.current();
      return;
    }
    setClosing(true);
    window.setTimeout(() => latest.current(), 180);
  }, []);
  return { closing, requestClose };
}

export function DetailDrawer({
  title,
  subtitle,
  lead,
  onClose,
  footer,
  dirty,
  flush,
  wide,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  lead?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  dirty?: boolean;
  flush?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const { closing, requestClose } = useExit(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const token = Symbol('drawer');
    const popOverlay = pushOverlay(token);
    panel?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopOverlay(token)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }
      trapTab(event, panel);
    }

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      popOverlay();
      openerRef.current?.focus?.();
    };
  }, [requestClose]);

  return (
    <>
      <div
        className={closing ? 'drawer-backdrop is-closing' : 'drawer-backdrop'}
        role="presentation"
        onClick={() => {
          if (!dirty) requestClose();
        }}
      />
      <aside
        ref={panelRef}
        className={`${wide ? 'drawer drawer--sheet' : 'drawer'}${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="drawer-head">
          <div className="drawer-head-main">
            <h2 className="drawer-title" id={titleId}>
              {lead ?? title}
              {lead ? <span className="sr-only">{title}</span> : null}
            </h2>
            {subtitle && <p className="drawer-subtitle">{subtitle}</p>}
          </div>
          <IconButton label={t('ui.close')} onClick={requestClose}>
            <IconClose />
          </IconButton>
        </header>
        <div className={`drawer-body${flush ? ' drawer-body--flush' : ''}`}>{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </>
  );
}

export function ConfirmationModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'gold',
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'gold' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { closing, requestClose: requestCancel } = useExit(onCancel);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const token = Symbol('confirm');
    const popOverlay = pushOverlay(token);
    dialog?.focus();
    function onKey(event: KeyboardEvent) {
      if (!isTopOverlay(token)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestCancel();
        return;
      }
      trapTab(event, dialog);
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      popOverlay();
      opener?.focus?.();
    };
  }, [requestCancel]);

  return (
    <div
      className={closing ? 'modal-backdrop is-closing' : 'modal-backdrop'}
      role="presentation"
      onClick={() => !busy && requestCancel()}
    >
      <div
        ref={dialogRef}
        className={closing ? 'modal is-closing' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h4 id={titleId}>{title}</h4>
        </div>
        <div>{body}</div>
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={requestCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'gold'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
