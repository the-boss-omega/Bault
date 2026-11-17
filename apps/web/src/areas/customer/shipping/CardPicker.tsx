import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type TranslateFn } from '../../../shared/i18n';
import { itemName } from '../../../shared/itemClasses';
import type { ShipmentSummary } from '../../../shared/shipments';
import { ItemPick } from '../../../shared/ui/Serial';
import { EmptyState } from '../../../shared/ui/primitives';
import { IconBox, IconSearch } from '../../../shared/ui/icons';

export interface PickableItem {
  id: string;
  serialNumber?: string;
  typeClass: string;
  description: string;
}

export const OPEN_SHIPMENT_STATUSES: ReadonlySet<string> = new Set([
  'requested',
  'awaiting_payment',
  'rates_selected',
  'picking',
  'packed',
  'labeled',
]);

export function claimedItems(shipments: readonly ShipmentSummary[]): Map<string, string> {
  const claimed = new Map<string, string>();
  for (const s of shipments) {
    if (!OPEN_SHIPMENT_STATUSES.has(s.status)) continue;
    for (const id of s.itemIds ?? []) claimed.set(id, s.code ?? s.id);
  }
  return claimed;
}

export function useClaimedItems(reloadToken = 0): Map<string, string> {
  const [claimed, setClaimed] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    void api
      .get<ShipmentSummary[]>('/shipping/shipments')
      .then((rows) => {
        if (live) setClaimed(claimedItems(Array.isArray(rows) ? rows : []));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [reloadToken]);
  return claimed;
}

export function transitLabel(t: TranslateFn, min: number, max: number): string {
  if (min === max) return min === 1 ? t('ship.transitOneDay') : t('ship.transitDays', { days: min });
  return t('ship.transit', { min, max });
}

export function cardCountLabel(t: TranslateFn, count: number): string {
  return count === 1 ? t('ship.cardCountOne') : t('ship.cardCount', { count });
}

const SEARCH_FROM = 5;

export function CardPicker({
  items,
  selected,
  onToggle,
  claimed,
  legend,
}: {
  items: readonly PickableItem[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  claimed: ReadonlyMap<string, string>;
  legend: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.serialNumber ?? ''} ${itemName(t, item)}`.toLowerCase().includes(needle),
    );
  }, [items, query, t]);

  if (items.length === 0) {
    return <EmptyState title={t('shipping.noItems')} text={t('shipping.noItemsText')} icon={<IconBox />} />;
  }

  return (
    <div className="card-picker">
      {items.length >= SEARCH_FROM && (
        <div className="search card-picker-search">
          <IconSearch />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ship.searchPlaceholder')}
            aria-label={t('ship.search')}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="field-hint">{t('ship.searchNone', { query: query.trim() })}</p>
      ) : (
        <fieldset className="field field--cards">
          <legend className="sr-only">{legend}</legend>
          <ul className="check-list">
            {shown.map((item) => {
              const on = claimed.get(item.id);
              return (
                <li key={item.id} className={on ? 'is-claimed' : undefined}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!on && selected.has(item.id)}
                      disabled={Boolean(on)}
                      onChange={() => onToggle(item.id)}
                    />
                    <ItemPick serial={item.serialNumber} name={itemName(t, item)} />
                    {on && (
                      <span className="card-picker-claim" dir="ltr">
                        {t('ship.onShipment', { code: on })}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
