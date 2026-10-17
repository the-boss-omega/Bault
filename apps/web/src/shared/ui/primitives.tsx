import { cloneElement, isValidElement, useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import { IconAlert, IconCheckCircle, IconChevronRight, IconInbox } from './icons';

/* ============================================================
   Buttons
   ============================================================ */

type ButtonVariant = 'gold' | 'navy' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  /** Shows a spinner, disables the control and announces `aria-busy`. */
  loading?: boolean;
  icon?: ReactNode;
}

/**
 * The one button in the product. `gold` is the single primary action per view;
 * everything else is `secondary` or `ghost` so common and rare actions never
 * carry the same visual weight.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  loading,
  children,
  className = '',
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    loading ? 'btn--loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    /**
     * A busy button is disabled and says so: `aria-busy` announces it,
     * `disabled` prevents a second press on a money-moving form, and the spinner
     * replaces the icon so the control does not change width mid-action.
     */
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

/**
 * A labelled form control.
 *
 * The label points at the control by id, so the field's accessible name is the
 * caption alone. The hint is attached with `aria-describedby`, and an error
 * replaces the hint as a `role="alert"` message so the failure is announced,
 * not only coloured.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /**
   * The id of the control this labels. Usually omitted: the field then mints one
   * with `useId` and attaches it to its child, which stays unique when the field
   * renders inside a list.
   *
   * Pass it only when something outside needs to point at the control (a `ref`,
   * a test, an `aria-controls` elsewhere on the page). The child is then left
   * as it is.
   */
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  /**
   * When the id is ours, put it on the control, with `describedBy`, so the hint
   * is announced as a description instead of becoming part of the field's name.
   *
   * Only a single element child can be given an id; anything else (a fragment, a
   * group of radios) is left alone and should pass `htmlFor` itself.
   */
  const control =
    htmlFor === undefined && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id: (children.props as { id?: string }).id ?? id,
          'aria-describedby':
            (children.props as { 'aria-describedby'?: string })['aria-describedby'] ?? describedBy,
        })
      : children;

  return (
    <div className={`field ${className}`.trim()} data-describes={describedBy}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {control}
      {error ? (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * An amount somebody types, with its currency mark.
 *
 * The component owns both the label and the input, so their association cannot
 * be forgotten. `dir="ltr"` because an amount is a Latin run whatever the page
 * direction, `inputMode="decimal"` for the numeric keypad, and `spellCheck` off
 * because a red squiggle under a number is noise.
 */
export function MoneyField({
  label,
  hint,
  error,
  mark = '$',
  value,
  onChange,
  id,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** `$` for money, `%` for a rate. Decorative; the label says which. */
  mark?: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  const generated = useId();
  const controlId = id ?? generated;
  const describedBy = error ? `${controlId}-error` : hint ? `${controlId}-hint` : undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={controlId}>
        {label}
      </label>
      <div className="money-input">
        <span aria-hidden="true">{mark}</span>
        <input
          {...rest}
          id={controlId}
          inputMode="decimal"
          dir="ltr"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {error ? (
        <span className="field-error" id={`${controlId}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${controlId}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Icon-only control. `label` is required: it becomes the accessible name. */
export function IconButton({
  label,
  children,
  className = '',
  bare,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; bare?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-btn${bare ? ' icon-btn--bare' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ============================================================
   Surfaces
   ============================================================ */

/** Card surface with an optional titled header and tool slot. */
export function Panel({
  title,
  subtitle,
  tools,
  footer,
  flush,
  children,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  tools?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="panel" id={id}>
      {(title || tools) && (
        <header className="panel-head">
          {title && (
            <div>
              <h2 className="panel-title">{title}</h2>
              {subtitle && <p className="panel-subtitle">{subtitle}</p>}
            </div>
          )}
          {tools && <div className="panel-tools">{tools}</div>}
        </header>
      )}
      <div className={`panel-body${flush ? ' panel-body--flush' : ''}`}>{children}</div>
      {footer && <footer className="panel-foot">{footer}</footer>}
    </section>
  );
}

/* ============================================================
   Status
   ============================================================ */

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'gold' | 'violet' | 'neutral';

/**
 * Status badge. Colour is never the only signal: the label always states the
 * status in words, so the pill is readable without colour perception.
 */
export function StatusBadge({
  tone = 'neutral',
  children,
  plain,
}: {
  tone?: StatusTone;
  children: ReactNode;
  plain?: boolean;
}) {
  return (
    <span className={`pill${tone === 'neutral' ? '' : ` pill--${tone}`}${plain ? ' pill--plain' : ''}`}>
      {children}
    </span>
  );
}

/* ============================================================
   States: empty / error / loading
   ============================================================ */

export function EmptyState({
  title,
  text,
  action,
  icon,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon ?? <IconInbox />}</span>
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  );
}

/**
 * Inline error, shown where the failure happened rather than as a page takeover,
 * so the shell and the rest of the data stay usable.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="errorbox" role="alert">
      <IconAlert />
      <div className="errorbox-body">
        {title && <p className="errorbox-title">{title}</p>}
        <p>{message}</p>
      </div>
      {onRetry && retryLabel && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * A short confirmation banner.
 *
 * `tone="warning"` is the same shape in amber with the alert glyph, for a
 * message that is informational rather than celebratory, such as a flagged
 * legacy name awaiting confirmation. It stays `role="status"` (polite) in both
 * tones: neither case is an error, and neither should interrupt a screen reader
 * mid-sentence.
 */
export function SuccessNote({
  children,
  tone = 'success',
}: {
  children: ReactNode;
  tone?: 'success' | 'warning';
}) {
  return (
    <p className={tone === 'warning' ? 'okbox okbox--warning' : 'okbox'} role="status">
      {tone === 'warning' ? <IconAlert /> : <IconCheckCircle />}
      <span>{children}</span>
    </p>
  );
}

/** Layout-preserving table skeleton: same row height, same column count. */
export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="dt-wrap" aria-hidden="true">
      <table className="data-table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr className="skel-row" key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <td key={c}>
                  <span
                    className="skel skel-line"
                    style={{ display: 'block', width: c === 0 ? '55%' : c === columns - 1 ? '40%' : '70%' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skel ${className}`} aria-hidden="true" />;
}

/* ============================================================
   Metric card
   ============================================================ */

export function MetricCard({
  label,
  value,
  icon,
  tone = 'blue',
  footer,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: 'green' | 'amber' | 'blue' | 'violet';
  footer?: ReactNode;
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon metric-icon--${tone}`}>{icon}</span>
      <div>
        <p className="metric-label">{label}</p>
        <p className="metric-value">{value}</p>
      </div>
      {footer && <p className="metric-foot">{footer}</p>}
    </article>
  );
}

/* ============================================================
   Contextual tabs
   ============================================================ */

export interface ContextTab {
  key: string;
  label: string;
}

/**
 * Local tab strip. These only switch content inside the current section; the
 * rail, header and shell stay mounted. Implemented as a real ARIA tab list so
 * arrow keys move between tabs.
 */
export function ContextTabs({
  tabs,
  active,
  onSelect,
  actions,
  label,
}: {
  tabs: readonly ContextTab[];
  active: string;
  onSelect: (key: string) => void;
  actions?: ReactNode;
  label: string;
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.key === active);
    if (index < 0) return;
    // In RTL the visual arrow direction is mirrored, matching the tab order.
    const rtl = document.documentElement.dir === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number | null = null;
    if (event.key === forward) next = (index + 1) % tabs.length;
    else if (event.key === back) next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    if (target) onSelect(target.key);
  }

  return (
    <div className="ctx-bar">
      <div className="ctx-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              className={`ctx-tab${isActive ? ' is-active' : ''}`}
              onClick={() => onSelect(tab.key)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {actions && <div className="ctx-actions">{actions}</div>}
    </div>
  );
}

/** The content region a `ContextTabs` strip controls. */
export function TabPanel({ tab, children }: { tab: string; children: ReactNode }) {
  return (
    <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} className="stack">
      {children}
    </div>
  );
}

/* ============================================================
   Small compositions
   ============================================================ */

/** Centred "view all …" action at the foot of a preview table. */
export function ViewAllLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="link-more" onClick={onClick}>
      {children}
      <IconChevronRight />
    </button>
  );
}

/** One label/value line inside a detail drawer. */
export function DetailRow({
  label,
  children,
  sub,
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="detail-row">
      <dt className="detail-label">{label}</dt>
      <dd className="detail-value">
        {children}
        {sub && <span className="detail-value-sub">{sub}</span>}
      </dd>
    </div>
  );
}
