import { useMemo } from 'react';
import type { TranslateFn } from '../../shared/i18n';

export interface ShelfBin {
  id: string;
  barcode: string;
  zone: string;
  oversized: boolean;
  active: boolean;
  itemCount: number;
}

export interface ShelfCount {
  key: string | null;
  count: number;
}

const MAX_PIPS = 12;

export function ShelfMap({
  bins,
  counts,
  onOpen,
  onOpenTray,
  t,
}: {
  bins: readonly ShelfBin[];
  counts: readonly ShelfCount[];
  onOpen?: (bin: ShelfBin) => void;
  onOpenTray?: () => void;
  t: TranslateFn;
}) {
  const { zones, unshelved } = useMemo(() => {
    const byBin = new Map(counts.filter((c) => c.key !== null).map((c) => [c.key as string, c.count]));
    const grouped = new Map<string, { bin: ShelfBin; count: number }[]>();
    for (const bin of bins) {
      const list = grouped.get(bin.zone) ?? [];
      list.push({ bin, count: byBin.get(bin.id) ?? bin.itemCount });
      grouped.set(bin.zone, list);
    }
    const ordered = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([zone, slots]) => ({
        zone,
        slots: slots.sort((a, b) => a.bin.barcode.localeCompare(b.bin.barcode)),
      }));
    return { zones: ordered, unshelved: counts.find((c) => c.key === null)?.count ?? 0 };
  }, [bins, counts]);

  return (
    <div className="shelf-map">
      {zones.map(({ zone, slots }) => {
        const total = slots.reduce((sum, s) => sum + s.count, 0);
        return (
          <section className="shelf-zone" key={zone} aria-label={`${t('warehouse.bins.colZone')} ${zone}`}>
            <header className="shelf-zone-head">
              <span className="shelf-zone-name">
                {t('warehouse.bins.colZone')} <b>{zone}</b>
              </span>
              <span className="shelf-zone-total">{total.toLocaleString('en-US')}</span>
            </header>
            <ul className="shelf-rack">
              {slots.map(({ bin, count }) => {
                const state = !bin.active ? 'out' : count === 0 ? 'empty' : 'stocked';
                const face = (
                  <>
                    <span className="shelf-bin">
                      <bdi dir="ltr">{bin.barcode}</bdi>
                    </span>
                    <span className="shelf-count">{count.toLocaleString('en-US')}</span>
                    <Pips count={count} />
                    <span className="shelf-note">
                      {t(bin.oversized ? 'warehouse.bins.kind.oversized' : 'warehouse.bins.kind.standard')}
                      {' · '}
                      {t(
                        state === 'out'
                          ? 'warehouse.status.outOfService'
                          : state === 'empty'
                            ? 'warehouse.status.empty'
                            : 'warehouse.status.inStock',
                      )}
                    </span>
                  </>
                );
                return (
                  <li
                    className="shelf-cell"
                    key={bin.id}
                    data-wide={bin.oversized ? 'true' : undefined}
                  >
                    {onOpen ? (
                      <button
                        type="button"
                        className="shelf-slot"
                        data-state={state}
                        aria-haspopup="dialog"
                        title={t('warehouse.shelf.open', { bin: bin.barcode })}
                        onClick={() => onOpen(bin)}
                      >
                        {face}
                      </button>
                    ) : (
                      <div className="shelf-slot" data-state={state}>
                        {face}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {unshelved > 0 && (
        <section className="shelf-zone shelf-zone--tray" aria-label={t('warehouse.status.unshelved')}>
          <header className="shelf-zone-head">
            <span className="shelf-zone-name">{t('warehouse.status.unshelved')}</span>
            <span className="shelf-zone-total">{unshelved.toLocaleString('en-US')}</span>
          </header>
          <ul className="shelf-rack">
            <li className="shelf-cell">
              {onOpenTray ? (
                <button
                  type="button"
                  className="shelf-slot"
                  data-state="tray"
                  title={t('warehouse.shelf.openTray')}
                  aria-label={t('warehouse.shelf.openTrayCount', { count: unshelved })}
                  onClick={onOpenTray}
                >
                  <Pips count={unshelved} />
                </button>
              ) : (
                <div className="shelf-slot" data-state="tray">
                  <Pips count={unshelved} />
                </div>
              )}
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}

function Pips({ count }: { count: number }) {
  const shown = Math.min(count, MAX_PIPS);
  return (
    <span className="shelf-pips" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span className="shelf-pip" key={i} />
      ))}
      {count > MAX_PIPS && <span className="shelf-more">+{count - MAX_PIPS}</span>}
    </span>
  );
}
