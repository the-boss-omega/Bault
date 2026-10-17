import type { ReactNode } from 'react';

/**
 * The identity primitives: a serial, a code, an amount, a seal, and an LTR run.
 *
 * Most of them solve the same problem the same way: a run of Latin characters
 * inside a page whose base direction may be Hebrew, so a serial cannot be right
 * on one screen and wrong on the next.
 *
 * Isolation is required. Hebrew is the default locale, and almost every
 * identifier and figure in this product is a Latin run: `SN-ROS105-0008`,
 * `BIN-XHMHPADV`, `$3,200.00`, and every catalogue description. Dropped into an
 * RTL paragraph with no isolation, the Unicode bidirectional algorithm reorders
 * them against the surrounding text: leading digits migrate to the far end of
 * the line and terminal punctuation migrates to the front.
 *
 * `dir="ltr"` plus `unicode-bidi: isolate` (in `.serial`, `.code-inline`,
 * `.amount`) fences the run so the algorithm resolves it on its own and the
 * surrounding paragraph is unaffected in either direction.
 */

/**
 * A serial number: the identity of an object in this product.
 *
 * Mono, because it is read aloud, compared character by character down a column,
 * and typed from a printed label into a scanner, all jobs a fixed advance width,
 * a slashed zero and an unambiguous `1/l/I` help with.
 *
 * Never truncated, never wrapped mid-code, and `user-select: all` so one click
 * takes the whole thing to paste into a message.
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
 * The same isolation and the same face, at less weight, and allowed to wrap: a
 * 22-digit USPS tracking number has to break somewhere or it pushes a mobile
 * table sideways.
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
 * The figure leads and what it is for follows it: `$12.40 · Storage, Aug`,
 * never `Storage, Aug: $12.40`. That ordering is a rule of this design system:
 * on a screen about somebody else's money, the number is the thing being read
 * and everything else is a caption on it.
 *
 * Set in the UI face with tabular numerals. Mono is for codes, and a price that
 * looks like a barcode is not saying what it is.
 */
export function Amount({
  children,
  size,
  tone,
  what,
  className = '',
}: {
  /** The formatted amount. Format with `formatUsd`, never inline. */
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
 * Deliberately not a badge. A badge is a label somebody applied to a record; a
 * seal is a claim the platform makes about work it did, so it is drawn as a rule
 * and a mark instead of a chip, and must never be rendered against anything
 * Bault has not physically handled.
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
 * A run of text that is Latin, inside a page that may not be: catalogue
 * descriptions, carrier names, and free-text `reason` strings that the API
 * returns in English regardless of the reader's locale.
 */
export function LtrRun({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`ltr-run ${className}`.trim()}>{children}</span>;
}
