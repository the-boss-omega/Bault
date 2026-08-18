import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { EscrowTab } from './EscrowTab';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { useNavigation, useRoute } from '../../../shared/routing';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonBlock,
  SuccessNote,
  TabPanel,
} from '../../../shared/ui/primitives';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { IconMarketplace, IconSearch, IconTag } from '../../../shared/ui/icons';
import { MyListingsPanel, OffersPanel, SwapsPanel } from './SellerPanels';
import { ProposeTradePanel } from './ProposeTradePanel';
import { StorefrontPanel } from './StorefrontPanel';
import { loadProfile } from '../../../shared/session';

interface Listing {
  id: string;
  askingPrice: number;
  currency: string;
  itemId: string;
  serialNumber: string;
  typeClass: string;
  conditionGrade: string | null;
  description: string;
  imageUrl?: string;
}

const TABS = ['browse', 'sell', 'listings', 'offers', 'trade', 'escrow', 'store'] as const;
type MarketTab = (typeof TABS)[number];

/**
 * Marketplace. Browse, buy or make an offer on active listings; list one of your
 * own STORED items for sale (chosen from a vault dropdown — a real UUID, so no
 * invalid-id 500). Prices are entered and shown in dollars; the cents the API
 * stores are produced at submit time.
 */
