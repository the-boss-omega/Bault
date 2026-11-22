import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { itemClassLabel } from '../../../shared/itemClasses';
import { Amount, Serial } from '../../../shared/ui/Serial';
import { formatUsd } from '../../../shared/money';
import { storefrontHref } from '../../../shared/market';
import { useI18n } from '../../../shared/i18n';
import { isValidUsername, normalizeUsername } from '../../../shared/names';
import { navigate } from '../../../shared/routing';
import { ListingDealFlow, type ListingDeal } from './ListingDeal';
import { Button, EmptyState, Panel, SuccessNote } from '../../../shared/ui/primitives';
import { IconSearch } from '../../../shared/ui/icons';

interface StorefrontListing {
  id: string;
  askingPrice: number;
  serialNumber: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
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
  const named = seller && isValidUsername(normalizeUsername(seller)) ? normalizeUsername(seller) : undefined;
  const target = named ?? myUsername;
  const [username, setUsername] = useState(target ?? '');
  const [viewing, setViewing] = useState<string | null>(null);
  const [listings, setListings] = useState<StorefrontListing[] | null>(null);
  const [deal, setDeal] = useState<ListingDeal | null>(null);

  const normalized = normalizeUsername(username);
  const ok = isValidUsername(normalized);

  const open = useCallback(
    async (who: string) => {
      try {
        const data = await api.get<{ username: string; listings: StorefrontListing[] }>(
          `/marketplace/sellers/${who}`,
        );
        setViewing(data.username);
        setListings(data.listings);
      } catch (e) {
        onError((e as Error).message);
        setListings([]);
      }
    },
    [onError],
  );

  useEffect(() => {
    if (target) void open(target);
  }, [target, open]);

  const visitor = Boolean(viewing && myUsername && viewing !== myUsername);

  function startDeal(kind: ListingDeal['kind'], l: StorefrontListing) {
    if (!viewing) return;
    setDeal({ kind, listing: { ...l, sellerUsername: viewing } });
  }

  function proposeTrade(l: StorefrontListing) {
    if (!viewing) return;
    navigate({ section: 'marketplace', tab: 'trade', params: { with: viewing, serial: l.serialNumber } });
  }

  return (
    <>
      <Panel title={t('market.store.title')} subtitle={t('market.store.subtitle')}>
        <div className="row" style={{ alignItems: 'end', maxWidth: 560 }}>
          <label className="field" style={{ flex: '1 1 220px' }}>
            <span className="field-label">{t('market.propose.username')}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
          </label>
          <Button
            variant="secondary"
            icon={<IconSearch />}
            disabled={!ok}
            onClick={() => void open(normalized)}
          >
            {t('market.store.view')}
          </Button>
        </div>

        {myUsername && (
          <SuccessNote>
            {t('market.store.yourLink', { link: storefrontHref(myUsername) })}
          </SuccessNote>
        )}
      </Panel>

      {viewing && (
        <Panel
          title={t('market.store.of', { username: viewing })}
          subtitle={
            listings === null ? undefined : t('market.listingsCount', { count: listings.length })
          }
        >
          {listings === null ? null : listings.length === 0 ? (
            <EmptyState
              title={t('market.store.empty')}
              text={t('market.store.emptyText')}
            />
          ) : (
            <ul className="card-grid card-grid--listings">
              {listings.map((l) => (
                <li key={l.id} className="card card--listing">
                  <div className="card-art">
                    <CardPhotoThumb serialNumber={l.serialNumber} title={l.description || ''} />
                  </div>
                  <div className="card-id">
                    <p className="price">
                      <Amount>{formatUsd(l.askingPrice)}</Amount>
                    </p>
                    <h3 className="card-title">
                      <Serial value={l.serialNumber} />
                    </h3>
                    <p className="card-desc">{l.description || '—'}</p>
                  </div>
                  <div className="card-state">
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
                  ) : (
                    <div />
                  )}
                </li>
              ))}
            </ul>
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
