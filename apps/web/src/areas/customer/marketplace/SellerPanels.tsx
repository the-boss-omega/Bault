import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { dollarsToCents, formatDate, formatUsd } from '../../../shared/money';
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
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
} from '../../../shared/ui/primitives';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { IconMarketplace, IconTag } from '../../../shared/ui/icons';

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
          <EmptyState title={t('market.mine.empty')} text={t('market.mine.emptyText')} icon={<IconTag />} />
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
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('market.mine.col.item')} className="dt-primary">
                      {row.description || row.typeClass}
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
                            style={{ width: '6rem' }}
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
          </div>
        )}
      </Panel>

      {removing && (
        <ConfirmationModal
          title={t('market.mine.delistTitle')}
          body={<p>{t('market.mine.delistBody', { item: removing.description || removing.typeClass })}</p>}
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
 * `direction` comes from the API rather than being inferred by comparing ids,
 * and it decides everything: a seller may accept, reject or counter; a buyer can
 * only watch their own offer, or counter a counter that came back to them.
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
      await onChanged(
        t(
          action === 'accept'
            ? 'market.offers.accepted'
            : action === 'reject'
              ? 'market.offers.rejected'
              : 'market.offers.countered',
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
        <EmptyState
          title={t('market.offers.empty')}
          text={t('market.offers.emptyText')}
          icon={<IconMarketplace />}
        />
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
                    {row.description || row.typeClass}
                    <span className="dt-sub" dir="ltr">
                      {t('market.offers.asking', { amount: formatUsd(row.askingPrice) })}
                    </span>
                  </td>
                  <td data-label={t('market.offers.col.side')}>
                    <StatusBadge tone={row.direction === 'incoming' ? 'gold' : 'info'} plain>
                      {t(row.direction === 'incoming' ? 'market.offers.incoming' : 'market.offers.outgoing')}
                    </StatusBadge>
                    {row.direction === 'incoming' && row.buyerUsername && (
                      <span className="dt-sub" dir="ltr">
                        <code>{row.buyerUsername}</code>
                      </span>
                    )}
                  </td>
                  <td data-label={t('market.offers.col.offer')} dir="ltr">
                    {formatUsd(row.amount)}
                  </td>
                  <td data-label={t('support.col.status')}>
                    <StatusBadge tone={OFFER_TONE[row.status] ?? 'neutral'}>
                      {offerStatusLabel(t, row.status)}
                    </StatusBadge>
                  </td>
                  <td data-label={t('support.col.activity')} dir="ltr">
                    {formatDate(row.createdAt, locale)}
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
                style={{ width: '6rem' }}
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
            {t('market.offers.counter')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCounterCancel}>
            {t('ui.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  // A buyer waiting on their own offer has nothing to do but wait.
  if (offer.direction === 'outgoing') {
    return <span className="hint">{t('market.offers.awaitingSeller')}</span>;
  }

  return (
    <div className="actions">
      <Button size="sm" variant="gold" disabled={busy} onClick={() => onRespond('accept')}>
        {t('market.offers.accept')}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onCounterStart}>
        {t('market.offers.counter')}
      </Button>
      <Button size="sm" variant="danger" disabled={busy} onClick={() => onRespond('reject')}>
        {t('market.offers.reject')}
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
      await onChanged(t(action === 'approve' ? 'market.swaps.approved' : 'market.swaps.rejected'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const names = (items: MySwap['offeredItems']) =>
    items.map((i) => i.description || i.typeClass || i.id).join(', ') || '—';

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
                        <span className="hint">{t('market.swaps.awaitingThem')}</span>
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
