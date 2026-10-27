import type { ReactNode } from 'react';

/**
 * What a drawer is about, as a tag on paper: the amount, named, in the display face, with where it stands
 * under it. A deal, a request and a ledger entry are each a sum of money with a state, and the drawer
 * opens on that, not on a list of rows that has it as one of them.
 *
 * The amount is always labelled: `kicker` says what it is. It is a figure, so it is read left to right
 * whatever the page reads.
 */
export function DrawerTag({
  kicker,
  amount,
  title,
  art,
  status,
  note,
  lines,
}: {
  /** What the amount is: "Agreed price", "Cash in", "Amount". */
  kicker: string;
  /** The amount as it is written, with its sign when it has one. A tag that is a set of lines (where to send a payment) has none. */
  amount?: string;
  /**
   * Words, in the display face, where what the tag is about is a name and not a sum: a person, what is in a
   * parcel. Whatever a person typed is read as the language it is in.
   */
  title?: ReactNode;
  /** What the tag hangs from: the card in its case. Decoration; the lines under it name it. */
  art?: ReactNode;
  /** Where it stands: a status badge. */
  status?: ReactNode;
  /** Whatever goes with the amount: a fee, a currency. */
  note?: ReactNode;
  /** What it is made of or goes with, a name and its value to a line: a destination, a reference. */
  lines?: { label: ReactNode; value: ReactNode }[];
}) {
  return (
    <section className="drawer-tag" aria-label={kicker}>
      {art && <div className="drawer-tag-art">{art}</div>}
      <p className="drawer-tag-kicker">{kicker}</p>
      {title !== undefined && <p className="drawer-tag-title">{title}</p>}
      {amount !== undefined && (
        <p className="drawer-tag-amount">
          <span className="amount" dir="ltr">
            {amount}
          </span>
        </p>
      )}
      {lines && lines.length > 0 && (
        <dl className="ledger-lines drawer-tag-lines">
          {lines.map((line, i) => (
            <div className="ledger-line" key={i}>
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(status || note) && (
        <div className="drawer-tag-foot">
          {status}
          {note && <span className="drawer-tag-note">{note}</span>}
        </div>
      )}
    </section>
  );
}
