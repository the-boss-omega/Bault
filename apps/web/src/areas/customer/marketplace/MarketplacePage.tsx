import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { ITEM_CLASSES, itemClassLabel, itemName } from '../../../shared/itemClasses';
import { EscrowTab } from './EscrowTab';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { slabLeave, slabMove } from '../../../shared/ui/slabTilt';
import { Amount, Code, ItemPick, Serial } from '../../../shared/ui/Serial';
import { storefrontHref } from '../../../shared/market';
import { dollarsToCents, formatUsd, isolate, isolateLtr } from '../../../shared/money';
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
import { HouseStorePanel } from './HouseStorePanel';
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
  sellerUsername: string | null;
  imageUrl?: string;
}

const TABS = ['browse', 'house', 'sell', 'listings', 'offers', 'trade', 'escrow', 'store'] as const;
type MarketTab = (typeof TABS)[number];

export function MarketplacePage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab, setParams } = useNavigation(route);

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [myUsername, setMyUsername] = useState<string | undefined>(undefined);
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

  useEffect(() => {
    const handle = setTimeout(() => void loadListings(query), 250);
    return () => clearTimeout(handle);
  }, [query, loadListings]);

  async function buy(listing: Listing) {
    try {
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
          <Panel flush>
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
                {listings.map((listing) => (
                  <li
                    key={listing.id}
                    className="card card--interactive card--listing"
                    onPointerMove={slabMove}
                    onPointerLeave={slabLeave}
                  >
                    <div className="card-art">
                      <CardPhotoThumb
                        serialNumber={listing.serialNumber}
                        title={itemName(t, listing)}
                      />
                    </div>

                    <div className="card-id">
                      <span className="money-label">{t('market.mine.col.price')}</span>
                      <p className="price">
                        <Amount>{formatUsd(listing.askingPrice)}</Amount>
                      </p>
                      <h3 className="card-title">
                        <Serial value={listing.serialNumber} />
                      </h3>
                      <p className="card-desc" title={listing.description || undefined}>
                        {listing.description || '—'}
                      </p>
                      {listing.sellerUsername && <SellerLine t={t} username={listing.sellerUsername} />}
                    </div>

                    <div className="card-state">
                      <span>{t('vault.condition', { grade: listing.conditionGrade ?? '—' })}</span>
                      <span className="card-sub">{itemClassLabel(t, listing.typeClass)}</span>
                    </div>

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

      {tab === 'house' && (
        <TabPanel tab="house">
          <HouseStorePanel
            onBought={async (m) => {
              setStatus(m);
              await reloadItems();
            }}
            onError={setError}
          />
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
                item: isolate(itemName(t, buying)),
                amount: isolateLtr(formatUsd(buying.askingPrice)),
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
          <StorefrontPanel seller={route.params.seller} myUsername={myUsername} onError={setError} />
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

function SellerLink({ t, username }: { t: TranslateFn; username: string }) {
  return (
    <a href={storefrontHref(username)} aria-label={t('market.store.of', { username })}>
      <Code value={`@${username}`} />
    </a>
  );
}

function SellerLine({ t, username }: { t: TranslateFn; username: string }) {
  return (
    <p className="card-sub">
      {t('market.listing.soldBy')} <SellerLink t={t} username={username} />
    </p>
  );
}

export function SellPanel({
  items,
  t,
  onListed,
  onError,
}: {
  items: readonly { id: string; serialNumber?: string; typeClass: string; description: string }[];
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
        <div className="stack stack--tight">
          <fieldset className="field field--cards">
            <legend className="field-label">{t('market.sell.itemLabel')}</legend>
            <ul className="check-list">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="check">
                    <input
                      type="radio"
                      name="sell-item"
                      value={item.id}
                      checked={itemId === item.id}
                      onChange={() => setItemId(item.id)}
                    />
                    <ItemPick serial={item.serialNumber} name={itemName(t, item)} />
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="stack stack--tight" style={{ maxWidth: 460 }}>
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
        </div>
      )}
    </Panel>
  );
}

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
      subtitle={itemName(t, listing)}
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
        {listing.sellerUsername && (
          <div className="detail-row">
            <dt className="detail-label">{t('market.listing.soldBy')}</dt>
            <dd className="detail-value">
              <SellerLink t={t} username={listing.sellerUsername} />
            </dd>
          </div>
        )}
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
