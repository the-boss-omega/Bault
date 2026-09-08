import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { ITEM_CLASSES } from '../../../shared/itemClasses';
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
  Field,
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
  /**
   * Narrowing the shelf, which was not possible at all.
   *
   * Browse offered a free-text box over the description and the type class and
   * nothing else: no way to see only graded slabs, no price range, and one fixed
   * order (newest first) with no control over it. Somebody looking for a slab
   * under $200 had to read every listing, and somebody comparing prices had to do
   * it by eye — the first two things anybody does on a marketplace.
   *
   * Held in component state rather than the URL: these are a reading position,
   * not a record, and the route already carries the drawer. The one thing that
   * IS worth keeping is whether any of them are set, so the panel can offer to
   * clear them.
   */
  const [type, setType] = useState('');
  const [condition, setCondition] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');
  const filtered = Boolean(q || type || condition || minPrice || maxPrice || sort !== 'newest');

  function clearFilters() {
    setQ('');
    setType('');
    setCondition('');
    setMinPrice('');
    setMaxPrice('');
    setSort('newest');
  }
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

  /**
   * Filtering happens on the SERVER, not over the rows already fetched.
   *
   * The query is capped at 200 listings, so narrowing a page in the client would
   * silently hide matches that fell off the end of an unfiltered page — a filter
   * that quietly lies is worse than no filter.
   */
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (type) params.set('type', type);
    if (condition.trim()) params.set('condition', condition.trim());
    const cents = (value: string) => dollarsToCents(value);
    const min = cents(minPrice);
    const max = cents(maxPrice);
    if (min !== null) params.set('minPrice', String(min));
    if (max !== null) params.set('maxPrice', String(max));
    if (sort !== 'newest') params.set('sort', sort);
    return params.toString();
  }, [q, type, condition, minPrice, maxPrice, sort]);

  const loadListings = useCallback(async (search: string) => {
    try {
      setListings(await api.get<Listing[]>(`/marketplace/listings?${search}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setListings([]);
    }
  }, []);

  // Incremental search-as-you-type: debounce a refetch on every change so results
  // update live from a partial query — no Enter/button required.
  useEffect(() => {
    const handle = setTimeout(() => void loadListings(query), 250);
    return () => clearTimeout(handle);
  }, [query, loadListings]);

  async function buy(listing: Listing) {
    try {
      // A replay is not a second purchase, and must not be reported as one — a
      // double-clicked button otherwise says "Purchased" twice.
      const result = await api.post<{ replayed?: boolean }>(
        `/marketplace/listings/${listing.id}/purchase`,
      );
      setStatus(result?.replayed ? t('market.alreadyBought') : t('market.status.purchased'));
      setError(null);
      await loadListings(query);
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
            {/*
              The filter bar. Ordered the way somebody narrows a shelf: what kind
              of thing, what condition it is in, what they are willing to pay, and
              only then how to order what is left.
            */}
            <div className="filter-bar" role="group" aria-label={t('market.filters')}>
              <Field label={t('market.filter.type')} className="field--compact">
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">{t('market.filter.anyType')}</option>
                  {ITEM_CLASSES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {t(c.labelKey)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t('market.filter.condition')} className="field--compact">
                <input
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder={t('market.filter.anyCondition')}
                />
              </Field>

              <Field label={t('market.filter.minPrice')} className="field--compact">
                <input
                  inputMode="decimal"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="0"
                  dir="ltr"
                />
              </Field>

              <Field label={t('market.filter.maxPrice')} className="field--compact">
                <input
                  inputMode="decimal"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="—"
                  dir="ltr"
                />
              </Field>

              <Field label={t('market.filter.sort')} className="field--compact">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                >
                  <option value="newest">{t('market.sort.newest')}</option>
                  <option value="price_asc">{t('market.sort.priceAsc')}</option>
                  <option value="price_desc">{t('market.sort.priceDesc')}</option>
                </select>
              </Field>

              {/* Offered only when there is something to clear, so the bar does
                  not carry a permanently dead control. */}
              {filtered && (
                <Button size="sm" variant="ghost" onClick={clearFilters}>
                  {t('market.filter.clear')}
                </Button>
              )}
            </div>

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
                text={filtered ? t('market.empty.searchText') : t('market.empty.text')}
                icon={<IconMarketplace />}
                /* An empty shelf caused by a filter has a way out; an empty shelf
                   because nothing is for sale does not, and offering one would be
                   a button that changes nothing. */
                action={
                  filtered ? (
                    <Button size="sm" onClick={clearFilters}>
                      {t('market.filter.clear')}
                    </Button>
                  ) : undefined
                }
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

      {error && <div className="stack-top" ><ErrorState message={error} /></div>}
    </DetailDrawer>
  );
}
