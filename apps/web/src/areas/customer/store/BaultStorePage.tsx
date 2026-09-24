import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { itemClassLabel } from '../../../shared/itemClasses';
import { formatUsd } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { Amount, Serial } from '../../../shared/ui/Serial';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonBlock,
  SuccessNote,
} from '../../../shared/ui/primitives';
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

/**
 * The Bault store: cards the business sells itself.
 *
 * It is a DESTINATION of its own rather than rows mixed into Browse, because
 * what is being bought is different in a way the buyer should know before
 * paying. A Browse listing is one particular card already on a shelf, sold by
 * another collector; a store product is a print with copies, sold by Bault, and
 * the copy a buyer gets is labelled and shelved after they pay for it — so the
 * confirmation says so, and the receipt names the serial the new card was given.
 * Buried as the second tab of the marketplace, the shop the house itself keeps
 * read as one more filter on somebody else's shelf.
 */
export function BaultStorePage() {
  const { t } = useI18n();
  const [products, setProducts] = useState<HouseProduct[] | null>(null);
  const [buying, setBuying] = useState<{ product: HouseProduct; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The page owns its own banners now that it is not a tab of a page that had
  // them. A success clears an older error and an error clears an older success,
  // so the banner always answers the last thing done.
  const [status, setStatusRaw] = useState<string | null>(null);
  const [error, setErrorRaw] = useState<string | null>(null);
  const onBought = useCallback((message: string) => {
    setErrorRaw(null);
    setStatusRaw(message);
  }, []);
  const onError = useCallback((message: string | null) => {
    if (message !== null) setStatusRaw(null);
    setErrorRaw(message);
  }, []);

  const load = useCallback(async () => {
    try {
      setProducts(await api.get<HouseProduct[]>('/marketplace/house/listings'));
    } catch (e) {
      onError((e as Error).message);
      setProducts([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy() {
    if (!buying) return;
    setBusy(true);
    try {
      // One key per confirmation, not per product: a store product has copies, so
      // buying a second one is a second purchase, while a double-click on the
      // same confirmation is not.
      const result = await api.post<HousePurchase>(
        `/marketplace/house/listings/${buying.product.id}/purchase`,
        undefined,
        { 'Idempotency-Key': buying.key },
      );
      onBought(
        result.replayed
          ? t('market.alreadyBought')
          : t('house.bought', { serial: result.serialNumber, order: result.orderCode }),
      );
      onError(null);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setBuying(null);
    }
  }

  return (
    <>
      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} />}

      {/* No panel header: the page title already says "Bault store". What the
          heading used to repeat, this sentence does not — it says what makes
          buying here different from buying off the shelf. */}
      <p className="hint">{t('house.subtitle')}</p>

      <Panel flush>
        {products === null ? (
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
          <ul className="card-grid card-grid--listings">
            {products.map((p) => (
              <li key={p.id} className="card card--interactive card--listing">
                <div className="card-art">
                  <CardPhotoThumb serialNumber={p.photoRef ?? ''} title={p.description} />
                </div>

                <div className="card-id">
                  <p className="price">
                    <Amount>{formatUsd(p.askingPrice)}</Amount>
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
                    variant="gold"
                    size="sm"
                    disabled={busy}
                    onClick={() => setBuying({ product: p, key: crypto.randomUUID() })}
                  >
                    {t('market.buy')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {buying && (
          <ConfirmationModal
            title={t('market.buy.confirmTitle')}
            body={
              <>
                <p>
                  {t('market.buy.confirmBody', {
                    item: buying.product.description,
                    amount: formatUsd(buying.product.askingPrice),
                  })}
                </p>
                <p className="field-hint">{t('house.confirmNote')}</p>
              </>
            }
            confirmLabel={t('market.buy')}
            cancelLabel={t('ui.cancel')}
            onConfirm={() => void buy()}
            onCancel={() => setBuying(null)}
          />
        )}
      </Panel>
    </>
  );
}
