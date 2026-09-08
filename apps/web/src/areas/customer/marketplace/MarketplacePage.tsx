import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { ITEM_CLASSES, itemClassLabel } from '../../../shared/itemClasses';
import { EscrowTab } from './EscrowTab';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { Amount, Serial } from '../../../shared/ui/Serial';
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
  const { goTab, setParams } = useNavigation(route);

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Narrowing the shelf — and the narrowed shelf is a PLACE.
   *
   * Browse offered a free-text box over the description and the type class and
   * nothing else: no way to see only graded slabs, no price range, and one fixed
   * order with no control over it. Those controls were added, and then held in
   * `useState` — so a collector who found a graded slab under $200 could not
   * link it, bookmark it, reload it or send it to anybody, and the browser's
   * Back button walked out of the marketplace rather than out of the filter.
   *
   * They live in the URL now. `setParams` merges and drops empties, so an
   * unfiltered browse is `#/marketplace/browse` and a filtered one is
   * `#/marketplace/browse?type=trading_card&max=200`. It replaces rather than
   * pushes, because one history entry per keystroke is not a history.
   */
  const q = route.params.q ?? '';
  const type = route.params.type ?? '';
  const condition = route.params.condition ?? '';
  const minPrice = route.params.min ?? '';
  const maxPrice = route.params.max ?? '';
  const sort = (route.params.sort ?? 'newest') as 'newest' | 'price_asc' | 'price_desc';
  const filtered = Boolean(q || type || condition || minPrice || maxPrice || sort !== 'newest');

  const setQ = useCallback((value: string) => setParams({ q: value }), [setParams]);

  function clearFilters() {
    setParams({ q: null, type: null, condition: null, min: null, max: null, sort: null });
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
          {/*
            No section header over the shelf.

            The tab strip already says "Browse" and the page already says
            "Marketplace"; a third band repeating "Active listings / 1 listing"
            sat between them with the search box exiled to its far right, a
            thousand pixels from the five filters it belongs with. The search is
            the first filter, the count is the result, and both live in the
            filter bar now.
          */}
          <Panel flush>
            {/*
              The filter bar. Ordered the way somebody narrows a shelf: what they
              are looking for, what kind of thing, what condition it is in, what
              they are willing to pay, and only then how to order what is left.
            */}
            <div className="filter-bar" role="group" aria-label={t('market.filters')}>
              <div className="search field--grow">
                <IconSearch />
                <input
                  type="search"
                  placeholder={t('market.searchPlaceholder')}
                  aria-label={t('market.search')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              <Field label={t('market.filter.type')} className="field--compact">
                <select value={type} onChange={(e) => setParams({ type: e.target.value })}>
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
                  onChange={(e) => setParams({ condition: e.target.value })}
                  placeholder={t('market.filter.anyCondition')}
                />
              </Field>

              <Field label={t('market.filter.minPrice')} className="field--compact">
                <input
                  inputMode="decimal"
                  value={minPrice}
                  onChange={(e) => setParams({ min: e.target.value })}
                  placeholder="0"
                  dir="ltr"
                />
              </Field>

              <Field label={t('market.filter.maxPrice')} className="field--compact">
                <input
                  inputMode="decimal"
                  value={maxPrice}
                  onChange={(e) => setParams({ max: e.target.value })}
                  placeholder="—"
                  dir="ltr"
                />
              </Field>

              <Field label={t('market.filter.sort')} className="field--compact">
                <select
                  value={sort}
                  onChange={(e) => setParams({ sort: e.target.value })}
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

              <span className="spacer" />

              {listings !== null && (
                <span className="vault-count">
                  {listings.length === 1
                    ? t('market.listingsCountOne')
                    : t('market.listingsCount', { count: listings.length })}
                </span>
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
              <ul className="card-grid card-grid--listings">
                <li className="register-head" aria-hidden="true">
                  <span />
                  <span>{t('market.mine.col.price')}</span>
                  <span>{t('vault.col.state')}</span>
                  <span />
                </li>
                {listings.map((listing) => (
                  <li key={listing.id} className="card card--interactive card--listing">
                    {/* The photograph is the pitch: a fixed 4:5 stage, the shape
                        of a slab, so a shelf of listings is a shelf rather than
                        a ragged edge. */}
                    <div className="card-art">
                      <CardPhotoThumb
                        serialNumber={listing.serialNumber}
                        title={listing.description || listing.typeClass}
                      />
                    </div>

                    <div className="card-id">
                      {/* THE PRICE IS THE FIRST TEXT LINE. It used to be the
                          fourth thing in the tile, under a bold `trading_card`
                          and two lines of truncated catalogue string. */}
                      <p className="price">
                        <Amount>{formatUsd(listing.askingPrice)}</Amount>
                      </p>
                      <h3 className="card-title">
                        <Serial value={listing.serialNumber} />
                      </h3>
                      <p className="card-desc" title={listing.description || undefined}>
                        {listing.description || '—'}
                      </p>
                    </div>

                    <div className="card-state">
                      <span>{t('vault.condition', { grade: listing.conditionGrade ?? '—' })}</span>
                      <span className="card-sub">{itemClassLabel(t, listing.typeClass)}</span>
                    </div>

                    <div className="actions">
                      {/* Buying is irreversible and settles from the wallet;
                          making an offer opens a negotiation. They were the same
                          size and the same weight. */}
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
