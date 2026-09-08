import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, IconButton } from './primitives';
import { IconClose } from './icons';
import { useT } from '../i18n';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Which overlay Escape belongs to.
 *
 * Both overlays listened on `document` in the capture phase, and capture
 * handlers fire in registration order — so the DRAWER, which mounts first, saw
 * Escape first and called `stopPropagation()`. Pressing Escape on the "donate
 * this card, this cannot be undone" confirmation therefore closed the entire
 * drawer and took the confirmation with it, losing the reader's place on a card
 * they were part-way through deciding about.
 *
 * The topmost overlay is the one a person means, so the stack decides and the
 * others stand down. Module-level because it describes the page rather than any
 * component, and there is exactly one page.
 */
const overlays: symbol[] = [];

function pushOverlay(token: symbol): () => void {
  overlays.push(token);
  return () => {
    const at = overlays.indexOf(token);
    if (at >= 0) overlays.splice(at, 1);
  };
}

const isTopOverlay = (token: symbol) => overlays[overlays.length - 1] === token;

/**
 * Keep Tab inside `container`.
 *
 * Shared by both overlays, because a modal guarding an irreversible action needs
 * it at least as much as a drawer does and only the drawer had it: Tab from the
 * confirmation's last button moved focus into the page behind, where Enter would
 * act on whatever it happened to land on.
 */
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
 * Right-side detail drawer (leading→trailing edge, so it mirrors in RTL).
 *
 * Records are inspected here rather than on a full page: the underlying table
 * stays visible and keeps its scroll position and selected row. The drawer traps
 * focus while open, closes on Escape or an outside click, and returns focus to
 * the element that opened it.
 *
 * `dirty` guards a drawer with unsaved input — an outside click is then ignored
 * so an in-progress top-up or withdrawal can't be lost by a stray click.
 */
export function DetailDrawer({
  title,
  subtitle,
  onClose,
  footer,
  dirty,
  flush,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  dirty?: boolean;
  flush?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const token = Symbol('drawer');
    const popOverlay = pushOverlay(token);
    // Focus the panel itself, so a screen reader announces the drawer title
    // before the user tabs into its controls.
    panel?.focus();

    function onKeyDown(event: KeyboardEvent) {
      // A confirmation opened ON TOP of this drawer owns Escape; closing the
      // drawer out from under it would take the confirmation with it.
      if (!isTopOverlay(token)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
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
      // Return focus to the row/button that opened the drawer.
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div
        className="drawer-backdrop"
        role="presentation"
        onClick={() => {
          if (!dirty) onClose();
        }}
      />
      <aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="drawer-head">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <h2 className="drawer-title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="drawer-subtitle">{subtitle}</p>}
          </div>
          <IconButton label={t('ui.close')} onClick={onClose}>
            <IconClose />
          </IconButton>
        </header>
        <div className={`drawer-body${flush ? ' drawer-body--flush' : ''}`}>{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </>
  );
}

/**
 * Modal confirmation for an irreversible step (withdrawal confirm, donation).
 * Same focus rules as the drawer; deliberately small and centred.
 */
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
        // Stopped here so a drawer underneath does not ALSO close.
        event.stopPropagation();
        onCancel();
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
  }, [onCancel]);

  return (
    // A click outside is ignored while the action is running: it cannot cancel
    // what is already in flight, and dismissing the dialog would leave the reader
    // with no idea whether the irreversible thing happened.
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        ref={dialogRef}
        className="modal"
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
        {/*
          The `Button` primitive, not hand-rolled `<button className="btn">`.
          These two were the only buttons in the product that opted out of it,
          and they were the ones guarding the irreversible actions — so the
          control that most needed a spinner and `aria-busy` had neither, and its
          Cancel stayed live while the confirmed action was already running.
        */}
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
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
