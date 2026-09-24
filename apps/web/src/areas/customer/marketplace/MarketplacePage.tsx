import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { ITEM_CLASSES, itemClassLabel } from '../../../shared/itemClasses';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { Amount, Serial } from '../../../shared/ui/Serial';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import { displayName } from '../../../shared/timeline';
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
import { IconSearch, IconTag } from '../../../shared/ui/icons';
import { MyListingsPanel, OffersPanel, SwapsPanel } from './SellerPanels';
import { ProposeTradePanel } from './ProposeTradePanel';
import { StorefrontPanel } from './StorefrontPanel';
import { ListingActions, type Listing } from './ListingActions';
import { loadProfile } from '../../../shared/session';


/**
 * The tabs of the marketplace proper: collector-to-collector trade.
 *
 * `house` and `escrow` used to sit here and no longer do. Neither was a way of
 * browsing other collectors' shelves — the Bault store is stock the house sells
 * itself, and escrow is a deal agreed somewhere else entirely, with no listing
 * anywhere — so both are destinations of their own on the rail, and a reader
 * looking for either no longer has to know they are hidden behind Marketplace.
 */
const TABS = ['browse', 'sell', 'listings', 'offers', 'trade', 'store'] as const;
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
  const [status, setStatusRaw] = useState<string | null>(null);
  const [error, setErrorRaw] = useState<string | null>(null);
  // A banner answers the LAST thing done: a success clears an older error and
  // an error clears an older success. They used to stack — "Proposal sent"
  // beside the error from a lookup two minutes earlier.
  const setStatus = useCallback((m: string | null) => {
    setErrorRaw(null);
    setStatusRaw(m);
  }, []);
  const setError = useCallback((m: string | null) => {
    setStatusRaw(null);
    setErrorRaw(m);
  }, []);
  /** Bumped when a trade is proposed, so the proposals list below reloads. */
  const [swapsVersion, setSwapsVersion] = useState(0);
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
  /**
   * The reader's own active listings, by id.
   *
   * Browse offered Buy and Make offer on your own card: confirming the purchase
   * answered 403 only after the confirmation, and the offer form was addressed to
   * yourself. The public listing rows carry no seller (on purpose), so the
   * reader's own list is what tells them apart.
   */
  const [mine, setMine] = useState<ReadonlySet<string>>(() => new Set());
  const loadMine = useCallback(async () => {
    try {
      const rows = await api.get<{ id: string; status?: string }[]>('/marketplace/listings/mine');
      setMine(new Set(rows.map((r) => r.id)));
    } catch {
      /* signed out or offline: nothing is marked as the reader's own */
    }
  }, []);
  useEffect(() => {
    void loadMine();
  }, [loadMine]);
  /** The reader's own username, so the storefront tab can open on their shop. */
  const [myUsername, setMyUsername] = useState<string | undefined>(undefined);

  useEffect(() => {
    void loadProfile()
      .then((p) => setMyUsername(p.username))
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
      setParams({ listing: null });
      await loadListings(query);
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuying(null);
    }
  }

  const tabs = TABS.map((key) => ({ key, label: t(`market.tab.${key}` as MessageKey) }));

  // A banner belongs to the tab it was raised on.
  useEffect(() => {
    setStatusRaw(null);
    setErrorRaw(null);
  }, [tab]);

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
                        {displayName(listing.description) || '—'}
                      </p>
                    </div>

                    <div className="card-state">
                      <span>{t('vault.condition', { grade: listing.conditionGrade ?? '—' })}</span>
                      <span className="card-sub">{itemClassLabel(t, listing.typeClass)}</span>
                    </div>

                    <ListingActions
                      listing={listing}
                      mine={mine.has(listing.id)}
                      t={t}
                      onBuy={setBuying}
                      onOffer={setOffering}
                      onManage={() => goTab('listings')}
                      onDetails={() => setParams({ listing: listing.id })}
                    />
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
            preselect={route.params.item}
            onListed={async () => {
              setStatus(t('market.status.listed'));
              await loadListings(query);
              await loadMine();
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
                item: displayName(buying.description) || itemClassLabel(t, buying.typeClass),
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
          <ProposeTradePanel
            onProposed={async (m) => {
              setStatus(m);
              setSwapsVersion((v) => v + 1);
              await reloadItems();
            }}
            onError={setError}
          />
          <SwapsPanel
            key={swapsVersion}
            onChanged={async (m) => {
              setStatus(m);
              await reloadItems();
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {tab === 'store' && (
        <TabPanel tab="store">
          <StorefrontPanel
            myUsername={myUsername}
            seller={route.params.seller}
            onSeller={(who) => setParams({ seller: who })}
            mine={mine}
            onBuy={setBuying}
            onOffer={setOffering}
            onManage={() => goTab('listings')}
            onError={setError}
          />
        </TabPanel>
      )}

      {route.params.listing && !offering && !buying && (
        <ListingDrawer
          id={route.params.listing}
          mine={mine.has(route.params.listing)}
          t={t}
          onClose={() => setParams({ listing: null })}
          onBuy={setBuying}
          onOffer={setOffering}
          onManage={() => goTab('listings')}
        />
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
  preselect,
  onListed,
  onError,
}: {
  items: readonly { id: string; typeClass: string; description: string; serialNumber?: string }[];
  t: TranslateFn;
  /** `?item=` — the card the vault drawer's "List for sale" was pressed on. */
  preselect?: string;
  onListed: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [itemId, setItemId] = useState('');
  // Empty, not a figure: $500.00 was pre-filled for every card, a price nobody
  // chose that one tap would have published.
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (itemId) return;
    const wanted = preselect && items.find((i) => i.id === preselect);
    if (wanted) setItemId(wanted.id);
    else if (items[0]) setItemId(items[0].id);
  }, [items, itemId, preselect]);

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
                  {[item.serialNumber, displayName(item.description) || itemClassLabel(t, item.typeClass)]
                    .filter(Boolean)
                    .join(' — ')}
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
      subtitle={displayName(listing.description) || itemClassLabel(t, listing.typeClass)}
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

/**
 * One listing, by link: `#/marketplace/browse?listing=<id>`.
 *
 * A listing had no page of its own, so there was nothing to send somebody —
 * "it's on the marketplace somewhere" is not a link.
 */
function ListingDrawer({
  id,
  mine,
  t,
  onClose,
  onBuy,
  onOffer,
  onManage,
}: {
  id: string;
  mine: boolean;
  t: TranslateFn;
  onClose: () => void;
  onBuy: (l: Listing) => void;
  onOffer: (l: Listing) => void;
  onManage: () => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setListing(null);
    void api
      .get<Listing>(`/marketplace/listings/${encodeURIComponent(id)}`)
      .then((l) => {
        setListing(l);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const link = `${window.location.origin}${window.location.pathname}#/marketplace/browse?listing=${id}`;
  const name = listing ? displayName(listing.description) || itemClassLabel(t, listing.typeClass) : '';

  return (
    <DetailDrawer
      title={name || t('market.details')}
      subtitle={listing ? <Serial value={listing.serialNumber} /> : undefined}
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('ui.close')}
        </Button>
      }
    >
      {error && <ErrorState message={error} />}
      {listing && (
        <div className="stack stack--tight">
          <div className="stage">
            <CardPhotoThumb serialNumber={listing.serialNumber} title={name} />
          </div>
          <p className="price">
            <Amount>{formatUsd(listing.askingPrice)}</Amount>
          </p>
          <dl className="detail-list">
            <div className="detail-row">
              <dt className="detail-label">{t('vault.class')}</dt>
              <dd className="detail-value">{itemClassLabel(t, listing.typeClass)}</dd>
            </div>
            <div className="detail-row">
              <dt className="detail-label">{t('vault.item.condition')}</dt>
              <dd className="detail-value">{listing.conditionGrade ?? '—'}</dd>
            </div>
          </dl>
          {listing.status && listing.status !== 'active' ? (
            <p className="field-hint">{t('market.notForSale')}</p>
          ) : (
            <ListingActions
              listing={listing}
              mine={mine}
              t={t}
              onBuy={onBuy}
              onOffer={onOffer}
              onManage={onManage}
            />
          )}
          <div className="row">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? t('market.linkCopied') : t('market.copyLink')}
            </Button>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}
