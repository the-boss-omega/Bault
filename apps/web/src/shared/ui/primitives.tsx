import { cloneElement, isValidElement, useId, useLayoutEffect, useRef } from 'react';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
} from 'react';
import { CountUp } from './CountUp';
import { IconAlert, IconCheckCircle, IconChevronRight, IconInbox } from './icons';
import { scrollBehavior } from './motionPreference';

/**
 * What a button is for, in the order a screen asks for it:
 * primary is the one thing to do next (a view has one, and it is the one with foil on its edge);
 * secondary is another thing one may do; ghost is the way out and what is only sometimes wanted;
 * danger is what cannot be taken back; link is an action that sits inside a sentence.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

interface ButtonStyle {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

function buttonClass({
  variant = 'secondary',
  size = 'md',
  block,
  loading,
  className = '',
}: ButtonStyle & { className?: string }) {
  return [
    'btn',
    `btn--${variant}`,
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    loading ? 'btn--loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {
  /** The state of a button that is a switch (a filter that is on, a mode that is set). */
  pressed?: boolean;
}

export function Button({
  variant,
  size,
  block,
  icon,
  loading,
  pressed,
  children,
  className,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, loading, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      {...rest}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : icon}
      {children !== undefined && children !== null && children !== false ? (
        <span className="btn-label">{children}</span>
      ) : null}
    </button>
  );
}

/** A link that is drawn as a button: a download, a file, a page that is somewhere else. */
export function ButtonLink({
  variant,
  size,
  block,
  icon,
  children,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & Omit<ButtonStyle, 'loading'>) {
  return (
    <a className={buttonClass({ variant, size, block, className })} {...rest}>
      {icon}
      <span className="btn-label">{children}</span>
    </a>
  );
}

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
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

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
          <bdi dir="auto">{error}</bdi>
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

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
          <bdi dir="auto">{error}</bdi>
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${controlId}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  bare,
  pressed,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; bare?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-btn${bare ? ' icon-btn--bare' : ''} ${className}`.trim()}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

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

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'gold' | 'violet' | 'neutral';

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
        {/* What the server wrote is its own island: an English sentence keeps its full stop at its end. */}
        <p>
          <bdi dir="auto">{message}</bdi>
        </p>
      </div>
      {onRetry && retryLabel && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

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
        <p className="metric-value">{typeof value === 'string' ? <CountUp value={value} /> : value}</p>
      </div>
      {footer && <p className="metric-foot">{footer}</p>}
    </article>
  );
}

export interface ContextTab {
  key: string;
  label: string;
}

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
  const listRef = useRef<HTMLDivElement>(null);
  const count = tabs.length;
  const labels = tabs.map((t) => t.label).join('\u0000');

  // Position the gliding indicator under the active tab. Offsets are measured
  // from the inline-start edge, so the same maths serves LTR and RTL. A tab's
  // width changes when the webfont arrives, when the language changes and when
  // the bar is resized, so it is measured again for each of those; measuring
  // once would leave the indicator where the fallback font put the tab.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let live = true;
    const place = () => {
      const tab = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!live || !tab) return;
      const l = list.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      const x = rtl ? t.right - l.right : t.left - l.left;
      list.style.setProperty('--tab-x', `${x + list.scrollLeft}px`);
      list.style.setProperty('--tab-w', `${t.width}px`);
      list.dataset.ready = 'true';
    };
    // On a phone the strip scrolls sideways, and the page can open on a tab that is out of sight (a link to
    // the storefront or to escrow). Bring it into view: only when the selection changes, so a person
    // who scrolls the strip by hand is not pulled back by a resize.
    const reveal = () => {
      const tab = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!live || !tab) return;
      const room = 16;
      const l = list.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      const past = t.left - room < l.left ? t.left - room - l.left : t.right + room > l.right ? t.right + room - l.right : 0;
      if (past) list.scrollTo?.({ left: list.scrollLeft + past, behavior: scrollBehavior() });
    };
    place();
    reveal();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(list);
    list.querySelectorAll('[role="tab"]').forEach((el) => observer?.observe(el));
    void document.fonts?.ready.then(() => {
      place();
      reveal();
    });
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [active, count, labels]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.key === active);
    if (index < 0) return;
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
    if (!target) return;
    onSelect(target.key);
    // Focus goes with the selection, so what the ring is on is what is selected.
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div className="ctx-bar">
      <div ref={listRef} className="ctx-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
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

export function TabPanel({ tab, children }: { tab: string; children: ReactNode }) {
  return (
    <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1} className="stack">
      {children}
    </div>
  );
}

export function ViewAllLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="link-more" onClick={onClick}>
      {children}
      <IconChevronRight />
    </button>
  );
}

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
