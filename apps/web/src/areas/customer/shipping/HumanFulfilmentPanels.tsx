import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { formatDate, formatUsd } from '../../../shared/money';
import type { PickupShow, WhiteGloveTerms } from '../../../shared/escrow';
import { Button, EmptyState, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconBox, IconCalendar, IconShield } from '../../../shared/ui/icons';

interface VaultItem {
  id: string;
  typeClass: string;
  description: string;
}

/**
 * Collecting at a show.
 *
 * The cheapest way out of the vault, for one reason worth saying on the screen:
 * the van was going anyway. It is not a discount, it is the absence of a
 * journey — which is also why it is capped per show and closes on the same
 * deadline the consignments use.
 */
export function ShowPickupPanel({
  items,
  onError,
  onStatus,
  onCreated,
}: {
  items: VaultItem[];
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
  onCreated: () => void;
}) {
  const { t, locale } = useI18n();
  const [shows, setShows] = useState<PickupShow[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<PickupShow[]>('/shipping/pickup/shows');
        setShows(list);
        const first = list.find((s) => s.open);
        if (first) setEventId(first.id);
      } catch (e) {
        onError((e as Error).message);
        setShows([]);
      }
    })();
  }, [onError]);

  const chosen = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);
  const show = (shows ?? []).find((s) => s.id === eventId);

  async function book() {
    setBusy(true);
    try {
      const created = await api.post<{ code?: string; id: string }>('/shipping/pickup', {
        itemIds: chosen,
        eventId,
        customerNotes: notes.trim() || undefined,
      });
      onStatus(t('ff.pickupBooked', { id: created.code ?? created.id, show: show?.name ?? '' }));
      onError(null);
      setSelected({});
      onCreated();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('ff.pickup.title')} subtitle={t('ff.pickup.subtitle')}>
      {shows === null ? (
        <p className="hint">{t('grp.loading')}</p>
      ) : shows.length === 0 ? (
        <EmptyState title={t('ff.pickup.noShows')} text={t('ff.pickup.noShowsText')} icon={<IconCalendar />} />
      ) : (
        <div className="stack stack--tight" style={{ maxWidth: 620 }}>
          <label className="field">
            <span className="field-label">{t('ff.pickup.which')}</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {shows.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.open}>
                  {s.name} — {formatDate(s.startsAt, locale)}
                  {s.open ? '' : ` (${t('ff.pickup.closed')})`}
                </option>
              ))}
            </select>
          </label>

          {show && (
            <p className="field-hint">
              {show.venue}
              {show.city ? `, ${show.city}` : ''} ·{' '}
              {t('ff.pickup.deadline', { date: formatDate(show.requestDeadline, locale) })} ·{' '}
              <strong>{formatUsd(show.feeMinor)}</strong>
              {show.remaining !== null && ` · ${t('ff.pickup.remaining', { count: show.remaining })}`}
            </p>
          )}

          {items.length === 0 ? (
            <EmptyState title={t('shipping.noItems')} text={t('shipping.noItemsText')} icon={<IconBox />} />
          ) : (
            <ul className="check-list">
              {items.map((item) => (
                <li key={item.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!selected[item.id]}
                      onChange={() => setSelected((p) => ({ ...p, [item.id]: !p[item.id] }))}
                    />
                    <span>
                      {item.typeClass} — {item.description}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <label className="field">
            <span className="field-label">{t('ship.notes')}</span>
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="row">
            <Button
              variant="gold"
              icon={<IconCalendar />}
              disabled={busy || chosen.length === 0 || !show?.open}
              onClick={() => void book()}
            >
              {t('ff.pickup.book')}
            </Button>
            <span className="field-hint">{t('ff.pickup.bringId')}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * Hand delivery.
 *
 * The screen makes the round trip obvious, because the round trip IS the
 * product: nothing here has a price, and the button says "ask for a quote"
 * rather than "book". A collector who expects to be charged on submit and is
 * not would think it had failed.
 */
export function WhiteGlovePanel({
  items,
  onError,
  onStatus,
  onCreated,
}: {
  items: VaultItem[];
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [terms, setTerms] = useState<WhiteGloveTerms | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupFrom, setPickupFrom] = useState('');
  const [pickupTo, setPickupTo] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliverFrom, setDeliverFrom] = useState('');
  const [deliverTo, setDeliverTo] = useState('');
  const [country, setCountry] = useState('US');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setTerms(await api.get<WhiteGloveTerms>('/shipping/white-glove/terms'));
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError]);

  const chosen = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);
  const ready =
    chosen.length > 0 &&
    pickupAddress.trim() !== '' &&
    deliveryAddress.trim() !== '' &&
    [pickupFrom, pickupTo, deliverFrom, deliverTo].every((v) => v !== '');

  async function request() {
    setBusy(true);
    try {
      const created = await api.post<{ code?: string; id: string }>('/shipping/white-glove', {
        itemIds: chosen,
        pickupAddress: pickupAddress.trim(),
        pickupFrom: new Date(pickupFrom).toISOString(),
        pickupTo: new Date(pickupTo).toISOString(),
        deliveryAddress: deliveryAddress.trim(),
        deliverFrom: new Date(deliverFrom).toISOString(),
        deliverTo: new Date(deliverTo).toISOString(),
        destinationCountry: country.trim().toUpperCase(),
        customerNotes: notes.trim() || undefined,
      });
      onStatus(
        t('ff.wg.requested', {
          id: created.code ?? created.id,
          hours: terms?.quoteWithinHours ?? 48,
        }),
      );
      onError(null);
      setSelected({});
      onCreated();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('ff.wg.title')} subtitle={t('ff.wg.subtitle')}>
      <div className="stack stack--tight" style={{ maxWidth: 620 }}>
        {terms && (
          <p className="drawer-note drawer-note--archive">
            <IconShield />
            <span>
              {t('ff.wg.terms', {
                domestic: formatUsd(terms.baseDomesticMinor),
                international: formatUsd(terms.baseInternationalMinor),
                hours: terms.quoteWithinHours,
              })}
            </span>
          </p>
        )}

        {items.length === 0 ? (
          <EmptyState title={t('shipping.noItems')} text={t('shipping.noItemsText')} icon={<IconBox />} />
        ) : (
          <ul className="check-list">
            {items.map((item) => (
              <li key={item.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!selected[item.id]}
                    onChange={() => setSelected((p) => ({ ...p, [item.id]: !p[item.id] }))}
                  />
                  <span>
                    {item.typeClass} — {item.description}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <label className="field">
          <span className="field-label">{t('ff.wg.pickupAddress')}</span>
          <input value={pickupAddress} maxLength={400} onChange={(e) => setPickupAddress(e.target.value)} />
          <span className="field-hint">{t('ff.wg.pickupHint')}</span>
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('ff.wg.pickupFrom')}</span>
            <input type="datetime-local" value={pickupFrom} onChange={(e) => setPickupFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('ff.wg.pickupTo')}</span>
            <input type="datetime-local" value={pickupTo} onChange={(e) => setPickupTo(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span className="field-label">{t('ff.wg.deliveryAddress')}</span>
          <input value={deliveryAddress} maxLength={400} onChange={(e) => setDeliveryAddress(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('ff.wg.deliverFrom')}</span>
            <input type="datetime-local" value={deliverFrom} onChange={(e) => setDeliverFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('ff.wg.deliverTo')}</span>
            <input type="datetime-local" value={deliverTo} onChange={(e) => setDeliverTo(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('ff.wg.country')}</span>
            <input value={country} dir="ltr" maxLength={2} style={{ width: '4rem' }} onChange={(e) => setCountry(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span className="field-label">{t('ship.notes')}</span>
          <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="row">
          {/* Deliberately "ask for a quote", not "book". Nothing is charged
              here, and a button that said otherwise would be lying. */}
          <Button variant="gold" disabled={busy || !ready} onClick={() => void request()}>
            {t('ff.wg.ask')}
          </Button>
          <span className="field-hint">{t('ff.wg.nothingCharged')}</span>
        </div>
      </div>
    </Panel>
  );
}

/**
 * The outstanding quotes, and accepting one.
 *
 * Separate from the request form because they happen days apart: a collector
 * asks on Monday and comes back on Wednesday to a figure. If the two lived on
 * one screen the second visit would be a form they had already filled in.
 */
export function WhiteGloveQuotes({
  reloadToken,
  onError,
  onStatus,
  onChanged,
}: {
  reloadToken: number;
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<
    { id: string; code: string | null; quoteMinor: number | null; quoteNotes: string | null; status: string; fulfilmentMethod: string }[]
  >([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const all = await api.get<typeof rows>('/shipping/shipments');
        setRows(all.filter((s) => s.fulfilmentMethod === 'hand_delivery' && s.status === 'requested'));
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError, reloadToken]);

  if (rows.length === 0) return null;

  return (
    <Panel title={t('ff.wg.quotesTitle')} subtitle={t('ff.wg.quotesSubtitle')}>
      <ul className="check-list" style={{ maxHeight: 'none' }}>
        {rows.map((r) => (
          <li key={r.id}>
            <span>
              <code dir="ltr">{r.code}</code>
              {r.quoteNotes && <span className="hint"> {r.quoteNotes}</span>}
            </span>
            <span className="row" style={{ gap: 'var(--sp-2)' }}>
              {r.quoteMinor === null ? (
                <StatusBadge tone="warning">{t('ff.wg.awaitingQuote')}</StatusBadge>
              ) : (
                <>
                  <strong dir="ltr">{formatUsd(r.quoteMinor)}</strong>
                  <Button
                    size="sm"
                    variant="gold"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void api
                        .post(`/shipping/white-glove/${r.id}/accept`)
                        .then(() => {
                          onStatus(t('ff.wg.accepted', { amount: formatUsd(r.quoteMinor!) }));
                          onError(null);
                          onChanged();
                        })
                        .catch((e: Error) => onError(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t('ff.wg.accept')}
                  </Button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