export function MarketplacePage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [buying, setBuying] = useState<Listing | null>(null);
  const [offering, setOffering] = useState<Listing | null>(null);
  const { items, reload: reloadItems } = useVaultItems(true);
  /** The reader's own username, so the storefront tab can open on their shop. */
  const [myUsername, setMyUsername] = useState<string | undefined>(undefined);
  /**
   * The reader's own id.
   *
   * Escrow is the one screen that has to know which SIDE of a row the reader is
   * on — a deal names two people and the next step is different for each — and
   * a username cannot answer that, because a deal stores ids.
   */
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    void loadProfile()
      .then((p) => {
        setMyUsername(p.username);
        setMeId(p.id);
      })
      .catch(() => undefined);
  }, []);

  const tab: MarketTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as MarketTab)
    : 'browse';

  const loadListings = useCallback(async (query: string) => {
    try {
      setListings(await api.get<Listing[]>(`/marketplace/listings?q=${encodeURIComponent(query)}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setListings([]);
    }
  }, []);

  // Incremental search-as-you-type: debounce a refetch on every query change so
  // results update live from the partial query — no Enter/button required.
  useEffect(() => {
    const handle = setTimeout(() => void loadListings(q), 250);
    return () => clearTimeout(handle);
  }, [q, loadListings]);

  async function buy(listing: Listing) {
    try {
      await api.post(`/marketplace/listings/${listing.id}/purchase`);
      setStatus(t('market.status.purchased'));
      setError(null);
      await loadListings(q);
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuying(null);
    }
  }

  const tabs = TABS.map((key) => ({ key, label: t(`market.tab.${key}` as MessageKey) }));

  return (
    <>
      <ContextTabs label={t('market.title')} tabs={tabs} active={tab} onSelect={goTab} />

      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} />}

      {tab === 'browse' && (
        <TabPanel tab="browse">
          <Panel
            title={t('market.listings')}
            subtitle={listings === null ? undefined : t('market.listingsCount', { count: listings.length })}
            tools={
              <div className="search">
                <IconSearch />
                <input
                  type="search"
                  placeholder={t('market.searchPlaceholder')}
                  aria-label={t('market.search')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            }
          >
            {listings === null ? (
              <ul className="card-grid">
                {Array.from({ length: 6 }, (_, i) => (
                  <li key={i}>
                    <SkeletonBlock className="skel-metric" />
                  </li>
                ))}
              </ul>
            ) : listings.length === 0 ? (
              <EmptyState
                title={t('market.empty.title')}
                text={q ? t('market.empty.searchText') : t('market.empty.text')}
                icon={<IconMarketplace />}
                action={q ? <Button size="sm" onClick={() => setQ('')}>{t('vault.clearSearch')}</Button> : undefined}
              />
            ) : (
              <ul className="card-grid">
                {listings.map((listing) => (
                  <li key={listing.id} className="card card--interactive">
                    <CardPhotoThumb
                      serialNumber={listing.serialNumber}
                      title={listing.description || listing.typeClass}
                    />
                    <h3 className="card-title">{listing.typeClass}</h3>
                    <p className="card-desc">{listing.description || '—'}</p>
                    <p className="price" dir="ltr">
                      {formatUsd(listing.askingPrice)}
                    </p>
                    <div className="actions">
                      <Button variant="gold" size="sm" onClick={() => setBuying(listing)}>
                        {t('market.buy')}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setOffering(listing)}>
                        {t('market.makeOffer')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'sell' && (
        <TabPanel tab="sell">
          <SellPanel
            items={items}
            t={t}
            onListed={async () => {
              setStatus(t('market.status.listed'));
              await loadListings(q);
              await reloadItems();
              goTab('browse');
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {buying && (
        <ConfirmationModal
          title={t('market.buy.confirmTitle')}
          body={
            <p>
              {t('market.buy.confirmBody', {
                item: buying.description || buying.typeClass,
                amount: formatUsd(buying.askingPrice),
              })}
            </p>
          }
          confirmLabel={t('market.buy')}
          cancelLabel={t('ui.cancel')}
          onConfirm={() => void buy(buying)}
          onCancel={() => setBuying(null)}
        />
      )}

      {tab === 'listings' && (
        <TabPanel tab="listings">
          <MyListingsPanel onChanged={async (m) => setStatus(m)} onError={setError} />
        </TabPanel>
      )}

      {tab === 'offers' && (
        <TabPanel tab="offers">
          <OffersPanel
            onChanged={async (m) => {
              setStatus(m);
              await loadListings(q);
              await reloadItems();
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {tab === 'trade' && (
        <TabPanel tab="trade">
          <ProposeTradePanel onProposed={async (m) => setStatus(m)} onError={setError} />
          <SwapsPanel
            onChanged={async (m) => {
              setStatus(m);
              await reloadItems();
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {tab === 'escrow' && (
        <TabPanel tab="escrow">
          <EscrowTab meId={meId} />
        </TabPanel>
      )}

      {tab === 'store' && (
        <TabPanel tab="store">
          <StorefrontPanel myUsername={myUsername} onError={setError} />
        </TabPanel>
      )}

      {offering && (
        <OfferDrawer
          listing={offering}
          t={t}
          onClose={() => setOffering(null)}
          onSent={() => {
            setStatus(t('market.status.offerSent'));
            setOffering(null);
          }}
        />
      )}
    </>
  );
}

/* ============================================================
   Sell one of your own stored items
   ============================================================ */

function SellPanel({
  items,
  t,
  onListed,
  onError,
}: {
  items: readonly { id: string; typeClass: string; description: string }[];
  t: TranslateFn;
  onListed: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('500.00');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!itemId && items[0]) setItemId(items[0].id);
  }, [items, itemId]);

  const cents = dollarsToCents(price);

  async function sell() {
    if (!itemId || cents === null) return;
    setBusy(true);
    try {
      await api.post('/marketplace/listings', { itemId, askingPrice: cents });
      await onListed();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('market.sellLegend')} subtitle={t('market.sell.subtitle')}>
      {items.length === 0 ? (
        <EmptyState title={t('services.noItems')} text={t('market.sell.noItemsText')} icon={<IconTag />} />
      ) : (
        <div className="stack stack--tight" style={{ maxWidth: 460 }}>
          <label className="field">
            <span className="field-label">{t('market.sell.itemLabel')}</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{t('market.selectItemOption')}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.typeClass} — {item.description}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <label className="field-label" htmlFor="ask-price">
              {t('market.sell.priceLabel')}
            </label>
            <div className="money-input">
              <span aria-hidden="true">$</span>
              <input
                id="ask-price"
                inputMode="decimal"
                dir="ltr"
                value={price}
                aria-describedby="ask-hint"
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <p className="field-hint" id="ask-hint">
              {cents === null ? t('market.sell.priceHint') : t('market.sell.willList', { amount: formatUsd(cents) })}
            </p>
          </div>

          <Button variant="gold" block disabled={busy || !itemId || cents === null} onClick={sell}>
            {t('market.listForSale')}
          </Button>
        </div>
      )}
    </Panel>
  );
}

/* ============================================================
   Make an offer
   ============================================================ */

function OfferDrawer({
  listing,
  t,
  onClose,
  onSent,
}: {
  listing: Listing;
  t: TranslateFn;
  onClose: () => void;
  onSent: () => void;
}) {
  const [amount, setAmount] = useState(() => (listing.askingPrice / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = dollarsToCents(amount);

  async function send() {
    if (cents === null) return;
    setBusy(true);
    try {
      await api.post(`/marketplace/listings/${listing.id}/offers`, { amount: cents });
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailDrawer
      title={t('market.offer.title')}
      subtitle={listing.description || listing.typeClass}
      onClose={onClose}
      dirty
      footer={
        <>
          <Button variant="gold" disabled={busy || cents === null} onClick={send}>
            {t('market.offer.submit')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
        </>
      }
    >
      <dl className="detail-list">
        <div className="detail-row">
          <dt className="detail-label">{t('market.offer.askingPrice')}</dt>
          <dd className="detail-value num" dir="ltr">
            {formatUsd(listing.askingPrice)}
          </dd>
        </div>
      </dl>

      <div className="field" style={{ marginBlockStart: 'var(--sp-5)' }}>
        <label className="field-label" htmlFor="offer-amount">
          {t('market.offer.amountLabel')}
        </label>
        <div className="money-input">
          <span aria-hidden="true">$</span>
          <input
            id="offer-amount"
            inputMode="decimal"
            dir="ltr"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <p className="field-hint">{t('market.offer.hint')}</p>
      </div>

      {error && <div style={{ marginBlockStart: 'var(--sp-4)' }}><ErrorState message={error} /></div>}
    </DetailDrawer>
  );
}
