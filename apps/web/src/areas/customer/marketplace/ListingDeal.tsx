import { useState } from 'react';
import { api } from '../../../shared/api';
import { itemName } from '../../../shared/itemClasses';
import { Code } from '../../../shared/ui/Serial';
import { storefrontHref } from '../../../shared/market';
import { dollarsToCents, formatUsd, isolate } from '../../../shared/money';
import { useI18n, type TranslateFn } from '../../../shared/i18n';
import { Button, ErrorState } from '../../../shared/ui/primitives';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';

export interface DealListing {
  id: string;
  askingPrice: number;
  serialNumber: string;
  typeClass: string;
  description: string;
  sellerUsername: string | null;
}

export type ListingDeal = { kind: 'buy' | 'offer'; listing: DealListing };

export function SellerLink({ t, username }: { t: TranslateFn; username: string }) {
  return (
    <a href={storefrontHref(username)} aria-label={t('market.store.of', { username })}>
      <Code value={`@${username}`} />
    </a>
  );
}

export function ListingDealFlow({
  deal,
  onClose,
  onDone,
  onError,
}: {
  deal: ListingDeal | null;
  onClose: () => void;
  onDone: (message: string, kind: ListingDeal['kind']) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  if (!deal) return null;
  const { listing } = deal;

  async function buy() {
    try {
      const result = await api.post<{ replayed?: boolean }>(
        `/marketplace/listings/${listing.id}/purchase`,
      );
      await onDone(result?.replayed ? t('market.alreadyBought') : t('market.status.purchased'), 'buy');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onClose();
    }
  }

  if (deal.kind === 'buy') {
    return (
      <ConfirmationModal
        title={t('market.buy.confirmTitle')}
        body={
          <p>
            {t('market.buy.confirmBody', {
              item: isolate(itemName(t, listing)),
              amount: formatUsd(listing.askingPrice),
            })}
          </p>
        }
        confirmLabel={t('market.buy')}
        cancelLabel={t('ui.cancel')}
        onConfirm={() => void buy()}
        onCancel={onClose}
      />
    );
  }

  return (
    <OfferDrawer
      listing={listing}
      t={t}
      onClose={onClose}
      onSent={async () => {
        await onDone(t('market.status.offerSent'), 'offer');
        onClose();
      }}
    />
  );
}

function OfferDrawer({
  listing,
  t,
  onClose,
  onSent,
}: {
  listing: DealListing;
  t: TranslateFn;
  onClose: () => void;
  onSent: () => Promise<void> | void;
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
      await onSent();
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
          <Button variant="primary" disabled={busy || cents === null} onClick={send}>
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
