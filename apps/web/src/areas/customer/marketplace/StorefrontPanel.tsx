import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { itemClassLabel } from '../../../shared/itemClasses';
import { Amount, Serial } from '../../../shared/ui/Serial';
import { formatUsd } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { isValidUsername, normalizeUsername } from '../../../shared/names';
import { displayName } from '../../../shared/timeline';
import { Button, EmptyState, Panel } from '../../../shared/ui/primitives';
import { IconSearch } from '../../../shared/ui/icons';
import { ListingActions, type Listing } from './ListingActions';

/**
 * A collector's public storefront — everything one seller currently has for sale.
 *
 * The endpoint behind it is `@Public()` on purpose: this is the page a seller
 * shares, and one that requires an account to open is not a storefront. Only
 * ACTIVE listings appear, because a sold or delisted card is not for sale and
 * advertising it would send people to a button that cannot work.
 *
 * The shop being viewed is in the URL (`?seller=`), so the link a seller copies
 * opens THEIR shop — it used to open the reader's own whatever the link said —
 * and every card in it can be bought or offered on, which a storefront with no
 * buy button could not.
 */
export function StorefrontPanel({
  myUsername,
  seller,
  onSeller,
  mine,
  onBuy,
  onOffer,
  onManage,
  onError,
}: {
  myUsername?: string;
  /** `?seller=` from the route. Absent: the reader's own shop. */
  seller?: string;
  onSeller: (username: string) => void;
  mine: ReadonlySet<string>;
  onBuy: (l: Listing) => void;
  onOffer: (l: Listing) => void;
  onManage: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const target = seller ?? myUsername;
  const [username, setUsername] = useState(target ?? '');
  const [viewing, setViewing] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [copied, setCopied] = useState(false);

  const normalized = normalizeUsername(username);
  const ok = isValidUsername(normalized);

  const open = useCallback(
    async (who: string) => {
      try {
        const data = await api.get<{ username: string; listings: Listing[] }>(
          `/marketplace/sellers/${encodeURIComponent(who)}`,
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
    if (!target) return;
    setUsername(target);
    void open(target);
  }, [target, open]);

  const myLink = myUsername
    ? `${window.location.origin}${window.location.pathname}#/marketplace/store?seller=${myUsername}`
    : null;

  return (
    <>
      <Panel title={t('market.store.title')} subtitle={t('market.store.subtitle')}>
        <form
          className="row"
          style={{ alignItems: 'end', maxWidth: 560 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onSeller(normalized);
          }}
        >
          <label className="field" style={{ flex: '1 1 220px' }}>
            <span className="field-label">{t('market.propose.username')}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" />
          </label>
          <Button type="submit" variant="secondary" icon={<IconSearch />} disabled={!ok}>
            {t('market.store.view')}
          </Button>
        </form>

        {myLink && (
          <div className="stack stack--tight stack-top">
            <span className="field-label">{t('market.store.yourLinkLabel')}</span>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <code className="code-inline" dir="ltr" style={{ overflowWrap: 'anywhere' }}>
                {myLink}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(myLink).then(() => setCopied(true));
                }}
              >
                {copied ? t('market.linkCopied') : t('market.copyLink')}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {viewing && (
        <Panel
          title={t('market.store.of', { username: viewing })}
          subtitle={listings === null ? undefined : t('market.listingsCount', { count: listings.length })}
        >
          {listings === null ? null : listings.length === 0 ? (
            <EmptyState title={t('market.store.empty')} text={t('market.store.emptyText')} />
          ) : (
            /*
              A public storefront is the vault's register: the same columns, the
              same components, the same order — photograph, price, serial, name —
              and the same Buy and Make offer as the shelf.
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
                    <p className="card-desc">{displayName(l.description) || '—'}</p>
                  </div>
                  <div className="card-state">
                    <span>{t('vault.condition', { grade: l.conditionGrade ?? '—' })}</span>
                    <span className="card-sub">{itemClassLabel(t, l.typeClass)}</span>
                  </div>
                  <ListingActions
                    listing={l}
                    mine={mine.has(l.id)}
                    t={t}
                    onBuy={onBuy}
                    onOffer={onOffer}
                    onManage={onManage}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
