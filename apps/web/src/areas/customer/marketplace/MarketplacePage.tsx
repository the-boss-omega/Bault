import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { ITEM_CLASSES, itemClassLabel, itemName } from '../../../shared/itemClasses';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { slabLeave, slabMove } from '../../../shared/ui/slabTilt';
import { Amount, ItemPick, Serial } from '../../../shared/ui/Serial';
import { dollarsToCents, formatUsd, isolate } from '../../../shared/money';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { navigate, useNavigation, useRoute } from '../../../shared/routing';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Field,
  MoneyField,
  Panel,
  SkeletonBlock,
  StatusBadge,
  SuccessNote,
  TabPanel,
} from '../../../shared/ui/primitives';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { IconSearch, IconTag } from '../../../shared/ui/icons';
import { MyListingsPanel, OffersPanel, SwapsPanel } from './SellerPanels';
import { ProposeTradePanel } from './ProposeTradePanel';
import { StorefrontPanel } from './StorefrontPanel';
import { ListingDealFlow, SellerLink, type ListingDeal } from './ListingDeal';
import { loadProfile } from '../../../shared/session';
import { LIST_TOOLS_FROM } from './ListTools';

interface Listing {
  id: string;
  askingPrice: number;
  currency: string;
  serialNumber: string;
  typeClass: string;
  conditionGrade: string | null;
  description: string;
  sellerUsername: string | null;
  imageUrl?: string;
}

const TABS = ['browse', 'sell', 'listings', 'offers', 'trade', 'store'] as const;
type MarketTab = (typeof TABS)[number];

