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
  status,
  note,
}: {
  /** What the amount is: "Agreed price", "Cash in", "Amount". */
  kicker: string;
  /** The amount as it is written, with its sign when it has one. */
  amount: string;
  /** Where it stands: a status badge. */
  status?: ReactNode;
  /** Whatever goes with the amount: a fee, a currency. */
  note?: ReactNode;
}) {
  return (
    <section className="drawer-tag" aria-label={kicker}>
      <p className="drawer-tag-kicker">{kicker}</p>
      <p className="drawer-tag-amount">
        <span className="amount" dir="ltr">
          {amount}
        </span>
      </p>
      {(status || note) && (
        <div className="drawer-tag-foot">
          {status}
          {note && <span className="drawer-tag-note">{note}</span>}
        </div>
      )}
    </section>
  );
}
