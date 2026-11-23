import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIST_TOOLS_FROM, ListTools, byNewest, byNumber, useListView, type SortOption } from './ListTools';
import { api } from '../../../shared/api';
import { dollarsToCents, formatDate, formatUsd, isolate } from '../../../shared/money';
import { Amount, Code, Serial } from '../../../shared/ui/Serial';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
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
import { Button, EmptyState, ErrorState, Field, MoneyField, Panel, SkeletonTable, StatusBadge } from '../../../shared/ui/primitives';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { IconMarketplace, IconTag } from '../../../shared/ui/icons';
import { navigate } from '../../../shared/routing';
import { SwapGlyph, TradeSide } from './TradeSides';
import { SellerLink } from './ListingDeal';

export function MyListingsPanel({
  onChanged,
}: {
  onChanged: (message: string) => Promise<void> | void;
  onError?: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MyListing[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [removing, setRemoving] = useState<MyListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const view = useListView(rows, listingText(t), LISTING_SORTS);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<MyListing[]>('/marketplace/listings/mine'));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reprice(listing: MyListing) {
    const cents = dollarsToCents(price);
    if (cents === null) {
      setRowError(t('market.sell.priceBad'));
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      await api.patch(`/marketplace/listings/${listing.id}`, { askingPrice: cents });
      setEditing(null);
      await load();
      await onChanged(t('market.mine.repriced', { amount: formatUsd(cents) }));
    } catch (e) {
      setRowError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(listing: MyListing) {
    setBusy(true);
    setRemoveError(null);
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
      setRemoveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title={t('market.mine.title')} subtitle={t('market.mine.subtitle')} flush>
        {loadError ? (
          <ErrorState
            title={t('market.loadFailed')}
            message={loadError}
            onRetry={() => {
              setRows(null);
              void load();
            }}
            retryLabel={t('ui.retry')}
          />
        ) : rows === null ? (
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
          <>
          {rows.length > LIST_TOOLS_FROM && (
            <ListTools label={t('market.mine.title')} view={view} sorts={LISTING_SORTS} total={rows.length} />
          )}
          {view.shown?.length === 0 && <EmptyState title={t('market.list.noMatch')} text={t('market.list.noMatchText')} />}
          <ul className="slips" aria-label={t('market.mine.title')}>
            {(view.shown ?? []).map((row) => (
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
                    <form
                      id={`reprice-${row.id}`}
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        void reprice(row);
                      }}
                    >
                      <div className="money-input">
                        <span aria-hidden="true">$</span>
                        <input
                          inputMode="decimal"
                          dir="ltr"
                          aria-label={t('market.mine.newPrice')}
                          aria-invalid={rowError ? true : undefined}
                          aria-describedby={rowError ? `reprice-${row.id}-error` : undefined}
                          value={price}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setEditing(null);
                              setRowError(null);
                            }
                          }}
                          onChange={(e) => setPrice(e.target.value)}
                        />
                      </div>
                      {rowError && (
                        <span className="field-error" id={`reprice-${row.id}-error`} role="alert">
                          <bdi dir="auto">{rowError}</bdi>
                        </span>
                      )}
                    </form>
                  ) : (
                    <Amount size="lead">{formatUsd(row.askingPrice)}</Amount>
                  )}
                  <span className="slip-asking">
                    {t('market.mine.col.listed')} {formatDate(row.publishedAt, locale)}
                  </span>
                </div>

                <div className="slip-side">
                  <span className="slip-label">{t('market.mine.col.offers')}</span>
                  {row.pendingOffers > 0 && row.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('market.mine.seeOffers', { count: row.pendingOffers })}
                      onClick={() => navigate({ section: 'marketplace', tab: 'offers' })}
                    >
                      <StatusBadge tone="warning">{row.pendingOffers}</StatusBadge>
                    </Button>
                  ) : row.pendingOffers > 0 ? (
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
                          <Button size="sm" variant="primary" type="submit" form={`reprice-${row.id}`} disabled={busy}>
                            {t('market.mine.save')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(null);
                              setRowError(null);
                            }}
                          >
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
                              setRowError(null);
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
          </>
        )}
      </Panel>

      {removing && (
        <ConfirmationModal
          title={t('market.mine.delistTitle')}
          body={
            <>
              <p>{t('market.mine.delistBody', { item: isolate(itemName(t, removing)) })}</p>
              {removing.pendingOffers > 0 && (
                <p className="field-hint">{t('market.mine.delistOffers', { count: removing.pendingOffers })}</p>
              )}
              {removeError && <ErrorState message={removeError} />}
            </>
          }
          confirmLabel={t('market.mine.delist')}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          busy={busy}
          onConfirm={() => void remove(removing)}
          onCancel={() => {
            setRemoving(null);
            setRemoveError(null);
          }}
        />
      )}
    </>
  );
}