export function MarketplacePage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab, setParams } = useNavigation(route);

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [deal, setDeal] = useState<ListingDeal | null>(null);
  const keepStatus = useRef(false);
  const { items, loaded: itemsLoaded, reload: reloadItems } = useVaultItems(true);
  const [myUsername, setMyUsername] = useState<string | undefined>(undefined);

  useEffect(() => {
    void loadProfile()
      .then((p) => setMyUsername(p.username))
      .catch(() => undefined);
  }, []);

  const tab: MarketTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as MarketTab)
    : 'browse';

  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    setError(null);
    if (!keepStatus.current) setStatus(null);
    keepStatus.current = false;
  }, [tab]);

  const minCents = dollarsToCents(minPrice);
  const maxCents = dollarsToCents(maxPrice);
  const minBad = minPrice.trim() !== '' && minCents === null;
  const maxBad = maxPrice.trim() !== '' && maxCents === null;
  const rangeBad = minCents !== null && maxCents !== null && minCents > maxCents;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (type) params.set('type', type);
    if (condition.trim()) params.set('condition', condition.trim());
    const min = dollarsToCents(minPrice);
    const max = dollarsToCents(maxPrice);
    if (min !== null) params.set('minPrice', String(min));
    if (max !== null && (min === null || max >= min)) params.set('maxPrice', String(max));
    if (sort !== 'newest') params.set('sort', sort);
    return params.toString();
  }, [q, type, condition, minPrice, maxPrice, sort]);

  const loadListings = useCallback(async (search: string) => {
    try {
      setListings(await api.get<Listing[]>(`/marketplace/listings?${search}`));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setListings([]);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void loadListings(query), 250);
    return () => clearTimeout(handle);
  }, [query, loadListings]);

  const dealDone = useCallback(
    async (message: string, kind: ListingDeal['kind']) => {
      setStatus(message);
      setError(null);
      if (kind === 'buy') {
        await loadListings(query);
        await reloadItems();
      }
    },
    [loadListings, query, reloadItems],
  );

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

              <Field
                label={t('market.filter.minPrice')}
                className="field--compact"
                error={minBad ? t('market.filter.priceBad') : undefined}
              >
                <input
                  aria-invalid={minBad || undefined}
                  inputMode="decimal"
                  value={minPrice}
                  onChange={(e) => setParams({ min: e.target.value })}
                  placeholder="0"
                  dir="ltr"
                />
              </Field>

              <Field
                label={t('market.filter.maxPrice')}
                className="field--compact"
                error={
                  maxBad ? t('market.filter.priceBad') : rangeBad ? t('market.filter.rangeBad') : undefined
                }
              >
                <input
                  aria-invalid={maxBad || rangeBad || undefined}
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
                <span className="vault-count" role="status">
                  {listings.length === 1
                    ? t('market.listingsCountOne')
                    : t('market.listingsCount', { count: listings.length })}
                </span>
              )}
            </div>

            {loadError ? (
              <ErrorState
                title={t('market.loadFailed')}
                message={loadError}
                onRetry={() => {
                  setListings(null);
                  void loadListings(query);
                }}
                retryLabel={t('ui.retry')}
              />
            ) : listings === null ? (
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
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => goTab('sell')}>
                      {t('market.empty.sellOne')}
                    </Button>
                  )
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

                    {myUsername !== undefined && listing.sellerUsername === myUsername ? (
                      <div className="actions">
                        <StatusBadge tone="gold" plain>
                          {t('market.yours')}
                        </StatusBadge>
                        <Button variant="secondary" size="sm" onClick={() => goTab('listings')}>
                          {t('market.manage')}
                        </Button>
                      </div>
                    ) : (
                      <div className="actions">
                        <Button variant="primary" size="sm" onClick={() => setDeal({ kind: 'buy', listing })}>
                          {t('market.buy')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setDeal({ kind: 'offer', listing })}>
                          {t('market.makeOffer')}
                        </Button>
                      </div>
                    )}
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
            key={route.params.item ?? route.params.serial ?? ''}
            items={items}
            t={t}
            loaded={itemsLoaded}
            initialItem={route.params.item ?? route.params.serial}
            onListed={async (message) => {
              setStatus(message);
              keepStatus.current = true;
              await loadListings(query);
              await reloadItems();
              goTab('listings');
            }}
          />
        </TabPanel>
      )}

      {tab === 'listings' && (
        <TabPanel tab="listings">
          <MyListingsPanel onChanged={async (m) => setStatus(m)} />
        </TabPanel>
      )}

      {tab === 'offers' && (
        <TabPanel tab="offers">
          <OffersPanel
            onChanged={async (m) => {
              setStatus(m);
              await loadListings(query);
              await reloadItems();
            }}
          />
        </TabPanel>
      )}

      {tab === 'trade' && (
        <TabPanel tab="trade">
          <ProposeTradePanel
            key={`${route.params.with ?? ''}|${route.params.serial ?? ''}`}
            initialUsername={route.params.with}
            initialSerial={route.params.serial}
            onProposed={async (m) => setStatus(m)}
          />
          <SwapsPanel
            onChanged={async (m) => {
              setStatus(m);
              await reloadItems();
            }}
          />
        </TabPanel>
      )}

      {tab === 'store' && (
        <TabPanel tab="store">
          <StorefrontPanel
            seller={route.params.seller}
            myUsername={myUsername}
            onDone={dealDone}
            onError={setError}
          />
        </TabPanel>
      )}

      <ListingDealFlow deal={deal} onClose={() => setDeal(null)} onDone={dealDone} onError={setError} />
    </>
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
  loaded = true,
  initialItem,
  onListed,
}: {
  items: readonly { id: string; serialNumber?: string; typeClass: string; description: string }[];
  t: TranslateFn;
  loaded?: boolean;
  initialItem?: string;
  onListed: (message: string) => Promise<void>;
  onError?: (message: string) => void;
}) {
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const [touched, setTouched] = useState(false);
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (itemId && items.some((item) => item.id === itemId)) return;
    const wanted = initialItem
      ? items.find((item) => item.id === initialItem || item.serialNumber === initialItem)
      : undefined;
    const first = wanted ?? items[0];
    if (first) setItemId(first.id);
  }, [items, itemId, initialItem]);

  const asked = initialItem && loaded && !items.some((item) => item.id === initialItem || item.serialNumber === initialItem);

  const cents = dollarsToCents(price);
  const priceError = touched && price.trim() !== '' && cents === null ? t('market.sell.priceBad') : undefined;

  async function sell() {
    setTouched(true);
    if (!itemId || cents === null) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.post('/marketplace/listings', { itemId, askingPrice: cents });
      const listed = items.find((item) => item.id === itemId);
      await onListed(
        t('market.status.listedItem', {
          item: isolate(listed ? itemName(t, listed).split(' · ')[0]! : ''),
          amount: formatUsd(cents),
        }),
      );
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = items.find((item) => item.id === itemId);
  const needle = find.trim().toLowerCase();
  const pickable = needle
    ? items.filter(
        (item) =>
          item.id === itemId ||
          `${item.serialNumber ?? ''} ${itemName(t, item)}`.toLowerCase().includes(needle),
      )
    : items;

  return (
    <Panel title={t('market.sellLegend')} subtitle={t('market.sell.subtitle')}>
      {!loaded ? (
        <SkeletonBlock className="skel-metric" />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('services.noItems')}
          text={t('market.sell.noItemsText')}
          icon={<IconTag />}
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate({ section: 'vault', tab: null })}>
              {t('market.sell.toVault')}
            </Button>
          }
        />
      ) : (
        <form
          className="request-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void sell();
          }}
        >
          <div className="stack stack--tight request-form-fields">
            {asked && <SuccessNote tone="warning">{t('market.sell.notSellable')}</SuccessNote>}
            {items.length > LIST_TOOLS_FROM && (
              <div className="search">
                <IconSearch />
                <input
                  type="search"
                  placeholder={t('market.sell.find')}
                  aria-label={t('market.sell.find')}
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                />
              </div>
            )}
            <fieldset className="field field--cards">
              <legend className="field-label">{t('market.sell.itemLabel')}</legend>
              <ul className="check-list">
                {pickable.map((item) => (
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

            <MoneyField
              id="ask-price"
              label={t('market.sell.priceLabel')}
              value={price}
              placeholder="0.00"
              onChange={setPrice}
              onBlur={() => setTouched(true)}
              error={priceError}
              hint={cents === null ? t('market.sell.priceHint') : t('market.sell.willList', { amount: formatUsd(cents) })}
            />
          </div>

          <aside className="request-slip">
            <DrawerTag
              kicker={t('market.sell.priceLabel')}
              art={
                chosen?.serialNumber ? (
                  <CardPhotoThumb serialNumber={chosen.serialNumber} title={itemName(t, chosen)} decorative />
                ) : undefined
              }
              amount={cents !== null && cents > 0 ? formatUsd(cents) : '—'}
              lines={
                chosen
                  ? [
                      ...(chosen.serialNumber
                        ? [{ label: t('vault.serial'), value: <Serial value={chosen.serialNumber} /> }]
                        : []),
                      { label: t('market.mine.col.item'), value: <span className="ltr-run">{itemName(t, chosen).split(' · ')[0]}</span> },
                    ]
                  : []
              }
              status={<StatusBadge tone="success">{t('market.listing.active')}</StatusBadge>}
            />
          </aside>

          <div className="stack stack--tight request-form-actions">
            {failure && <ErrorState message={failure} />}
            <Button type="submit" variant="primary" block disabled={busy || !itemId || cents === null}>
              {t('market.listForSale')}
            </Button>
            <p className="field-hint">{t('market.sell.next')}</p>
          </div>
        </form>
      )}
    </Panel>
  );
}
