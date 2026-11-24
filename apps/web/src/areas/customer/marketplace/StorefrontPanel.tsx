import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { itemClassLabel } from '../../../shared/itemClasses';
import { Amount, Serial } from '../../../shared/ui/Serial';
import { formatUsd } from '../../../shared/money';
import { storefrontHref, typedUsername } from '../../../shared/market';
import { useI18n } from '../../../shared/i18n';
import { isValidUsername } from '../../../shared/names';
import { navigate } from '../../../shared/routing';
import { ListingDealFlow, type ListingDeal } from './ListingDeal';
import { ListTools, LIST_TOOLS_FROM, byNumber, useListView, type SortOption } from './ListTools';
import { Button, EmptyState, Field, Panel, SkeletonBlock, StatusBadge } from '../../../shared/ui/primitives';
import { IconSearch } from '../../../shared/ui/icons';

interface StorefrontListing {
  id: string;
  askingPrice: number;
  serialNumber: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
}

const STORE_SORTS: readonly SortOption<StorefrontListing>[] = [
  { key: 'listed', label: 'market.sort.newest', compare: () => 0 },
  { key: 'price_asc', label: 'market.sort.priceAsc', compare: byNumber((r) => r.askingPrice, 1) },
  { key: 'price_desc', label: 'market.sort.priceDesc', compare: byNumber((r) => r.askingPrice, -1) },
];

const storeText = (r: StorefrontListing) => `${r.serialNumber} ${r.description} ${r.conditionGrade ?? ''}`;

export function storefrontUrl(username: string): string {
  if (typeof window === 'undefined') return storefrontHref(username);
  return `${window.location.origin}${window.location.pathname}${storefrontHref(username)}`;
}

