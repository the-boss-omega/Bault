import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { itemClassLabel } from '../../../shared/itemClasses';
import { Amount, Serial } from '../../../shared/ui/Serial';
import { formatUsd } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { isValidUsername, normalizeUsername } from '../../../shared/names';
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

/**
 * A collector's public storefront: everything one seller currently has for sale.
 *
 * The endpoint behind it is `@Public()` on purpose: this is the page a seller
 * shares. Only active listings appear, because a sold or delisted card is not
 * for sale.
 *
 * The seller's own link is shown here, since the point of the feature is having
 * something to send somebody.
 */
export function StorefrontPanel({
  myUsername,
  onError,
}: {
  myUsername?: string;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(myUsername ?? '');
  const [viewing, setViewing] = useState<string | null>(null);
  const [listings, setListings] = useState<StorefrontListing[] | null>(null);

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

  // Land on the reader's own storefront: the first question somebody has about
  // this page is "what does mine look like".
  useEffect(() => {
    if (myUsername) void open(myUsername);
  }, [myUsername, open]);

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
            {t('market.store.yourLink', { link: `#/marketplace/store?seller=${myUsername}` })}
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
            /*
              A public storefront is the vault's register, read-only: the same
              columns, components and order (photograph, price, serial, name).
            */
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
                  <div />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
