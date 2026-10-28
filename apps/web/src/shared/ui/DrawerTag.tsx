import { useId, type ReactNode } from 'react';

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
  titleAs,
  art,
  item,
  status,
  note,
  lines,
  children,
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
  /** Where the title is a heading in the page's outline (a sheet's own name), the level it is. Otherwise it is only words. */
  titleAs?: 'h3' | 'h4';
  /** What the tag hangs from: the card in its case. Decoration; the lines under it name it. */
  art?: ReactNode;
  /**
   * One of a list of tags (each dispute, each address). A tag on its own is a region of the page, named by its
   * kicker, which is what a screen reader jumps to; forty of them would be forty regions, so a tag in a list is
   * an article, named the same way, and not a landmark.
   */
  item?: boolean;
  /** Where it stands: a status badge. */
  status?: ReactNode;
  /** Whatever goes with the amount: a fee, a currency. */
  note?: ReactNode;
  /**
   * What it is made of or goes with, a name and its value to a line: a destination, a reference. A name
   * written for a list ends in a colon; on a tag the leader between the two says it, so the colon is dropped.
   */
  lines?: { label: ReactNode; value: ReactNode }[];
  /** Whatever the tag has to show that is neither a sum nor a line: the two sides of a trade. */
  children?: ReactNode;
}) {
  const Title = titleAs ?? 'p';
  const kickerId = useId();
  const Root = item ? 'article' : 'section';
  return (
    <Root
      className="drawer-tag"
      {...(item ? { 'aria-labelledby': kickerId } : { 'aria-label': kicker })}
    >
      {art && <div className="drawer-tag-art">{art}</div>}
      <p className="drawer-tag-kicker" id={item ? kickerId : undefined}>
        {kicker}
      </p>
      {title !== undefined && <Title className="drawer-tag-title">{title}</Title>}
      {amount !== undefined && (
        <p className="drawer-tag-amount">
          <span className="amount" dir="ltr">
            {amount}
          </span>
        </p>
      )}
      {children}
      {lines && lines.length > 0 && (
        <dl className="ledger-lines drawer-tag-lines">
          {lines.map((line, i) => (
            <div className="ledger-line" key={i}>
              <dt>
                {typeof line.label === 'string'
                  ? line.label.replace(/\s*[:：]\s*$/, '')
                  : line.label}
              </dt>
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
    </Root>
  );
}
