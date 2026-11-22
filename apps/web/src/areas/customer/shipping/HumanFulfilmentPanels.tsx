import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { formatDate, formatUsd } from '../../../shared/money';
import type { PickupShow, WhiteGloveTerms } from '../../../shared/escrow';
import type { ShipmentSummary } from '../../../shared/shipments';
import type { InboundAddress } from '../../../shared/parcels';
import { Button, EmptyState, Field, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconCalendar, IconShield } from '../../../shared/ui/icons';
import { countryName, useShippingCountries, type ShippingCountry } from '../../../shared/countries';
import type { Address } from '../profile/AddressFields';
import { CardPicker, useClaimedItems, type PickableItem } from './CardPicker';

type VaultItem = PickableItem;

function usePicked(items: readonly VaultItem[], claimed: ReadonlyMap<string, string>) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setPicked(new Set()), []);
  const chosen = items.filter((i) => picked.has(i.id) && !claimed.has(i.id)).map((i) => i.id);
  return { picked, toggle, clear, chosen };
}

export function ShowPickupPanel({
  items,
  reloadToken = 0,
  onError,
  onStatus,
  onCreated,
}: {
  items: VaultItem[];
  reloadToken?: number;
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
  onCreated: () => void;
}) {
  const { t, locale } = useI18n();
  const [shows, setShows] = useState<PickupShow[] | null>(null);
  const [eventId, setEventId] = useState('');
  const claimed = useClaimedItems(reloadToken);
  const { picked, toggle, clear, chosen } = usePicked(items, claimed);
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
      clear();
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

          <CardPicker
            items={items}
            selected={picked}
            onToggle={toggle}
            claimed={claimed}
            legend={t('shipping.selectItems')}
          />

          <label className="field">
            <span className="field-label">{t('ship.notes')}</span>
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="row">
            <Button
              variant="primary"
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

const OTHER = 'other';

export function addressText(a: Address, countries: readonly ShippingCountry[]): string {
  const town = [a.city, a.region].filter(Boolean).join(', ');
  return `${a.recipient}, ${a.line1}, ${town} ${a.postalCode}, ${countryName(a.country, countries)}`.replace(/\s+/g, ' ');
}

function vaultText(v: InboundAddress): string {
  return [v.name, ...v.lines, `${[v.city, v.region].filter(Boolean).join(', ')} ${v.postalCode}`, v.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

export function windowIso(date: string, from: string, to: string): { from: string; to: string } | null {
  if (!date || !from || !to) return null;
  const start = new Date(`${date}T${from}`);
  const end = new Date(`${date}T${to}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}

function TimeWindow({
  legend,
  date,
  from,
  to,
  onChange,
  error,
}: {
  legend: string;
  date: string;
  from: string;
  to: string;
  onChange: (next: { date?: string; from?: string; to?: string }) => void;
  error?: string | null;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="time-window">
      <legend className="field-label">{legend}</legend>
      <div className="field-row">
        <Field label={t('ff.wg.date')}>
          <input type="date" value={date} onChange={(e) => onChange({ date: e.target.value })} />
        </Field>
        <Field label={t('ff.wg.between')}>
          <input type="time" value={from} onChange={(e) => onChange({ from: e.target.value })} />
        </Field>
        <Field label={t('ff.wg.and')}>
          <input type="time" value={to} onChange={(e) => onChange({ to: e.target.value })} />
        </Field>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function WhiteGlovePanel({
  items,
  reloadToken = 0,
  onError,
  onStatus,
  onCreated,
}: {
  items: VaultItem[];
  reloadToken?: number;
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const claimed = useClaimedItems(reloadToken);
  const { picked, toggle, clear, chosen } = usePicked(items, claimed);
  const [terms, setTerms] = useState<WhiteGloveTerms | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [vaults, setVaults] = useState<InboundAddress[]>([]);
  const [from, setFrom] = useState('');
  const [fromText, setFromText] = useState('');
  const [to, setTo] = useState('');
  const [toText, setToText] = useState('');
  const [toCountry, setToCountry] = useState('US');
  const [pickup, setPickup] = useState({ date: '', from: '09:00', to: '17:00' });
  const [delivery, setDelivery] = useState({ date: '', from: '09:00', to: '17:00' });
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setTerms(await api.get<WhiteGloveTerms>('/shipping/white-glove/terms'));
      } catch (e) {
        onError((e as Error).message);
      }
    })();
    void api
      .get<Address[]>('/me/addresses')
      .then((list) => {
        const rows = Array.isArray(list) ? list : [];
        setAddresses(rows);
        const preferred = rows.find((a) => a.isDefault) ?? rows[0];
        setTo(preferred ? preferred.id : OTHER);
      })
      .catch(() => setTo(OTHER));
    void api
      .get<InboundAddress[]>('/me/inbound-addresses')
      .then((list) => {
        const rows = Array.isArray(list) ? list.filter((v) => v.role === 'primary') : [];
        setVaults(rows);
        setFrom((cur) => cur || (rows[0] ? `vault:${rows[0].code}` : OTHER));
      })
      .catch(() => setFrom((cur) => cur || OTHER));
  }, [onError]);

  const vault = vaults.find((v) => `vault:${v.code}` === from);
  const fromAddress = addresses.find((a) => a.id === from);
  const toAddress = addresses.find((a) => a.id === to);
  const pickupAddress = vault ? vaultText(vault) : fromAddress ? addressText(fromAddress, countries) : fromText.trim();
  const deliveryAddress = toAddress ? addressText(toAddress, countries) : toText.trim();
  const destinationCountry = toAddress ? toAddress.country : toCountry;
  const pickupWindow = windowIso(pickup.date, pickup.from, pickup.to);
  const deliveryWindow = windowIso(delivery.date, delivery.from, delivery.to);

  const pickupError = !pickupWindow
    ? t('ff.wg.windowNeeded')
    : pickupWindow.to <= pickupWindow.from
      ? t('ff.wg.windowOrder')
      : null;
  const deliveryError = !deliveryWindow
    ? t('ff.wg.windowNeeded')
    : deliveryWindow.to <= deliveryWindow.from
      ? t('ff.wg.windowOrder')
      : pickupWindow && deliveryWindow.from < pickupWindow.from
        ? t('ff.wg.deliverAfterPickup')
        : null;
  const ready =
    chosen.length > 0 && pickupAddress !== '' && deliveryAddress !== '' && !pickupError && !deliveryError;

  async function request() {
    setTried(true);
    if (!ready || !pickupWindow || !deliveryWindow) return;
    setBusy(true);
    try {
      const created = await api.post<{ code?: string; id: string }>('/shipping/white-glove', {
        itemIds: chosen,
        pickupAddress,
        pickupFrom: pickupWindow.from,
        pickupTo: pickupWindow.to,
        deliveryAddress,
        deliverFrom: deliveryWindow.from,
        deliverTo: deliveryWindow.to,
        destinationCountry: destinationCountry.trim().toUpperCase(),
        recipientName: toAddress?.recipient,
        customerNotes: notes.trim() || undefined,
      });
      onStatus(
        t('ff.wg.requested', {
          id: created.code ?? created.id,
          hours: terms?.quoteWithinHours ?? 48,
        }),
      );
      onError(null);
      clear();
      setTried(false);
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

        <CardPicker
          items={items}
          selected={picked}
          onToggle={toggle}
          claimed={claimed}
          legend={t('shipping.selectItems')}
        />

        <Field label={t('ff.wg.pickupAddress')} hint={t('ff.wg.pickupHint')}>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {vaults.map((v) => (
              <option key={v.code} value={`vault:${v.code}`}>
                {t('ff.wg.fromVault', { name: v.name, city: v.city })}
              </option>
            ))}
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}: {a.city}, {countryName(a.country, countries)}
              </option>
            ))}
            <option value={OTHER}>{t('ff.wg.otherAddress')}</option>
          </select>
        </Field>
        {from === OTHER && (
          <Field
            label={t('ff.wg.otherPickup')}
            error={tried && !fromText.trim() ? t('ff.wg.addressNeeded') : undefined}
          >
            <input value={fromText} maxLength={400} dir="auto" onChange={(e) => setFromText(e.target.value)} />
          </Field>
        )}
        <TimeWindow
          legend={t('ff.wg.pickupWindow')}
          {...pickup}
          onChange={(next) => setPickup((p) => ({ ...p, ...next }))}
          error={tried ? pickupError : null}
        />

        <Field label={t('ff.wg.deliveryAddress')}>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}: {a.recipient}, {a.city}, {countryName(a.country, countries)}
              </option>
            ))}
            <option value={OTHER}>{t('ff.wg.otherAddress')}</option>
          </select>
        </Field>
        {to === OTHER && (
          <div className="field-row">
            <Field
              label={t('ff.wg.otherDelivery')}
              error={tried && !toText.trim() ? t('ff.wg.addressNeeded') : undefined}
            >
              <input value={toText} maxLength={400} dir="auto" onChange={(e) => setToText(e.target.value)} />
            </Field>
            <Field label={t('ff.wg.country')} htmlFor="wg-country">
              <select id="wg-country" value={toCountry} onChange={(e) => setToCountry(e.target.value)}>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <TimeWindow
          legend={t('ff.wg.deliveryWindow')}
          {...delivery}
          onChange={(next) => setDelivery((d) => ({ ...d, ...next }))}
          error={tried ? deliveryError : null}
        />

        <Field label={t('ship.notes')}>
          <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="row">
          <Button variant="primary" disabled={busy || chosen.length === 0} onClick={() => void request()}>
            {t('ff.wg.ask')}
          </Button>
          <span className="field-hint">{t('ff.wg.nothingCharged')}</span>
        </div>
      </div>
    </Panel>
  );
}

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
  const [rows, setRows] = useState<ShipmentSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const all = await api.get<ShipmentSummary[]>('/shipping/shipments');
        setRows(all.filter((s) => s.fulfilmentMethod === 'hand_delivery' && s.status === 'requested'));
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError, reloadToken]);

  if (rows.length === 0) return null;

  return (
    <Panel title={t('ff.wg.quotesTitle')} subtitle={t('ff.wg.quotesSubtitle')}>
      <ul className="check-list list-unbounded">
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
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void api
                        .post(`/shipping/white-glove/${r.id}/accept`, { quoteMinor: r.quoteMinor })
                        .then(() => {
                          onStatus(t('ff.wg.accepted', { amount: formatUsd(r.quoteMinor!) }));
                          onError(null);
                          onChanged();
                        })
                        .catch((e: Error) => {
                          if (e instanceof ApiError && e.code === 'quote_changed') {
                            onError(t('ff.wg.quoteChanged'));
                            onChanged();
                          } else {
                            onError(e.message);
                          }
                        })
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
