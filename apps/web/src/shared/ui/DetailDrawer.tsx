import { useId, useRef, type ReactNode } from 'react';
import { Button, IconButton } from './primitives';
import { IconClose } from './icons';
import { useT } from '../i18n';
import { useExit } from './useExit';
import { inBody } from './inBody';
import { useOverlay } from './useOverlay';

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
  const titleId = useId();
  useOverlay(panelRef, requestClose);

  return inBody(
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
    </>,
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
  useOverlay(dialogRef, requestCancel);

  return inBody(
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
    </div>,
  );
}
