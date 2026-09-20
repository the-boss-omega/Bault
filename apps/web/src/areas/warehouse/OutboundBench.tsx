import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { dollarsToCents, formatDateTime, formatUsd } from '../../shared/money';
import { boxLabel } from '../../shared/carriers';
import {
  Button,
  DetailRow,
  EmptyState,
  ErrorState,
  MoneyField,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { IconShipping } from '../../shared/ui/icons';

/** One row of `GET /shipping/shipments`, as staff see it. */
interface OutboundRow {
  id: string;
  code: string | null;
  status: string;
  username: string | null;
  customerName: string | null;
  fulfilmentMethod: 'carrier' | 'hand_delivery' | 'show_pickup' | string;
  itemIds: string[];
  boxSize: string | null;
  rush: boolean;
  carrier: string | null;
  serviceLevel?: string | null;
  destinationAddress: string | null;
  pickupAddress: string | null;
  deliverFrom: string | null;
  deliverTo: string | null;
  quoteMinor: number | null;
  quoteNotes: string | null;
  customerNotes: string | null;
  createdAt: string;
}

interface ShipmentDetail extends OutboundRow {
  /** Each item's serial and label barcode, so a scan can be matched to it. */
  items?: { id: string; serialNumber: string; barcode: string; description: string }[];
}

/**
 * The carriers a parcel can be handed to. The shipment's own carrier — the one
 * the customer was quoted and paid for — is preselected; this used to be a free
 * text box defaulting to "DHL" whatever the customer had bought.
 */
const CARRIERS = ['USPS', 'FedEx', 'UPS', 'DHL', 'ePacket', 'ePost'];

const METHOD_LABEL: Record<string, MessageKey> = {
  carrier: 'outbound.method.carrier',
  hand_delivery: 'outbound.method.handDelivery',
  show_pickup: 'outbound.method.showPickup',
};

/**
 * The outbound bench: what is paid for and waiting to leave, and the one panel
 * that sends it.
 *
 * It used to be a single "Shipment ID" box. Nothing printed carries the
 * internal id, and there was no list to pick from, so an operator had no way to
 * find the work. Now the paid shipments are listed; pressing Pack opens the
 * scan-every-card panel below, which ends in one of two ways. A parcel is
 * DISPATCHED (carrier, weight, label). A hand delivery or show pickup is HANDED
 * OVER — closed by naming the person who took it, since there is no tracking
 * number to close it.
 */
export function OutboundBench({ onLog }: { onLog: (line: string) => void }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<OutboundRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  /** What the last dispatch or hand-over produced — the tracking number above all. */
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<OutboundRow[]>('/shipping/shipments'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(idOrCode: string) {
    setDone(null);
    try {
      setDetail(await api.get<ShipmentDetail>(`/shipping/shipments/${encodeURIComponent(idOrCode.trim())}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Oldest first: the list is served newest first, and the parcel that has
  // waited longest is the one to pack next.
  const ready = (rows ?? []).filter((r) => r.status === 'rates_selected').reverse();
  const toQuote = (rows ?? []).filter((r) => r.fulfilmentMethod === 'hand_delivery' && r.status === 'requested');

  return (
    <>
      <Panel title={t('outbound.ready.title')} subtitle={t('outbound.ready.subtitle')} flush>
        {error && <ErrorState message={error} />}
        {rows === null ? (
          <SkeletonTable rows={3} columns={5} />
        ) : ready.length === 0 ? (
          <EmptyState title={t('outbound.ready.empty')} text={t('outbound.ready.emptyText')} icon={<IconShipping />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('outbound.col.shipment')}</th>
                  <th scope="col">{t('outbound.col.customer')}</th>
                  <th scope="col">{t('outbound.col.method')}</th>
                  <th scope="col" className="td-end">
                    {t('outbound.col.items')}
                  </th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {ready.map((r) => (
                  <tr key={r.id} className={detail?.id === r.id ? 'is-selected' : undefined}>
                    <td dir="ltr" data-label={t('outbound.col.shipment')}>
                      <code>{r.code ?? r.id.slice(0, 8)}</code>
                      {r.rush && (
                        <>
                          {' '}
                          <StatusBadge tone="warning">{t('outbound.rush')}</StatusBadge>
                        </>
                      )}
                      <span className="dt-sub">{formatDateTime(r.createdAt, locale)}</span>
                    </td>
                    <td data-label={t('outbound.col.customer')}>
                      {r.customerName ?? '—'}
                      {r.username && (
                        <span className="dt-sub" dir="ltr">
                          @{r.username}
                        </span>
                      )}
                    </td>
                    <td data-label={t('outbound.col.method')}>
                      {t(METHOD_LABEL[r.fulfilmentMethod] ?? 'outbound.method.carrier')}
                      {r.boxSize && <span className="dt-sub">{boxLabel(t, { key: r.boxSize })}</span>}
                    </td>
                    <td data-label={t('outbound.col.items')} className="td-end num">
                      {r.itemIds.length}
                    </td>
                    <td className="td-tight td-actions">
                      <Button size="sm" variant="navy" onClick={() => void open(r.id)}>
                        {t('outbound.pack')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('warehouse.fulfillShipment')} subtitle={t('outbound.pack.subtitle')}>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookup.trim()) void open(lookup);
          }}
        >
          <label className="field" style={{ flex: '1 1 220px' }}>
            <span className="field-label">{t('outbound.lookup')}</span>
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} dir="ltr" placeholder="SHP-…" />
          </label>
          <Button type="submit" variant="secondary" disabled={!lookup.trim()} style={{ alignSelf: 'end' }}>
            {t('outbound.open')}
          </Button>
        </form>

        {done && <SuccessNote>{done}</SuccessNote>}

        {detail && (
          <PackPanel
            key={detail.id}
            detail={detail}
            onDone={(line) => {
              onLog(line);
              setDone(line);
              setDetail(null);
              setLookup('');
              void load();
            }}
            onLog={onLog}
          />
        )}
      </Panel>

      {toQuote.length > 0 && (
        <Panel title={t('outbound.quote.title')} subtitle={t('outbound.quote.subtitle')}>
          <ul className="stack">
            {toQuote.map((r) => (
              <WhiteGloveQuoteRow key={r.id} row={r} onQuoted={(line) => {
                onLog(line);
                void load();
              }} />
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/**
 * Scan every card into the box, then close the shipment the way its method
 * closes. What is sent as `scannedItemIds` is what was scanned — never the
 * shipment's own list — so a wrong card in the box blocks completion.
 */
function PackPanel({
  detail,
  onDone,
  onLog,
}: {
  detail: ShipmentDetail;
  onDone: (line: string) => void;
  onLog: (line: string) => void;
}) {
  const { t } = useI18n();
  // No method recorded means an ordinary parcel — the only kind there once was.
  const carrierShipment = (detail.fulfilmentMethod ?? 'carrier') === 'carrier';
  const [scanned, setScanned] = useState<string[]>([]);
  const [strays, setStrays] = useState<string[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [carrier, setCarrier] = useState(detail.carrier ?? '');
  // Blank, not 500: a prefilled weight satisfied the "required" check for a
  // parcel nobody had put on the scale.
  const [weight, setWeight] = useState('');
  const [handedTo, setHandedTo] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function recordScan(raw: string) {
    const label = raw.trim();
    if (label === '') return;
    const match = (detail.items ?? []).find(
      (i) => i.serialNumber === label || i.barcode === label || i.id === label,
    );
    if (match) setScanned((prev) => (prev.includes(match.id) ? prev : [...prev, match.id]));
    else setStrays((prev) => (prev.includes(label) ? prev : [...prev, label]));
    setScanInput('');
  }

  /**
   * What has to be scanned into the box.
   *
   * Normally the shipment's items. A DIRECT SHIP has none — it is a parcel that
   * never entered the vault — and travels with the parcel itself as its single
   * line, so the checklist follows `items` and falls back to the id list.
   */
  const checklist =
    detail.items && detail.items.length > 0
      ? detail.items.map((i) => i.id)
      : detail.itemIds;
  const allScanned = checklist.every((id) => scanned.includes(id));
  const closing = carrierShipment
    ? carrier.trim() !== '' && Number(weight) > 0
    : handedTo.trim() !== '';
  const complete = allScanned && strays.length === 0 && closing && notes.trim() !== '';
  const label = detail.code ?? detail.id;

  async function finish() {
    if (!complete) return;
    setBusy(true);
    try {
      if (carrierShipment) {
        const res = await api.post<{ trackingNumber: string }>(`/shipping/shipments/${detail.id}/dispatch`, {
          scannedItemIds: scanned,
          carrier,
          packageWeightGrams: Number(weight),
          fulfillmentNotes: notes,
        });
        onDone(t('outbound.dispatched', { id: label, carrier, tracking: res.trackingNumber }));
      } else {
        await api.post(`/shipping/shipments/${detail.id}/hand-over`, {
          scannedItemIds: scanned,
          handedToName: handedTo.trim(),
          notes,
        });
        onDone(t('outbound.log.handedOver', { id: label, name: handedTo.trim() }));
      }
    } catch (e) {
      setError((e as Error).message);
      onLog(t('warehouse.log.dispatchError', { message: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight" style={{ marginBlockStart: 'var(--sp-4)' }}>
      <p className="row" style={{ gap: 'var(--sp-2)' }}>
        <code dir="ltr">{label}</code>
        <StatusBadge>{t(METHOD_LABEL[detail.fulfilmentMethod] ?? 'outbound.method.carrier')}</StatusBadge>
        {detail.customerName && <span className="hint">{detail.customerName}</span>}
        {detail.username && (
          <span className="hint" dir="ltr">
            @{detail.username}
          </span>
        )}
        {carrierShipment && detail.carrier && (
          <span className="hint" dir="ltr">
            {[detail.carrier, detail.serviceLevel].filter(Boolean).join(' · ')}
          </span>
        )}
      </p>
      {detail.status !== 'rates_selected' && (
        <p className="field-error" role="alert">
          {t('outbound.notReady')}
        </p>
      )}
      {(detail.destinationAddress || detail.pickupAddress) && (
        <p className="infobox" dir="auto">
          {detail.destinationAddress ?? detail.pickupAddress}
        </p>
      )}
      {detail.customerNotes && <p className="field-hint">{detail.customerNotes}</p>}
      {carrierShipment && (
        <p className="field-hint">
          {detail.boxSize
            ? t('warehouse.dispatch.packIn', { box: boxLabel(t, { key: detail.boxSize }) })
            : t('warehouse.dispatch.anyBox')}
        </p>
      )}

      <label className="field">
        <span className="field-label">{t('warehouse.dispatch.scanLabel')}</span>
        <input
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              recordScan(scanInput);
            }
          }}
          dir="ltr"
          autoComplete="off"
        />
        <span className="field-hint">
          {t('warehouse.dispatch.scannedCount', { done: scanned.length, total: checklist.length })}
        </span>
      </label>

      <ul className="check-list">
        {checklist.map((id) => {
          const info = (detail.items ?? []).find((i) => i.id === id);
          return (
            <li key={id}>
              <span className="check">
                <input
                  type="checkbox"
                  checked={scanned.includes(id)}
                  readOnly
                  tabIndex={-1}
                  aria-label={info?.serialNumber ?? id}
                />
                <code dir="ltr">{info?.serialNumber ?? id}</code>
                {info?.description && <span className="field-hint">{info.description}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {/* A stray is taken out of the box one at a time; clearing every scan to
          get rid of one wrong card meant scanning the right ones again. */}
      {strays.map((s) => (
        <div key={s} className="row" style={{ gap: 'var(--sp-2)' }}>
          <p className="field-error" role="alert">
            {t('warehouse.dispatch.notInShipment', { serial: s })}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setStrays((prev) => prev.filter((x) => x !== s))}>
            {t('outbound.strayRemoved')}
          </Button>
        </div>
      ))}
      {(scanned.length > 0 || strays.length > 0) && (
        <div className="row">
          <Button
            variant="ghost"
            onClick={() => {
              setScanned([]);
              setStrays([]);
            }}
          >
            {t('warehouse.dispatch.clearScans')}
          </Button>
        </div>
      )}

      <div className="form-grid">
        {carrierShipment ? (
          <>
            <label className="field">
              <span className="field-label">{t('warehouse.carrier')}</span>
              <select value={carrier} onChange={(e) => setCarrier(e.target.value)} dir="ltr">
                <option value="">{t('outbound.chooseCarrier')}</option>
                {[...new Set([...(detail.carrier ? [detail.carrier] : []), ...CARRIERS])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('warehouse.packageWeight')}</span>
              <input type="number" min={1} value={weight} onChange={(e) => setWeight(e.target.value)} dir="ltr" />
            </label>
          </>
        ) : (
          <label className="field">
            <span className="field-label">{t('outbound.handedTo')}</span>
            <input value={handedTo} maxLength={140} onChange={(e) => setHandedTo(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="field-label">{t('warehouse.notes')}</span>
          <input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {error && <ErrorState message={error} />}
      {!complete && <p className="field-hint">{t('warehouse.required')}</p>}

      <div className="row row--end">
        <Button variant="gold" loading={busy} disabled={!complete} onClick={() => void finish()}>
          {carrierShipment ? t('warehouse.complete') : t('outbound.handOver')}
        </Button>
      </div>
    </div>
  );
}

/**
 * A hand-delivery request waiting for a figure. The quote carries what it
 * covers, because the collector is agreeing to that and not to a number.
 */
function WhiteGloveQuoteRow({ row, onQuoted }: { row: OutboundRow; onQuoted: (line: string) => void }) {
  const { t, locale } = useI18n();
  const [amount, setAmount] = useState(row.quoteMinor !== null ? (row.quoteMinor / 100).toFixed(2) : '');
  const [notes, setNotes] = useState(row.quoteNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = dollarsToCents(amount);
  const label = row.code ?? row.id.slice(0, 8);

  async function send() {
    if (minor === null || minor <= 0 || !notes.trim()) return;
    setBusy(true);
    try {
      await api.post(`/shipping/white-glove/${row.id}/quote`, { quoteMinor: minor, notes: notes.trim() });
      onQuoted(t('outbound.log.quoted', { id: label, amount: formatUsd(minor) }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="stack stack--tight" style={{ borderBlockEnd: 'var(--border-w) solid var(--line)', paddingBlockEnd: 'var(--sp-4)' }}>
      <p className="row" style={{ gap: 'var(--sp-2)' }}>
        <code dir="ltr">{label}</code>
        <span>{row.customerName ?? row.username ?? '—'}</span>
        {row.quoteMinor !== null ? (
          <StatusBadge tone="info">{t('outbound.quote.sent', { amount: formatUsd(row.quoteMinor) })}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{t('ff.wg.awaitingQuote')}</StatusBadge>
        )}
      </p>
      <dl className="detail-list">
        {row.pickupAddress && <DetailRow label={t('outbound.quote.from')}>{row.pickupAddress}</DetailRow>}
        {row.destinationAddress && <DetailRow label={t('outbound.quote.to')}>{row.destinationAddress}</DetailRow>}
        {(row.deliverFrom || row.deliverTo) && (
          <DetailRow label={t('outbound.quote.window')}>
            {formatDateTime(row.deliverFrom, locale)} – {formatDateTime(row.deliverTo, locale)}
          </DetailRow>
        )}
        <DetailRow label={t('outbound.col.items')}>{row.itemIds.length}</DetailRow>
      </dl>
      {row.customerNotes && <p className="field-hint">{row.customerNotes}</p>}
      <div className="form-grid">
        <MoneyField label={t('outbound.quote.amount')} value={amount} onChange={setAmount} />
        <label className="field">
          <span className="field-label">{t('outbound.quote.covers')}</span>
          <input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error && <ErrorState message={error} />}
      <div className="row row--end">
        <Button
          variant="gold"
          loading={busy}
          disabled={minor === null || minor <= 0 || !notes.trim()}
          onClick={() => void send()}
        >
          {row.quoteMinor !== null ? t('outbound.quote.revise') : t('outbound.quote.send')}
        </Button>
      </div>
    </li>
  );
}
