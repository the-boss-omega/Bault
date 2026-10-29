import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { STATE_META, stateLabel } from '../../shared/itemTimeline';
import { DetailDrawer } from '../../shared/ui/DetailDrawer';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { EmptyState, ErrorState, SkeletonTable, StatusBadge } from '../../shared/ui/primitives';
import { Code } from '../../shared/ui/Serial';
import { IconBox } from '../../shared/ui/icons';
import type { ShelfBin } from './ShelfMap';

interface ShelfItem {
  id: string;
  serialNumber: string;
  barcode: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  holdFlag: boolean;
}

interface ShelfResponse {
  bin: { id: string; barcode: string; zone: string; oversized: boolean; active: boolean };
  items: ShelfItem[];
}

/** The name of a card: what the catalogue line says up to its first " · " (year, set, card). */
const nameOf = (item: ShelfItem) =>
  (item.description.split(' · ')[0] ?? item.description).trim() || item.typeClass;

/**
 * What is on one shelf, read only: the shelf's label and zone in the drawer's head, how many are on it as the figure
 * of a tag (with what kind of shelf it is and whether it is in use), and under it each item by the number it
 * carries, what it is and where it stands. Nothing here changes anything; a card is moved from the bench that
 * moves cards.
 */
export function ShelfContents({ bin, onClose }: { bin: ShelfBin; onClose: () => void }) {
  const { t } = useI18n();
  const [shelf, setShelf] = useState<ShelfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setShelf(await api.get<ShelfResponse>(`/custody/bins/${encodeURIComponent(bin.id)}/items`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bin.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = shelf?.items.length ?? bin.itemCount;
  const state = !bin.active ? 'out' : count === 0 ? 'empty' : 'stocked';
  const stateKey =
    state === 'out'
      ? 'warehouse.status.outOfService'
      : state === 'empty'
        ? 'warehouse.status.empty'
        : 'warehouse.status.inStock';

  return (
    <DetailDrawer
      title={bin.barcode}
      subtitle={`${t('warehouse.bins.colZone')} ${bin.zone}`}
      onClose={onClose}
    >
      <DrawerTag
        kicker={t('warehouse.shelf.items')}
        amount={count.toLocaleString()}
        status={
          <StatusBadge
            tone={state === 'stocked' ? 'success' : state === 'out' ? 'error' : 'neutral'}
          >
            {t(stateKey)}
          </StatusBadge>
        }
        lines={[
          { label: t('warehouse.bins.colZone'), value: bin.zone },
          {
            label: t('warehouse.shelf.kind'),
            value: t(
              bin.oversized ? 'warehouse.bins.kind.oversized' : 'warehouse.bins.kind.standard',
            ),
          },
        ]}
      />

      <section aria-labelledby="shelf-contents-title" className="shelf-contents">
        <h3 className="shelf-contents-title" id="shelf-contents-title">
          {t('warehouse.shelf.contents')}
        </h3>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />
        ) : shelf === null ? (
          <SkeletonTable rows={Math.min(Math.max(bin.itemCount, 2), 5)} columns={2} />
        ) : shelf.items.length === 0 ? (
          <EmptyState title={t('warehouse.shelf.empty')} icon={<IconBox />} />
        ) : (
          <ul className="shelf-items">
            {shelf.items.map((item) => (
              <li className="shelf-item" key={item.id}>
                <span className="shelf-item-serial">
                  <Code value={item.serialNumber} />
                </span>
                <span className="shelf-item-name" dir="auto">
                  {nameOf(item)}
                </span>
                <span className="shelf-item-meta">
                  <StatusBadge tone={STATE_META[item.lifecycleState]?.tone ?? 'neutral'}>
                    {stateLabel(t, item.lifecycleState)}
                  </StatusBadge>
                  {item.holdFlag && (
                    <StatusBadge tone="error">{t('admin.items.col.hold')}</StatusBadge>
                  )}
                  {item.conditionGrade && <span dir="auto">{item.conditionGrade}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DetailDrawer>
  );
}
