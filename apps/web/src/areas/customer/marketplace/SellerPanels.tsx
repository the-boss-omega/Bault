import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { dollarsToCents, formatDate, formatUsd, isolate } from '../../../shared/money';
import { Amount, Code, Serial } from '../../../shared/ui/Serial';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { useI18n, type TranslateFn } from '../../../shared/i18n';
import { itemName } from '../../../shared/itemClasses';
import {
  LISTING_TONE,
  OFFER_TONE,
  SWAP_TONE,
  listingStatusLabel,
  offerStatusLabel,
  swapStatusLabel,
  type MyListing,
  type MyOffer,
  type MySwap,
} from '../../../shared/market';
import { Button, EmptyState, Panel, SkeletonTable, StatusBadge } from '../../../shared/ui/primitives';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { IconMarketplace, IconTag } from '../../../shared/ui/icons';
import { navigate } from '../../../shared/routing';
import { SwapGlyph, TradeSide } from './TradeSides';

export function MyListingsPanel({
  onChanged,
  onError,
}: {
  onChanged: (message: string) => Promise<void> | void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MyListing[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [removing, setRemoving] = useState<MyListing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<MyListing[]>('/marketplace/listings/mine'));
    } catch (e) {
      onError((e as Error).message);
      setRows([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reprice(listing: MyListing) {
    const cents = dollarsToCents(price);
    if (cents === null) return;
    setBusy(true);
    try {
      await api.patch(`/marketplace/listings/${listing.id}`, { askingPrice: cents });
      setEditing(null);
      await load();
      await onChanged(t('market.mine.repriced', { amount: formatUsd(cents) }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(listing: MyListing) {
    setBusy(true);
    try {
      const challenge = await api.post<{ confirmationToken: string }>(
        `/marketplace/listings/${listing.id}/remove`,
      );
      await api.post('/marketplace/listings/remove/confirm', {
        confirmationToken: challenge.confirmationToken,
      });
      setRemoving(null);
      await load();
      await onChanged(t('market.mine.removed'));
    } catch (e) {
      onError((e as Error).message);
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title={t('market.mine.title')} subtitle={t('market.mine.subtitle')} flush>
        {rows === null ? (
          <SkeletonTable rows={3} columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('market.mine.empty')}
            text={t('market.mine.emptyText')}
            icon={<IconTag />}
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => navigate({ section: 'marketplace', tab: 'sell' })}
              >
                {t('market.mine.listOne')}
              </Button>
            }
          />
        ) : (
          <ul className="slips" aria-label={t('market.mine.title')}>
            {rows.map((row) => (
              <li className="slip slip--listing" key={row.id}>
                <div className="slip-item">
                  <span className="slip-thumb">
                    <CardPhotoThumb serialNumber={row.serialNumber} title={row.description} />
                  </span>
                  <span className="slip-name">
                    <Serial value={row.serialNumber} />
                    <span className="slip-desc ltr-run">{itemName(t, row)}</span>
                  </span>
                </div>

                <div className="slip-money">
                  <span className="money-label">{t('market.mine.col.price')}</span>
                  {editing === row.id ? (
                    <div className="money-input">
                      <span aria-hidden="true">$</span>
                      <input
                        inputMode="decimal"
                        aria-label={t('market.mine.col.price')}
                        value={price}
                        autoFocus
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </div>
                  ) : (
                    <Amount size="lead">{formatUsd(row.askingPrice)}</Amount>
                  )}
                  <span className="slip-asking">
                    {t('market.mine.col.listed')} {formatDate(row.publishedAt, locale)}
                  </span>
                </div>

                <div className="slip-side">
                  <span className="slip-label">{t('market.mine.col.offers')}</span>
                  {row.pendingOffers > 0 ? (
                    <StatusBadge tone="warning">{row.pendingOffers}</StatusBadge>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>

                <div className="slip-state">
                  <StatusBadge tone={LISTING_TONE[row.status] ?? 'neutral'}>
                    {listingStatusLabel(t, row.status)}
                  </StatusBadge>
                </div>

                <div className="slip-actions">
                  {row.status === 'active' && (
                    <div className="actions">
                      {editing === row.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy || dollarsToCents(price) === null}
                            onClick={() => void reprice(row)}
                          >
                            {t('market.mine.save')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            {t('ui.cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditing(row.id);
                              setPrice((row.askingPrice / 100).toFixed(2));
                            }}
                          >
                            {t('market.mine.reprice')}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRemoving(row)}>
                            {t('market.mine.delist')}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {removing && (
        <ConfirmationModal
          title={t('market.mine.delistTitle')}
          body={<p>{t('market.mine.delistBody', { item: isolate(itemName(t, removing)) })}</p>}
          confirmLabel={t('market.mine.delist')}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          busy={busy}
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}

export function OffersPanel({
  onChanged,
  onError,
}: {
  onChanged: (message: string) => Promise<void> | void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MyOffer[] | null>(null);
  const [countering, setCountering] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<MyOffer[]>('/marketplace/offers/mine'));
    } catch (e) {
      onError((e as Error).message);
      setRows([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(offer: MyOffer, action: 'accept' | 'reject' | 'counter') {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'counter') {
        const cents = dollarsToCents(amount);
        if (cents === null) return;
        body.amount = cents;
      }
      await api.post(`/marketplace/offers/${offer.id}/respond`, body);
      setCountering(null);
      await load();
      await onChanged(
        t(
          action === 'accept'
            ? 'market.offers.accepted'
            : action === 'reject'
              ? offer.yourTurn
                ? 'market.offers.rejected'
                : 'market.offers.withdrawn'
              : offer.yourTurn
                ? 'market.offers.countered'
                : 'market.offers.changed',
        ),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('market.offers.title')} subtitle={t('market.offers.subtitle')} flush>
      {rows === null ? (
        <SkeletonTable rows={3} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('market.offers.empty')} text={t('market.offers.emptyText')} />
      ) : (
        <ul className="slips" aria-label={t('market.offers.title')}>
          {rows.map((row) => {
            const live = row.status === 'pending' && row.listingStatus === 'active';
            const against = row.askingPrice > 0 ? Math.min(1, row.amount / row.askingPrice) : 0;
            return (
              <li className="slip" key={row.id}>
                <div className="slip-item">
                  <span className="slip-thumb">
                    <CardPhotoThumb serialNumber={row.serialNumber} title={row.description} />
                  </span>
                  <span className="slip-name">
                    <Serial value={row.serialNumber} />
                    <span className="slip-desc ltr-run">{itemName(t, row)}</span>
                  </span>
                </div>

                <div className="slip-side">
                  <StatusBadge tone={row.direction === 'incoming' ? 'gold' : 'info'} plain>
                    {t(row.direction === 'incoming' ? 'market.offers.incoming' : 'market.offers.outgoing')}
                  </StatusBadge>
                  {row.direction === 'incoming' && row.buyerUsername && (
                    <span className="slip-turn">
                      <Code value={`@${row.buyerUsername}`} />
                    </span>
                  )}
                  {live && (
                    <span className="slip-turn">
                      {t(row.yourTurn ? 'market.offers.turnYours' : 'market.offers.turnTheirs')}
                    </span>
                  )}
                </div>

                <div className="slip-money">
                  <span className="money-label">{t('market.offers.col.offer')}</span>
                  <Amount size="lead">{formatUsd(row.amount)}</Amount>
                  <span className="slip-asking">
                    {t('market.offers.asking', { amount: formatUsd(row.askingPrice) })}
                  </span>
                  <span className="slip-gauge" aria-hidden="true">
                    <span style={{ inlineSize: `${Math.round(against * 100)}%` }} />
                  </span>
                </div>

                <div className="slip-state">
                  <StatusBadge tone={OFFER_TONE[row.status] ?? 'neutral'}>
                    {offerStatusLabel(t, row.status)}
                  </StatusBadge>
                  <span className="date">{formatDate(row.createdAt, locale)}</span>
                </div>

                <div className="slip-actions">
                  {live && (
                    <OfferActions
                      offer={row}
                      countering={countering === row.id}
                      amount={amount}
                      busy={busy}
                      t={t}
                      onCounterStart={() => {
                        setCountering(row.id);
                        setAmount((row.amount / 100).toFixed(2));
                      }}
                      onCounterCancel={() => setCountering(null)}
                      onAmount={setAmount}
                      onRespond={(action) => void respond(row, action)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function OfferActions({
  offer,
  countering,
  amount,
  busy,
  t,
  onCounterStart,
  onCounterCancel,
  onAmount,
  onRespond,
}: {
  offer: MyOffer;
  countering: boolean;
  amount: string;
  busy: boolean;
  t: TranslateFn;
  onCounterStart: () => void;
  onCounterCancel: () => void;
  onAmount: (v: string) => void;
  onRespond: (action: 'accept' | 'reject' | 'counter') => void;
}) {
  if (countering) {
    return (
      <div className="fulfill-form">
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('market.offers.counterAmount')}</span>
            <div className="money-input">
              <span aria-hidden="true">$</span>
              <input
                inputMode="decimal"
                value={amount}
                autoFocus
                onChange={(e) => onAmount(e.target.value)}
              />
            </div>
          </label>
        </div>
        <div className="actions">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || dollarsToCents(amount) === null}
            onClick={() => onRespond('counter')}
          >
            {t(offer.yourTurn ? 'market.offers.counter' : 'market.offers.change')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCounterCancel}>
            {t('ui.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  if (!offer.yourTurn) {
    return (
      <div className="actions">
        <span className="hint">
          {t(offer.side === 'buyer' ? 'market.offers.awaitingSeller' : 'market.offers.awaitingBuyer')}
        </span>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCounterStart}>
          {t('market.offers.change')}
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => onRespond('reject')}>
          {t('market.offers.withdraw')}
        </Button>
      </div>
    );
  }

  return (
    <div className="actions actions--row">
      <Button size="sm" variant="primary" disabled={busy} onClick={() => onRespond('accept')}>
        {t('market.offers.accept')}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onCounterStart}>
        {t('market.offers.counter')}
      </Button>
      <Button size="sm" variant="danger" disabled={busy} onClick={() => onRespond('reject')}>
        {t(offer.side === 'seller' ? 'market.offers.reject' : 'market.offers.decline')}
      </Button>
    </div>
  );
}

export function SwapsPanel({
  onChanged,
  onError,
}: {
  onChanged: (message: string) => Promise<void> | void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MySwap[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<MySwap[]>('/marketplace/swaps'));
    } catch (e) {
      onError((e as Error).message);
      setRows([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(swap: MySwap, action: 'approve' | 'reject') {
    setBusy(true);
    try {
      await api.post(`/marketplace/swaps/${swap.id}/${action}`);
      await load();
      await onChanged(t(action === 'approve' ? 'market.swaps.approved' : 'market.swaps.rejected'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('market.swaps.title')} subtitle={t('market.swaps.subtitle')} flush>
      {rows === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('market.swaps.empty')} text={t('market.swaps.emptyText')} icon={<IconMarketplace />} />
      ) : (
        <ul className="slips" aria-label={t('market.swaps.title')}>
          {rows.map((row) => {
            const incoming = row.direction === 'incoming';
            const gift = row.kind === 'transfer';
            const theyGet = incoming ? row.requestedItems : row.offeredItems;
            const youGet = incoming ? row.offeredItems : row.requestedItems;
            const other = incoming ? row.proposerUsername : row.responderUsername;
            return (
              <li className="slip slip--trade" key={row.id}>
                <div className="slip-side">
                  <StatusBadge tone={gift ? 'gold' : 'info'} plain>
                    {t(gift ? 'market.swaps.gift' : 'market.swaps.swap')}
                  </StatusBadge>
                  {other && (
                    <span className="slip-turn">
                      {t('market.swaps.col.with')} <Code value={`@${other}`} />
                    </span>
                  )}
                  <span className="date">{formatDate(row.createdAt, locale)}</span>
                </div>

                <TradeSide label={t('market.swaps.col.theyGet')} items={theyGet} area="give" t={t} />
                <SwapGlyph oneWay={gift} towardStart={theyGet.length > 0} />
                <TradeSide label={t('market.swaps.col.youGet')} items={youGet} area="get" t={t} />

                <div className="slip-state">
                  <StatusBadge tone={SWAP_TONE[row.status] ?? 'neutral'}>
                    {swapStatusLabel(t, row.status)}
                  </StatusBadge>
                  {!row.awaitingMe && row.status === 'pending' && (
                    <span className="slip-turn">{t('market.swaps.awaitingThem')}</span>
                  )}
                </div>

                <div className="slip-actions">
                  {row.awaitingMe && (
                    <div className="actions">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy}
                        onClick={() => void act(row, 'approve')}
                      >
                        {t('market.swaps.approve')}
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(row, 'reject')}>
                        {t('market.swaps.reject')}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