export function StorefrontPanel({
  seller,
  myUsername,
  onDone,
  onError,
}: {
  seller?: string;
  myUsername?: string;
  onDone: (message: string, kind: ListingDeal['kind']) => Promise<void> | void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const named = seller && isValidUsername(typedUsername(seller)) ? typedUsername(seller) : undefined;
  const target = named ?? myUsername;
  const [username, setUsername] = useState(target ?? '');
  const [viewing, setViewing] = useState<string | null>(null);
  const [listings, setListings] = useState<StorefrontListing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [deal, setDeal] = useState<ListingDeal | null>(null);
  const [copied, setCopied] = useState(false);
  const view = useListView(listings, storeText, STORE_SORTS);

  const normalized = typedUsername(username);
  const ok = isValidUsername(normalized);

  useEffect(() => {
    if (target) setUsername((prev) => (prev === '' ? target : prev));
  }, [target]);

  const open = useCallback(async (who: string) => {
    setLoading(true);
    setLookupError(null);
    try {
      const data = await api.get<{ username: string; listings: StorefrontListing[] }>(`/marketplace/sellers/${who}`);
      setViewing(data.username);
      setListings(data.listings);
    } catch (e) {
      setLookupError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (target) void open(target);
  }, [target, open]);

  const visitor = Boolean(viewing && myUsername && viewing !== myUsername);
  const own = Boolean(viewing && myUsername && viewing === myUsername);

  function startDeal(kind: ListingDeal['kind'], l: StorefrontListing) {
    if (!viewing) return;
    setDeal({ kind, listing: { ...l, sellerUsername: viewing } });
  }

  function proposeTrade(l: StorefrontListing) {
    if (!viewing) return;
    navigate({ section: 'marketplace', tab: 'trade', params: { with: viewing, serial: l.serialNumber } });
  }

  async function copyLink() {
    if (!myUsername) return;
    try {
      await navigator.clipboard.writeText(storefrontUrl(myUsername));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Panel title={t('market.store.title')} subtitle={t('market.store.subtitle')}>
        <form
          className="row"
          style={{ alignItems: 'start', maxWidth: 560 }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) {
              setLookupError(t('market.propose.usernameBad'));
              return;
            }
            void open(normalized);
          }}
        >
          <Field
            label={t('market.propose.username')}
            error={lookupError ?? undefined}
            className="field--grow"
          >
            <input
              value={username}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={lookupError ? true : undefined}
              onChange={(e) => {
                setUsername(e.target.value);
                setLookupError(null);
              }}
            />
          </Field>
          <Button type="submit" variant="secondary" className="btn--field-aligned" icon={<IconSearch />} disabled={loading}>
            {t('market.store.view')}
          </Button>
        </form>

        {myUsername && (
          <div className="stack stack--tight stack-top">
            <p className="field-hint">{t('market.store.yourLinkLabel')}</p>
            <div className="row">
              <code dir="ltr" className="ltr-run">
                {storefrontUrl(myUsername)}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void copyLink()}>
                {t('market.store.copy')}
              </Button>
              {copied && (
                <span className="field-hint" role="status">
                  {t('market.store.copied')}
                </span>
              )}
            </div>
          </div>
        )}
      </Panel>

      {(viewing || loading) && (
        <Panel
          title={viewing ? t('market.store.of', { username: viewing }) : t('market.store.title')}
          subtitle={
            listings === null || loading
              ? undefined
              : listings.length === 1
                ? t('market.listingsCountOne')
                : t('market.listingsCount', { count: listings.length })
          }
          flush
        >
          {loading || listings === null ? (
            <ul className="card-grid">
              {Array.from({ length: 3 }, (_, i) => (
                <li key={i}>
                  <SkeletonBlock className="skel-metric" />
                </li>
              ))}
            </ul>
          ) : listings.length === 0 ? (
            <EmptyState
              title={t('market.store.empty')}
              text={own ? t('market.store.emptyOwn') : t('market.store.emptyText')}
              action={
                own ? (
                  <Button size="sm" variant="primary" onClick={() => navigate({ section: 'marketplace', tab: 'sell' })}>
                    {t('market.mine.listOne')}
                  </Button>
                ) : visitor && viewing ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate({ section: 'marketplace', tab: 'trade', params: { with: viewing } })}
                  >
                    {t('market.store.proposeTrade')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {listings.length > LIST_TOOLS_FROM && (
                <ListTools label={t('market.store.of', { username: viewing ?? '' })} view={view} sorts={STORE_SORTS} total={listings.length} />
              )}
              {view.shown?.length === 0 && <EmptyState title={t('market.list.noMatch')} text={t('market.list.noMatchText')} />}
              <ul className="card-grid card-grid--listings">
                {(view.shown ?? []).map((l) => (
                  <li key={l.id} className="card card--listing">
                    <div className="card-art">
                      <CardPhotoThumb serialNumber={l.serialNumber} title={l.description || ''} />
                    </div>
                    <div className="card-id">
                      <span className="money-label">{t('market.mine.col.price')}</span>
                      <p className="price">
                        <Amount>{formatUsd(l.askingPrice)}</Amount>
                      </p>
                      <h3 className="card-title">
                        <Serial value={l.serialNumber} />
                      </h3>
                      <p className="card-desc" title={l.description || undefined}>
                        {l.description || '—'}
                      </p>
                    </div>
                    <div className="card-state">
                      <span>{t('vault.condition', { grade: l.conditionGrade ?? '—' })}</span>
                      <span className="card-sub">{itemClassLabel(t, l.typeClass)}</span>
                    </div>
                    {visitor ? (
                      <div className="actions">
                        <Button variant="primary" size="sm" onClick={() => startDeal('buy', l)}>
                          {t('market.buy')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => startDeal('offer', l)}>
                          {t('market.makeOffer')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => proposeTrade(l)}>
                          {t('market.store.proposeTrade')}
                        </Button>
                      </div>
                    ) : own ? (
                      <div className="actions">
                        <StatusBadge tone="gold" plain>
                          {t('market.yours')}
                        </StatusBadge>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate({ section: 'marketplace', tab: 'listings' })}
                        >
                          {t('market.manage')}
                        </Button>
                      </div>
                    ) : (
                      <div />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}

      <ListingDealFlow
        deal={deal}
        onClose={() => setDeal(null)}
        onDone={async (message, kind) => {
          if (kind === 'buy' && viewing) await open(viewing);
          await onDone(message, kind);
        }}
        onError={onError}
      />
    </>
  );
}
