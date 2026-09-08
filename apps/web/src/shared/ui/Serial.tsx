import type { ReactNode } from 'react';

/**
 * The identity primitives: a serial, a code, an amount, and a seal.
 *
 * Four small components that exist because the product had none of them and the
 * consequences were everywhere. Each one solves the same underlying problem —
 * a run of Latin characters inside a page whose base direction may be Hebrew —
 * and each one solves it the same way, so a serial cannot be right on one screen
 * and wrong on the next.
 *
 * WHY ISOLATION IS NOT OPTIONAL. Hebrew is the default locale, and almost every
 * identifier and figure in this product is a Latin run: `SN-ROS105-0008`,
 * `BIN-XHMHPADV`, `$3,200.00`, `8 Sep 2026`, and every catalogue description.
 * Dropped into an RTL paragraph with no isolation, the Unicode bidirectional
 * algorithm reorders them against the surrounding text: leading digits migrate
 * to the far end of the line and terminal punctuation migrates to the front.
 * The audit found `90 days included, then …` rendering as
 * `days included, then … 90`, and every date in the product reading
 * `8  2026 בספט׳`.
 *
 * `dir="ltr"` plus `unicode-bidi: isolate` (in `.serial`, `.code-inline`,
 * `.amount`) fences the run so the algorithm resolves it on its own and the
 * surrounding paragraph is unaffected in either direction.
 */

/**
 * A serial number. THE identity of an object in this product.
 *
 * Mono, because it is read aloud, compared character by character down a column,
 * and typed from a printed label into a scanner — all jobs a fixed advance
 * width, a slashed zero and an unambiguous `1/l/I` do real work for.
 *
 * Never truncated, never wrapped mid-code, and `user-select: all` so one click
 * takes the whole thing: the single most common thing anybody does with a serial
 * is paste it into a message to somebody else.
 */
export function Serial({
  value,
  lead,
  quiet,
  className = '',
}: {
  value: string;
  /** The identity of the view, rather than a reference inside it. */
  lead?: boolean;
  /** A serial that is context, not subject. */
  quiet?: boolean;
  className?: string;
}) {
  return (
    <span
      className={['serial', lead ? 'serial--lead' : '', quiet ? 'serial--quiet' : '', className]
        .filter(Boolean)
        .join(' ')}
      dir="ltr"
      /* Machine identifiers must survive a browser's page translation. */
      translate="no"
    >
      {value}
    </span>
  );
}

/**
 * Any other code: a bin, a parcel, a ticket, a carrier tracking number.
 *
 * The same isolation and the same face, at less weight, and allowed to wrap —
 * a 22-digit USPS tracking number has to be able to break somewhere or it takes
 * a mobile table sideways.
 */
export function Code({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span className={`code-inline ${className}`.trim()} dir="ltr" translate="no">
      {value}
    </span>
  );
}

/**
 * Money.
 *
 * The figure LEADS and what it is for follows it — `$12.40 · Storage, Aug`,
 * never `Storage, Aug: $12.40`. That ordering is a rule of this design system
 * and not a preference: on a screen about somebody else's money, the number is
 * the thing being read and everything else is a caption on it.
 *
 * Set in the UI face with tabular numerals, not in mono. `tabular-nums` is the
 * only thing mono was ever providing here, and a price that looks like a barcode
 * is not saying what it is.
 */
export function Amount({
  children,
  size,
  tone,
  what,
  className = '',
}: {
  /** The formatted amount. Format with `formatUsd` — never inline. */
  children: ReactNode;
  size?: 'lead' | 'display';
  tone?: 'brass' | 'credit' | 'debit';
  /** What the money is for. Rendered immediately after the figure. */
  what?: ReactNode;
  className?: string;
}) {
  const amount = (
    <span
      className={[
        'amount',
        size ? `amount--${size}` : '',
        tone ? `amount--${tone}` : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      dir="ltr"
    >
      {children}
    </span>
  );

  if (!what) return amount;
  return (
    <span className="amount-with">
      {amount} <span className="amount-for">· {what}</span>
    </span>
  );
}

/**
 * The seal.
 *
 * Bault's mark on something it has checked with its own hands: an inspected
 * escrow deal, a condition report signed by an operator, custody confirmed at a
 * facility.
 *
 * Deliberately NOT a badge. A badge is a label somebody applied to a record; a
 * seal is a claim the platform is making about work it did — so it is drawn as a
 * rule and a mark rather than as a chip, and it must never be rendered against
 * anything Bault has not physically handled.
 */
export function Seal({
  children,
  icon,
  brass,
}: {
  children: ReactNode;
  icon?: ReactNode;
  /** The money seal: a settled deal, a released escrow. */
  brass?: boolean;
}) {
  return (
    <span className={brass ? 'seal seal--brass' : 'seal'}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

/**
 * A run of text that IS Latin, inside a page that may not be.
 *
 * Catalogue descriptions, carrier names, and — the case that produced most of
 * the damage in the audit — free-text `reason` strings that the API returns in
 * English regardless of the reader's locale.
 */
export function LtrRun({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`ltr-run ${className}`.trim()}>{children}</span>;
}