export function OffersPanel({
  onChanged,
}: {
  onChanged: (message: string) => Promise<void> | void;
  onError?: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MyOffer[] | null>(null);
  const [countering, setCountering] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<{ offer: MyOffer; action: 'accept' | 'reject' } | null>(null);
  const [direction, setDirection] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const scoped = useMemo(
    () => (rows && direction !== 'all' ? rows.filter((r) => r.direction === direction) : rows),
    [rows, direction],
  );
  const view = useListView(scoped, offerText(t), OFFER_SORTS);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<MyOffer[]>('/marketplace/offers/mine'));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(offer: MyOffer, action: 'accept' | 'reject' | 'counter') {
    const body: Record<string, unknown> = { action };
    if (action === 'counter') {
      const cents = dollarsToCents(amount);
      if (cents === null) {
        setRowError({ id: offer.id, message: t('market.offers.amountBad') });
        return;
      }
      body.amount = cents;
    }
    setBusy(true);
    setRowError(null);
    try {
      await api.post(`/marketplace/offers/${offer.id}/respond`, body);
      setCountering(null);
      setConfirming(null);
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
          { amount: formatUsd(typeof body.amount === 'number' ? body.amount : offer.amount) },
        ),
      );
    } catch (e) {
      setConfirming(null);
      setRowError({ id: offer.id, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Panel title={t('market.offers.title')} subtitle={t('market.offers.subtitle')} flush>
      {loadError ? (
        <ErrorState
          title={t('market.loadFailed')}
          message={loadError}
          onRetry={() => {
            setRows(null);
            void load();
          }}
          retryLabel={t('ui.retry')}
        />
      ) : rows === null ? (
        <SkeletonTable rows={3} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('market.offers.empty')}
          text={t('market.offers.emptyText')}
          action={
            <Button size="sm" variant="primary" onClick={() => navigate({ section: 'marketplace', tab: 'browse' })}>
              {t('market.offers.browse')}
            </Button>
          }
        />
      ) : (
        <>
        <ListTools label={t('market.offers.title')} view={view} sorts={OFFER_SORTS} total={scoped?.length ?? 0}>
          <Field label={t('market.offers.show')} className="field--compact">
            <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="all">{t('market.offers.showAll')}</option>
              <option value="incoming">{t('market.offers.incoming')}</option>
              <option value="outgoing">{t('market.offers.outgoing')}</option>
            </select>
          </Field>
        </ListTools>
        {view.shown?.length === 0 && <EmptyState title={t('market.list.noMatch')} text={t('market.list.noMatchText')} />}
        <ul className="slips" aria-label={t('market.offers.title')}>
          {(view.shown ?? []).map((row) => {
            const live = isLive(row);
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
                      {t('market.offers.from')} <Code value={`@${row.buyerUsername}`} />
                    </span>
                  )}
                  {row.direction === 'outgoing' && row.sellerUsername && (
                    <span className="slip-turn">
                      {t('market.offers.to')} <SellerLink t={t} username={row.sellerUsername} />
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
                      error={rowError?.id === row.id ? rowError.message : null}
                      t={t}
                      onCounterStart={() => {
                        setCountering(row.id);
                        setRowError(null);
                        setAmount((row.amount / 100).toFixed(2));
                      }}
                      onCounterCancel={() => {
                        setCountering(null);
                        setRowError(null);
                      }}
                      onAmount={setAmount}
                      onRespond={(action) =>
                        action === 'counter' ? void respond(row, action) : setConfirming({ offer: row, action })
                      }
                    />
                  )}
                  {!live && rowError?.id === row.id && <ErrorState message={rowError.message} />}
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </Panel>

    {confirming && (
      <ConfirmationModal
        title={t(confirmTitle(confirming.offer, confirming.action))}
        body={
          <p>
            {t(confirmBody(confirming.offer, confirming.action), {
              item: isolate(itemName(t, confirming.offer).split(' · ')[0]!),
              amount: formatUsd(confirming.offer.amount),
              username:
                (confirming.offer.side === 'seller' ? confirming.offer.buyerUsername : confirming.offer.sellerUsername) ??
                '',
            })}
          </p>
        }
        confirmLabel={t(confirmLabel(confirming.offer, confirming.action))}
        cancelLabel={t('ui.cancel')}
        tone={confirming.action === 'reject' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => void respond(confirming.offer, confirming.action)}
        onCancel={() => setConfirming(null)}
      />
    )}
    </>
  );
}

function confirmTitle(offer: MyOffer, action: 'accept' | 'reject'): MessageKey {
  if (action === 'accept') return offer.side === 'seller' ? 'market.offers.sellTitle' : 'market.offers.buyTitle';
  return offer.yourTurn ? 'market.offers.rejectTitle' : 'market.offers.withdrawTitle';
}

function confirmBody(offer: MyOffer, action: 'accept' | 'reject'): MessageKey {
  if (action === 'accept') return offer.side === 'seller' ? 'market.offers.sellBody' : 'market.offers.buyBody';
  return offer.yourTurn ? 'market.offers.rejectBody' : 'market.offers.withdrawBody';
}

function confirmLabel(offer: MyOffer, action: 'accept' | 'reject'): MessageKey {
  if (action === 'accept') return 'market.offers.accept';
  if (!offer.yourTurn) return 'market.offers.withdraw';
  return offer.side === 'seller' ? 'market.offers.reject' : 'market.offers.decline';
}

function OfferActions({
  offer,
  countering,
  amount,
  busy,
  error,
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
  error: string | null;
  t: TranslateFn;
  onCounterStart: () => void;
  onCounterCancel: () => void;
  onAmount: (v: string) => void;
  onRespond: (action: 'accept' | 'reject' | 'counter') => void;
}) {
  const failure = error ? <ErrorState message={error} /> : null;
  if (countering) {
    return (
      <form
        className="fulfill-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onRespond('counter');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCounterCancel();
          }
        }}
      >
        <div className="field-row">
          <MoneyField
            label={t(offer.yourTurn ? 'market.offers.counterAmount' : 'market.offers.newAmount')}
            value={amount}
            autoFocus
            onChange={onAmount}
            error={error ?? undefined}
            hint={t('market.offers.asking', { amount: formatUsd(offer.askingPrice) })}
          />
        </div>
        <div className="actions">
          <Button size="sm" variant="primary" type="submit" disabled={busy}>
            {t(offer.yourTurn ? 'market.offers.counter' : 'market.offers.change')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCounterCancel}>
            {t('ui.cancel')}
          </Button>
        </div>
      </form>
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
        {failure}
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
      {failure}
    </div>
  );
}

export function SwapsPanel({
  onChanged,
}: {
  onChanged: (message: string) => Promise<void> | void;
  onError?: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MySwap[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ swap: MySwap; action: 'approve' | 'reject' } | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const view = useListView(rows, swapText(t), SWAP_SORTS);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<MySwap[]>('/marketplace/swaps'));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(swap: MySwap, action: 'approve' | 'reject') {
    setBusy(true);
    setActError(null);
    try {
      await api.post(`/marketplace/swaps/${swap.id}/${action}`);
      setConfirming(null);
      await load();
      await onChanged(
        t(
          action === 'reject'
            ? 'market.swaps.rejected'
            : swap.kind === 'transfer'
              ? 'market.swaps.giftAccepted'
              : 'market.swaps.approvedDone',
        ),
      );
    } catch (e) {
      setActError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Panel title={t('market.swaps.title')} subtitle={t('market.swaps.subtitle')} flush>
      {loadError ? (
        <ErrorState
          title={t('market.loadFailed')}
          message={loadError}
          onRetry={() => {
            setRows(null);
            void load();
          }}
          retryLabel={t('ui.retry')}
        />
      ) : rows === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('market.swaps.empty')} text={t('market.swaps.emptyText')} icon={<IconMarketplace />} />
      ) : (
        <>
        {rows.length > LIST_TOOLS_FROM && (
          <ListTools label={t('market.swaps.title')} view={view} sorts={SWAP_SORTS} total={rows.length} />
        )}
        {view.shown?.length === 0 && <EmptyState title={t('market.list.noMatch')} text={t('market.list.noMatchText')} />}
        <ul className="slips" aria-label={t('market.swaps.title')}>
          {(view.shown ?? []).map((row) => {
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
                        onClick={() => {
                          setActError(null);
                          setConfirming({ swap: row, action: 'approve' });
                        }}
                      >
                        {t(gift ? 'market.swaps.acceptGift' : 'market.swaps.approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => {
                          setActError(null);
                          setConfirming({ swap: row, action: 'reject' });
                        }}
                      >
                        {t('market.swaps.reject')}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </Panel>

    {confirming && (
      <ConfirmationModal
        title={t(
          confirming.action === 'reject'
            ? 'market.swaps.rejectTitle'
            : confirming.swap.kind === 'transfer'
              ? 'market.swaps.acceptGiftTitle'
              : 'market.swaps.approveTitle',
        )}
        body={
          <>
            <p>
              {t(
                confirming.action === 'reject'
                  ? 'market.swaps.rejectBody'
                  : confirming.swap.kind === 'transfer'
                    ? 'market.swaps.acceptGiftBody'
                    : 'market.swaps.approveBody',
                {
                  username:
                    (confirming.swap.direction === 'incoming'
                      ? confirming.swap.proposerUsername
                      : confirming.swap.responderUsername) ?? '',
                },
              )}
            </p>
            {actError && <ErrorState message={actError} />}
          </>
        }
        confirmLabel={t(
          confirming.action === 'reject'
            ? 'market.swaps.reject'
            : confirming.swap.kind === 'transfer'
              ? 'market.swaps.acceptGift'
              : 'market.swaps.approve',
        )}
        cancelLabel={t('ui.cancel')}
        tone={confirming.action === 'reject' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() => void act(confirming.swap, confirming.action)}
        onCancel={() => setConfirming(null)}
      />
    )}
    </>
  );
}

const LISTING_SORTS: readonly SortOption<MyListing>[] = [
  { key: 'newest', label: 'market.sort.newest', compare: byNewest((r) => r.publishedAt) },
  { key: 'price_desc', label: 'market.sort.priceDesc', compare: byNumber((r) => r.askingPrice, -1) },
  { key: 'price_asc', label: 'market.sort.priceAsc', compare: byNumber((r) => r.askingPrice, 1) },
  { key: 'offers', label: 'market.sort.mostOffers', compare: byNumber((r) => r.pendingOffers, -1) },
];

function listingText(t: TranslateFn) {
  return (r: MyListing) => `${r.serialNumber} ${itemName(t, r)} ${listingStatusLabel(t, r.status)}`;
}

const OFFER_SORTS: readonly SortOption<MyOffer>[] = [
  { key: 'newest', label: 'market.sort.newest', compare: byNewest((r) => r.createdAt) },
  {
    key: 'yours',
    label: 'market.sort.yourMove',
    compare: (a, b) => Number(isLive(b) && b.yourTurn) - Number(isLive(a) && a.yourTurn),
  },
  { key: 'amount_desc', label: 'market.sort.amountDesc', compare: byNumber((r) => r.amount, -1) },
];

function isLive(row: MyOffer) {
  return row.status === 'pending' && row.listingStatus === 'active';
}

function offerText(t: TranslateFn) {
  return (r: MyOffer) =>
    `${r.serialNumber} ${itemName(t, r)} ${r.buyerUsername ?? ''} ${r.sellerUsername ?? ''} ${offerStatusLabel(t, r.status)}`;
}

const SWAP_SORTS: readonly SortOption<MySwap>[] = [
  { key: 'newest', label: 'market.sort.newest', compare: byNewest((r) => r.createdAt) },
  { key: 'yours', label: 'market.sort.yourMove', compare: (a, b) => Number(b.awaitingMe) - Number(a.awaitingMe) },
];

function swapText(t: TranslateFn) {
  return (r: MySwap) =>
    [
      r.proposerUsername,
      r.responderUsername,
      swapStatusLabel(t, r.status),
      ...[...r.offeredItems, ...r.requestedItems].map((i) => `${i.serialNumber ?? ''} ${i.description}`),
    ].join(' ');
}
