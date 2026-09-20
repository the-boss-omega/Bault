import { cloneElement, isValidElement, useEffect, useId, useRef } from 'react';
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
     * A busy button is disabled AND says so.
     *
     * Every submit in this app was a plain button whose only feedback was that
     * nothing happened for a moment — so people press twice, and on a
     * money-moving form that is a real problem rather than an aesthetic one.
     * `aria-busy` announces it, `disabled` prevents the second press, and the
     * spinner replaces the icon rather than sitting next to it so the control
     * does not change width mid-action.
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
 * Replaces the pattern this app repeated everywhere:
 *
 *   <label class="field"><span class="field-label">Caption</span>
 *     <input/><span class="field-hint">Help</span></label>
 *
 * which associates the control with its label only by NESTING. The consequence
 * is that the label's accessible name is the caption and the hint run together,
 * so a screen reader announces "Owner usernameThe customer's permanent
 * identifier as shown on the parcel" as the name of the field. It also made the
 * hint unclickable-but-focus-stealing and defeated `getByLabelText` in tests,
 * which is how it was found.
 *
 * Here the label points at the control by id, the hint is attached with
 * `aria-describedby` where it belongs, and an error message replaces the hint
 * and sets `aria-invalid` so the failure is announced rather than only coloured.
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
   * The id of the control this labels.
   *
   * OPTIONAL, and omitting it is the better call in most places. It was
   * required, which meant every conversion away from the wrapping-label pattern
   * had to invent an id — and an id written as a literal is wrong the moment the
   * field renders inside a list, because then there are several of it. Left out,
   * the field mints one with `useId` and attaches it to its child, which is
   * unique per instance by construction.
   *
   * Pass it explicitly only when something outside needs to point at the control
   * (a `ref`, a test, an `aria-controls` elsewhere on the page).
   */
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  /**
   * When the id is ours, put it on the control — otherwise the label points at
   * nothing and the whole exercise is decoration. `describedBy` goes on with it,
   * so the hint is announced as a DESCRIPTION rather than becoming part of the
   * field's name, which is the bug this component exists to fix.
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
 * This existed as a hand-assembled shape repeated in nine files:
 *
 *   <div class="field">
 *     <span class="field-label">Amount</span>
 *     <div class="money-input"><span aria-hidden>$</span><input inputmode="decimal"></div>
 *   </div>
 *
 * A `<span>` caption and a `<div>` wrapper — so nothing associated the label
 * with the control. Some sites had grown an `id` and an `htmlFor` over time;
 * five had not, and the axe sweep caught two of them (the wallet's cash-in form
 * and the escrow form) because those were the screens it visited. The other
 * three — the shipment composer, the consignment form and the grading form —
 * have the identical shape and are converted with them: every one is a place
 * where somebody types a number that moves real money.
 *
 * The association cannot be forgotten here, because the component owns both
 * ends of it. `dir="ltr"` because an amount is a Latin run whatever the page
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
  /** `$` for money, `%` for a rate. Decorative — the label says which. */
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

/** Icon-only control. `label` is required — it becomes the accessible name. */
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

/** White rounded card with an optional titled header and tool slot. */
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
 * Status badge. Colour is never the only signal — the label always states the
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
 * message that is informational rather than celebratory — a flagged legacy name
 * awaiting confirmation, say. It stays `role="status"` (polite) in both tones:
 * neither case is an error, and neither should interrupt a screen reader
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
 * Local tab strip. These only switch content inside the current section — the
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

  // On a phone the strip scrolls sideways: keep the active tab in view, and drop
  // the "more this way" fade once the strip is scrolled to its end.
  const stripRef = useRef<HTMLDivElement>(null);
  function markEnd() {
    const el = stripRef.current;
    if (!el) return;
    el.classList.toggle('is-end', Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 2);
  }
  useEffect(() => {
    const el = stripRef.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && tab && el.scrollWidth > el.clientWidth) {
      tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    markEnd();
  }, [active, tabs.length]);

  return (
    <div className="ctx-bar">
      <div
        ref={stripRef}
        className="ctx-tabs"
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        onScroll={markEnd}
      >
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
