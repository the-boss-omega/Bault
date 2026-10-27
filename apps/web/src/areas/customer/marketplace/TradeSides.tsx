import { CardPhotoThumb } from '../../../shared/CardPhoto';
import type { TranslateFn } from '../../../shared/i18n';
import { itemName } from '../../../shared/itemClasses';
import type { SwapItemRef } from '../../../shared/market';
import { Serial } from '../../../shared/ui/Serial';

/** One side of a trade: what that person receives, each card in its case beside its serial. */
export function TradeSide({
  label,
  items,
  area,
  t,
}: {
  label: string;
  items: readonly SwapItemRef[];
  area: 'give' | 'get';
  t: TranslateFn;
}) {
  return (
    <div className={`trade-side trade-side--${area}`} role="group" aria-label={label}>
      <span className="slip-label" aria-hidden="true">
        {label}
      </span>
      {items.length === 0 ? (
        <span className="trade-nothing">—</span>
      ) : (
        <ul className="trade-items">
          {items.map((item) => (
            <li key={item.id}>
              {item.serialNumber && (
                <span className="slip-thumb">
                  <CardPhotoThumb serialNumber={item.serialNumber} title={swapItemName(t, item)} />
                </span>
              )}
              <span className="slip-name">
                {item.serialNumber && <Serial value={item.serialNumber} />}
                <span className="slip-desc ltr-run">{swapItemName(t, item)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function swapItemName(t: TranslateFn, item: SwapItemRef): string {
  return item.description || (item.typeClass ? itemName(t, { typeClass: item.typeClass }) : item.id);
}

/**
 * Between the two sides: both ways for a swap, one way for a gift, toward the
 * side that is receiving. Decorative; the two labelled groups say it in words.
 */
export function SwapGlyph({ oneWay, towardStart }: { oneWay: boolean; towardStart: boolean }) {
  return (
    <span className={`trade-swap${oneWay ? ' trade-swap--one' : ''}${oneWay && towardStart ? ' trade-swap--back' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 32 20" width="32" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        {oneWay ? (
          <path d="M3 10h26M22 3l7 7-7 7" />
        ) : (
          <>
            <path d="M3 6h26M23 1l6 5-6 5" />
            <path d="M29 14H3M9 9l-6 5 6 5" />
          </>
        )}
      </svg>
    </span>
  );
}
