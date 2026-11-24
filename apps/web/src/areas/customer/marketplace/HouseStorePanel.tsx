import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { itemClassLabel } from '../../../shared/itemClasses';
import { formatUsd, isolate } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { Serial } from '../../../shared/ui/Serial';
import { TierPrice } from '../../../shared/ui/TierPrice';
import { discountedMinor, useViewerTier } from '../../../shared/tiers';
import { Button, EmptyState, ErrorState, Panel, SkeletonBlock } from '../../../shared/ui/primitives';
import { ListTools, LIST_TOOLS_FROM, byNumber, useListView, type SortOption } from './ListTools';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { IconTag } from '../../../shared/ui/icons';

export interface HouseProduct {
  id: string;
  code: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  photoRef: string | null;
  askingPrice: number;
  currency: string;
  stock: number;
}

interface HousePurchase {
  orderCode: string;
  serialNumber: string;
  replayed?: boolean;
}

export function HouseStorePanel({
  onBought,
  onError,
}: {
  onBought: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const viewer = useViewerTier();
  const [products, setProducts] = useState<HouseProduct[] | null>(null);
  const [buying, setBuying] = useState<{ product: HouseProduct; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const view = useListView(products, houseText, HOUSE_SORTS);

  const load = useCallback(async () => {
    try {
      setProducts(await api.get<HouseProduct[]>('/marketplace/house/listings'));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setProducts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy() {
    if (!buying) return;
    setBusy(true);
    setBuyError(null);
    try {
      const result = await api.post<HousePurchase>(
        `/marketplace/house/listings/${buying.product.id}/purchase`,
        undefined,
        { 'Idempotency-Key': buying.key },
      );
      onBought(
        result.replayed
          ? t('market.alreadyBought')
          : t('house.bought', {
              item: isolate(buying.product.description),
              amount: formatUsd(discountedMinor(buying.product.askingPrice, viewer.discountBps)),
              serial: result.serialNumber,
              order: result.orderCode,
            }),
      );
      onError(null);
      setBuying(null);
      await load();
    } catch (e) {
      setBuyError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('house.title')} subtitle={t('house.subtitle')} flush>
      {loadError ? (
        <ErrorState
          title={t('store.loadFailed')}
          message={loadError}
          onRetry={() => {
            setProducts(null);
            void load();
          }}
          retryLabel={t('ui.retry')}
        />
      ) : products === null ? (
        <ul className="card-grid">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i}>
              <SkeletonBlock className="skel-metric" />
            </li>
          ))}
        </ul>
      ) : products.length === 0 ? (
        <EmptyState title={t('house.empty')} text={t('house.emptyText')} icon={<IconTag />} />
      ) : (
        <>
        {products.length > LIST_TOOLS_FROM && (
          <ListTools label={t('house.title')} view={view} sorts={HOUSE_SORTS} total={products.length} />
        )}
        {view.shown?.length === 0 && <EmptyState title={t('market.list.noMatch')} text={t('market.list.noMatchText')} />}
        <ul className="card-grid card-grid--listings">
          {(view.shown ?? []).map((p) => (
            <li key={p.id} className="card card--interactive card--listing">
              <div className="card-art">
                <CardPhotoThumb serialNumber={p.photoRef ?? ''} title={p.description} />
              </div>

              <div className="card-id">
                <p className="price">
                  <TierPrice listMinor={p.askingPrice} />
                </p>
                <h3 className="card-title">
                  <Serial value={p.code} />
                </h3>
                <p className="card-desc" title={p.description}>
                  {p.description}
                </p>
              </div>

              <div className="card-state">
                <span>{t('vault.condition', { grade: p.conditionGrade ?? '—' })}</span>
                <span className="card-sub">
                  {itemClassLabel(t, p.typeClass)} · {t('house.inStock', { count: p.stock })}
                </span>
              </div>

              <div className="actions">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setBuyError(null);
                    setBuying({ product: p, key: crypto.randomUUID() });
                  }}
                >
                  {t('market.buy')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}

      {buying && (
        <ConfirmationModal
          title={t('market.buy.confirmTitle')}
          body={
            <>
              <p>
                {t('store.buy.confirmBody', {
                  item: isolate(buying.product.description),
                  amount: formatUsd(discountedMinor(buying.product.askingPrice, viewer.discountBps)),
                })}
              </p>
              <p className="field-hint">{t('house.confirmNote')}</p>
              {buyError && <ErrorState message={buyError} />}
            </>
          }
          confirmLabel={t('market.buy')}
          cancelLabel={t('ui.cancel')}
          busy={busy}
          onConfirm={() => void buy()}
          onCancel={() => setBuying(null)}
        />
      )}
    </Panel>
  );
}

const HOUSE_SORTS: readonly SortOption<HouseProduct>[] = [
  { key: 'listed', label: 'market.sort.featured', compare: () => 0 },
  { key: 'price_asc', label: 'market.sort.priceAsc', compare: byNumber((r) => r.askingPrice, 1) },
  { key: 'price_desc', label: 'market.sort.priceDesc', compare: byNumber((r) => r.askingPrice, -1) },
];

const houseText = (p: HouseProduct) => `${p.code} ${p.description} ${p.conditionGrade ?? ''}`;
