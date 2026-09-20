import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { dollarsToCents, formatDate, formatUsd } from '../../../shared/money';
import { Amount, Code, Serial } from '../../../shared/ui/Serial';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { useI18n, type TranslateFn } from '../../../shared/i18n';
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
import { displayName } from '../../../shared/timeline';
import { itemClassLabel } from '../../../shared/itemClasses';

/* ============================================================
   My listings — reprice and delist
   ============================================================ */

/**
 * A seller's own listings.
 *
 * Repricing and delisting were both implemented server-side from the beginning
 * and reachable from nowhere. Delisting is two-step confirmed by the API
 * (`requestRemove` issues a challenge, `confirmRemove` consumes it) because it
 * is irreversible, and this panel runs both halves behind one confirmation
 * dialog rather than exposing the token to the user.
 */
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
  /**
   * Closed listings — removed or sold — are kept (they are a record) but folded
   * away: a delisted card stayed in this table for good, above the ones that
   * are actually for sale.
   */
  const [showClosed, setShowClosed] = useState(false);
  const closedCount = (rows ?? []).filter((r) => r.status !== 'active').length;
  const shown = (rows ?? []).filter((r) => showClosed || r.status === 'active');

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
      // Two steps, one intent: the API issues a challenge and consumes it, so a
      // delisting cannot happen from a single stray request.
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
          /* Listing a card is done from the Sell tab, which this did not say. */
          <EmptyState
            title={t('market.mine.empty')}
            text={t('market.mine.emptyText')}
            icon={<IconTag />}
            action={
              <Button
                size="sm"
                variant="gold"
                onClick={() => navigate({ section: 'marketplace', tab: 'sell' })}
              >
                {t('market.mine.listOne')}
              </Button>
            }
          />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <caption>{t('market.mine.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('market.mine.col.item')}</th>
                  <th scope="col">{t('market.mine.col.price')}</th>
                  <th scope="col">{t('market.mine.col.offers')}</th>
                  <th scope="col">{t('support.col.status')}</th>
                  <th scope="col">{t('market.mine.col.listed')}</th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('market.mine.col.item')} className="dt-primary">
                      {displayName(row.description) || itemClassLabel(t, row.typeClass)}
                      <span className="dt-sub" dir="ltr">
                        {row.serialNumber}
                      </span>
                    </td>
                    <td data-label={t('market.mine.col.price')} dir="ltr">
                      {editing === row.id ? (
                        <div className="money-input">
                          <span aria-hidden="true">$</span>
                          <input
                            inputMode="decimal"
                            value={price}
                            autoFocus
                            onChange={(e) => setPrice(e.target.value)}
                            style={{ inlineSize: '9rem' }}
                          />
                        </div>
                      ) : (
                        formatUsd(row.askingPrice)
                      )}
                    </td>
                    <td data-label={t('market.mine.col.offers')}>
                      {row.pendingOffers > 0 ? (
                        <StatusBadge tone="warning">{row.pendingOffers}</StatusBadge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td data-label={t('support.col.status')}>
                      <StatusBadge tone={LISTING_TONE[row.status] ?? 'neutral'}>
                        {listingStatusLabel(t, row.status)}
                      </StatusBadge>
                    </td>
                    <td data-label={t('market.mine.col.listed')} dir="ltr">
                      {formatDate(row.publishedAt, locale)}
                    </td>
                    <td className="td-tight">
                      {/* Only an ACTIVE listing can be repriced or delisted — the
                          API refuses either on a sold or removed one, so the
                          controls are simply absent rather than offered and
                          rejected. */}
                      {row.status === 'active' && (
                        <div className="actions">
                          {editing === row.id ? (
                            <>
                              <Button
                                size="sm"
                                variant="gold"
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {closedCount > 0 && (
              <div className="row" style={{ padding: 'var(--sp-3) 0' }}>
                <Button size="sm" variant="ghost" onClick={() => setShowClosed((v) => !v)}>
                  {showClosed
                    ? t('market.mine.hideClosed')
                    : t('market.mine.showClosed', { count: closedCount })}
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>

      {removing && (
        <ConfirmationModal
          title={t('market.mine.delistTitle')}
          body={
            <p>
              {t('market.mine.delistBody', {
                item: displayName(removing.description) || itemClassLabel(t, removing.typeClass),
              })}
            </p>
          }
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

/* ============================================================
   Offers — the panel that was entirely missing
   ============================================================ */

/**
 * Every offer the collector is party to, on both sides.
 *
 * WHOSE TURN IT IS decides what is offered, and that is not the same as which
 * side of the listing you are on. This panel used to branch on `direction`: a
 * buyer saw "awaiting seller" and no controls whatsoever, so a buyer who had
 * been sent a counter-offer had no way to accept it, counter it, or even take
 * their own offer off the table — a negotiation could be started but never
 * finished by the person being negotiated with.
 *
 * `yourTurn` comes from the API, which knows which side proposed the price
 * currently on the table. When it is your turn: accept, counter or decline.
 * When it is not: withdraw, which is a real action and was missing entirely.
 */
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
      // "Rejected" is the seller declining. When it is your OWN price you are
      // taking off the table, the same call is a withdrawal, and telling
      // somebody they rejected their own offer is a small nonsense.
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
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <caption>{t('market.offers.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('market.mine.col.item')}</th>
                <th scope="col">{t('market.offers.col.side')}</th>
                <th scope="col">{t('market.offers.col.offer')}</th>
                <th scope="col">{t('support.col.status')}</th>
                <th scope="col">{t('support.col.activity')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('market.mine.col.item')} className="dt-primary">
                    <span className="dt-cell">
                      {/* An offer is about an OBJECT, and the row showed none of
                          it — two lines of catalogue string and no photograph on
                          the one screen where somebody is deciding what a thing
                          is worth. */}
                      <span className="dt-thumb">
                        <CardPhotoThumb serialNumber={row.serialNumber} title={row.description} />
                      </span>
                      <span>
                        <Serial value={row.serialNumber} />
                        <span className="dt-sub">{displayName(row.description) || itemClassLabel(t, row.typeClass)}</span>
                      </span>
                    </span>
                  </td>
                  <td data-label={t('market.offers.col.side')}>
                    {/* The side of the listing is not the same as who named the
                        price on the table. A seller's own counter read "You
                        received", which is the one thing it was not. */}
                    <StatusBadge tone={row.direction === 'incoming' ? 'gold' : 'info'} plain>
                      {t(
                        row.status === 'pending' && row.direction === 'incoming' && !row.yourTurn
                          ? 'market.offers.youCountered'
                          : row.status === 'pending' && row.direction === 'outgoing' && row.yourTurn
                            ? 'market.offers.theyCountered'
                            : row.direction === 'incoming'
                              ? 'market.offers.incoming'
                              : 'market.offers.outgoing',
                      )}
                    </StatusBadge>
                    {row.direction === 'incoming' && row.buyerUsername && (
                      <span className="dt-sub">
                        <Code value={`@${row.buyerUsername}`} />
                      </span>
                    )}
                    {/* A pending offer is either waiting on you or waiting on
                        them, and which one it is decides whether you need to do
                        anything today. The table said neither. */}
                    {row.status === 'pending' && row.listingStatus === 'active' && (
                      <span className="dt-sub">
                        {t(row.yourTurn ? 'market.offers.turnYours' : 'market.offers.turnTheirs')}
                      </span>
                    )}
                  </td>
                  {/*
                    The two figures a person is comparing, adjacent and aligned:
                    what was offered, and what is being asked. They used to be
                    380px apart in different columns, one of them 12px grey.
                  */}
                  <td data-label={t('market.offers.col.offer')} className="num">
                    <Amount size="lead">{formatUsd(row.amount)}</Amount>
                    <span className="dt-sub">
                      {t('market.offers.asking', { amount: formatUsd(row.askingPrice) })}
                    </span>
                  </td>
                  <td data-label={t('support.col.status')}>
                    <StatusBadge tone={OFFER_TONE[row.status] ?? 'neutral'}>
                      {offerStatusLabel(t, row.status)}
                    </StatusBadge>
                  </td>
                  <td data-label={t('support.col.activity')} className="td-tight">
                    <span className="date">{formatDate(row.createdAt, locale)}</span>
                  </td>
                  <td className="td-tight">
                    {/* Only a PENDING offer on a still-active listing can be
                        responded to, and only by the side it is waiting on. */}
                    {row.status === 'pending' && row.listingStatus === 'active' && (
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                style={{ inlineSize: '9rem' }}
              />
            </div>
          </label>
        </div>
        <div className="actions">
          <Button
            size="sm"
            variant="gold"
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

  /**
   * Waiting on the other side. The one thing you can still do is take the price
   * back off the table — for a buyer that is withdrawing an offer, for a seller
   * withdrawing a counter. Both are the same call; only the wording differs,
   * because "reject my own offer" is not a sentence anybody would write.
   */
  if (!offer.yourTurn) {
    return (
      <div className="actions">
        <span className="hint">
          {t(offer.side === 'buyer' ? 'market.offers.awaitingSeller' : 'market.offers.awaitingBuyer')}
        </span>
        {/*
          Changing your mind about your own price is one action, not three.
          Only one open offer per buyer per listing is allowed, so raising a bid
          used to mean withdrawing, going back to Browse, finding the listing
          again and offering afresh. A counter on your own offer replaces it in
          place, which is the same call the other side makes and needs no new
          endpoint.
        */}
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCounterStart}>
          {t('market.offers.change')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRespond('reject')}>
          {t('market.offers.withdraw')}
        </Button>
      </div>
    );
  }

  /*
    It is your turn. Accept, counter, decline — in that order of weight, in a
    row rather than a vertical stack of three differently-shaped buttons in a
    90px column.

    When it is NOT your turn the Accept control is not rendered at all (see
    above): a party may not accept a price they proposed, and the way to say
    that is for the action not to exist, not for it to be greyed out.
  */
  return (
    <div className="actions actions--row">
      <Button size="sm" variant="gold" disabled={busy} onClick={() => onRespond('accept')}>
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

/* ============================================================
   Swaps and gift transfers
   ============================================================ */

/**
 * Proposals in both directions.
 *
 * The whole dual-approval engine existed and was unreachable: propose, approve,
 * reject, atomic mutual ownership transfer, billing to both sides, an
 * irreversible transaction row, and a notification to each participant. What was
 * missing was a list and two buttons.
 */
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
      await onChanged(
        t(
          action === 'approve'
            ? 'market.swaps.approved'
            : swap.direction === 'outgoing'
              ? 'market.swaps.withdrawn'
              : 'market.swaps.rejected',
        ),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const names = (items: MySwap['offeredItems']) =>
    items
      .map((i) =>
        [i.serialNumber, displayName(i.description) || (i.typeClass ? itemClassLabel(t, i.typeClass) : i.id)]
          .filter(Boolean)
          .join(' — '),
      )
      .join(', ') || '—';

  return (
    <Panel title={t('market.swaps.title')} subtitle={t('market.swaps.subtitle')} flush>
      {rows === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('market.swaps.empty')} text={t('market.swaps.emptyText')} icon={<IconMarketplace />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <caption>{t('market.swaps.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('market.swaps.col.kind')}</th>
                <th scope="col">{t('market.swaps.col.with')}</th>
                <th scope="col">{t('market.swaps.col.theyGet')}</th>
                <th scope="col">{t('market.swaps.col.youGet')}</th>
                <th scope="col">{t('support.col.status')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const incoming = row.direction === 'incoming';
                // "They get" / "you get" is written from the READER's side, so
                // the two columns swap depending on who proposed.
                const theyGet = incoming ? row.requestedItems : row.offeredItems;
                const youGet = incoming ? row.offeredItems : row.requestedItems;
                return (
                  <tr key={row.id}>
                    <td data-label={t('market.swaps.col.kind')} className="dt-primary">
                      {t(row.kind === 'transfer' ? 'market.swaps.gift' : 'market.swaps.swap')}
                      <span className="dt-sub" dir="ltr">
                        {formatDate(row.createdAt, locale)}
                      </span>
                    </td>
                    <td data-label={t('market.swaps.col.with')} dir="ltr">
                      <code>{(incoming ? row.proposerUsername : row.responderUsername) ?? '—'}</code>
                    </td>
                    <td data-label={t('market.swaps.col.theyGet')}>{names(theyGet)}</td>
                    <td data-label={t('market.swaps.col.youGet')}>
                      {row.kind === 'transfer' && incoming ? names(row.offeredItems) : names(youGet)}
                    </td>
                    <td data-label={t('support.col.status')}>
                      <StatusBadge tone={SWAP_TONE[row.status] ?? 'neutral'}>
                        {swapStatusLabel(t, row.status)}
                      </StatusBadge>
                    </td>
                    <td className="td-tight">
                      {row.awaitingMe ? (
                        <div className="actions">
                          <Button size="sm" variant="gold" disabled={busy} onClick={() => void act(row, 'approve')}>
                            {t('market.swaps.approve')}
                          </Button>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(row, 'reject')}>
                            {t('market.swaps.reject')}
                          </Button>
                        </div>
                      ) : row.status === 'pending' ? (
                        <div className="actions">
                          <span className="hint">{t('market.swaps.awaitingThem')}</span>
                          {/* Your own proposal can be taken back while it waits. */}
                          {!incoming && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(row, 'reject')}>
                              {t('market.swaps.withdraw')}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
