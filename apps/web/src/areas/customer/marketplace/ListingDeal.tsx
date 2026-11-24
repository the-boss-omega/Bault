import { useState } from 'react';
import { api } from '../../../shared/api';
import { itemName } from '../../../shared/itemClasses';
import { Code } from '../../../shared/ui/Serial';
import { storefrontHref } from '../../../shared/market';
import { dollarsToCents, formatUsd, isolate } from '../../../shared/money';
import { useI18n, type TranslateFn } from '../../../shared/i18n';
import { Button, ErrorState, MoneyField } from '../../../shared/ui/primitives';
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
  if (!deal) return null;
  if (deal.kind === 'buy') {
    return <BuyConfirm key={deal.listing.id} listing={deal.listing} onClose={onClose} onDone={onDone} />;
  }
  return <OfferFlow listing={deal.listing} onClose={onClose} onDone={onDone} onError={onError} />;
}

function BuyConfirm({
  listing,
  onClose,
  onDone,
}: {
  listing: DealListing;
  onClose: () => void;
  onDone: (message: string, kind: ListingDeal['kind']) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const name = itemName(t, listing).split(' · ')[0]!;

  async function buy() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.post<{ replayed?: boolean }>(`/marketplace/listings/${listing.id}/purchase`);
      await onDone(
        result?.replayed
          ? t('market.alreadyBought')
          : t('market.status.boughtItem', { item: isolate(name), amount: formatUsd(listing.askingPrice) }),
        'buy',
      );
      onClose();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmationModal
      title={t('market.buy.confirmTitle')}
      body={
        <>
          <p>
            {t('market.buy.confirmBody', {
              item: isolate(itemName(t, listing)),
              amount: formatUsd(listing.askingPrice),
            })}
          </p>
          <p className="field-hint">{t('market.buy.next')}</p>
          {failure && <ErrorState message={failure} />}
        </>
      }
      confirmLabel={t('market.buy')}
      cancelLabel={t('ui.cancel')}
      busy={busy}
      onConfirm={() => void buy()}
      onCancel={onClose}
    />
  );
}

function OfferFlow({
  listing,
  onClose,
  onDone,
}: {
  listing: DealListing;
  onClose: () => void;
  onDone: (message: string, kind: ListingDeal['kind']) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  return (
    <OfferDrawer
      listing={listing}
      t={t}
      onClose={onClose}
      onSent={async (cents) => {
        await onDone(t('market.status.offerSentTo', { amount: formatUsd(cents) }), 'offer');
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
  onSent: (cents: number) => Promise<void> | void;
}) {
  const [amount, setAmount] = useState(() => (listing.askingPrice / 100).toFixed(2));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = dollarsToCents(amount);
  const amountError = touched && amount.trim() !== '' && cents === null ? t('market.offer.amountBad') : undefined;
  const atAsking = cents !== null && cents >= listing.askingPrice;

  async function send() {
    setTouched(true);
    if (cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/marketplace/listings/${listing.id}/offers`, { amount: cents });
      await onSent(cents);
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
      notice={error ? <ErrorState message={error} /> : undefined}
      footer={
        <>
          <Button variant="primary" type="submit" form="offer-form" disabled={busy || cents === null}>
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

      <form
        id="offer-form"
        noValidate
        style={{ marginBlockStart: 'var(--sp-5)' }}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <MoneyField
          id="offer-amount"
          label={t('market.offer.amountLabel')}
          value={amount}
          autoFocus
          onChange={setAmount}
          onBlur={() => setTouched(true)}
          error={amountError}
          hint={atAsking ? t('market.offer.atAsking') : t('market.offer.hint')}
        />
      </form>
    </DetailDrawer>
  );
}
