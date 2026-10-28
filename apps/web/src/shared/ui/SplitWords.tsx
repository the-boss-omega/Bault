import { Fragment, type CSSProperties } from 'react';

/**
 * A heading whose words rise out of a mask, one after another.
 *
 * The accessible name is the whole string (the spans are hidden from assistive
 * technology), so a screen reader hears a heading, not a row of fragments. The
 * motion itself is in CSS, under `.lp-js`, so without it the words just sit there.
 */
export function SplitWords({ text, from = 0 }: { text: string; from?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <span className="lp-w" aria-hidden="true" style={{ '--i': i + from } as CSSProperties}>
            <span className="lp-w-in">{word}</span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </>
  );
}
