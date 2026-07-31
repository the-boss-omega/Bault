import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useT } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n';
import { Barcode, BarcodeLabel, BarcodePrintButton } from '../../shared/Barcode';
import { ServiceQueue } from './ServiceQueue';

interface Bin {
  id: string;
  barcode: string;
  zone: string;
  capacity: number;
}

/**
 * Warehouse console (T054). Operator flows: bulk intake (with a mandatory bin, a
 * quantity stepper and lot support), relocate, structured shipment fulfillment, bin
 * management and the inventory report (viewable + PDF export).
 */
export function WarehouseConsole() {
  const t = useT();
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) => setLog((prev) => [line, ...prev].slice(0, 20));
  const [bins, setBins] = useState<Bin[]>([]);

  const loadBins = useCallback(async () => {
    try {
      setBins(await api.get<Bin[]>('/custody/bins'));
    } catch {
      /* ignore — list stays as-is */
    }
  }, []);

  useEffect(() => {
    void loadBins();
  }, [loadBins]);

  // Relocate (scan item, then scan shelf)
  const [scanItem, setScanItem] = useState('');
  const [scanBin, setScanBin] = useState('');

  async function relocate() {
    try {
      await api.post(`/custody/items/${scanItem}/relocate`, { binId: scanBin });
      append(t('warehouse.log.relocateDone', { item: scanItem, bin: scanBin }));
      setScanItem('');
      setScanBin('');
    } catch (e) {
      append(t('warehouse.log.relocateError', { message: (e as Error).message }));
    }
  }

  return (
    <section>
      <h2>{t('warehouse.title')}</h2>

      <fieldset>
        <legend>{t('warehouse.intake.legend')}</legend>
        <IntakePanel bins={bins} onLog={append} />
      </fieldset>

      <fieldset>
        <legend>{t('warehouse.relocate.legend')}</legend>
        <div className="field-row">
          <input placeholder={t('warehouse.relocate.scanItem')} value={scanItem} onChange={(e) => setScanItem(e.target.value)} dir="ltr" />
          <select value={scanBin} onChange={(e) => setScanBin(e.target.value)}>
            <option value="">{t('intake.selectBin')}</option>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>{b.barcode} — {b.zone}</option>
            ))}
          </select>
          <button className="btn btn--primary" disabled={!scanItem || !scanBin} onClick={relocate}>{t('warehouse.relocate.submit')}</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('warehouse.lots.legend')}</legend>
        <LotsPanel onLog={append} />
      </fieldset>

      <fieldset>
        <legend>{t('warehouse.fulfillShipment')}</legend>
        <FulfillmentPanel onLog={append} />
      </fieldset>

      <fieldset>
        <legend>{t('warehouse.bins.legend')}</legend>
        <BinsPanel bins={bins} reloadBins={loadBins} onLog={append} />
      </fieldset>

      <fieldset>
        <legend>{t('warehouse.report.legend')}</legend>
        <ReportPanel />
      </fieldset>

      <ServiceQueue />

      <h3>{t('warehouse.log.title')}</h3>
      <ul className="log">{log.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </section>
  );
}

/** Bulk intake with a quantity stepper (1–100), a MANDATORY bin, and lot support. */
function IntakePanel({ bins, onLog }: { bins: Bin[]; onLog: (line: string) => void }) {
  const t = useT();
  const [ownerIntakeId, setOwnerIntakeId] = useState('OW-0001');
  const [typeClass, setTypeClass] = useState('Trading Card');
  const [description, setDescription] = useState('');
  const [conditionGrade, setConditionGrade] = useState('');
  const [binId, setBinId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [isLot, setIsLot] = useState(false);
  const [lotSize, setLotSize] = useState(2);
  // Barcodes minted by the most recent intake, so the operator can print the
  // physical labels for exactly the items they just booked in.
  const [labels, setLabels] = useState<{ id: string; barcode: string }[]>([]);

  const clampQty = (n: number) => Math.max(1, Math.min(100, Math.trunc(n) || 1));

  async function intake() {
    if (!binId) {
      onLog(t('intake.binRequired'));
      return;
    }
    try {
      const res = await api.post<{ id: string; barcode: string } | Array<{ id: string; barcode: string }>>(
        '/intake/items',
        {
          ownerIntakeId,
          typeClass,
          description: description || undefined,
          conditionGrade: conditionGrade || undefined,
          binId,
          quantity,
          isLot,
          lotSize: isLot ? lotSize : undefined,
        },
      );
      // A bulk intake returns the array; a single intake returns the one item.
      const created = Array.isArray(res) ? res : [res];
      setLabels(created);
      onLog(t('intake.bulkDone', { count: created.length }));
    } catch (e) {
      onLog(t('warehouse.log.intakeError', { message: (e as Error).message }));
    }
  }

  return (
    <div>
      <div className="field-row">
        <input placeholder={t('warehouse.intake.ownerIntakeId')} value={ownerIntakeId} onChange={(e) => setOwnerIntakeId(e.target.value)} dir="ltr" />
        <input placeholder={t('warehouse.intake.typeClass')} value={typeClass} onChange={(e) => setTypeClass(e.target.value)} />
        <input placeholder={t('warehouse.intake.description')} value={description} onChange={(e) => setDescription(e.target.value)} />
        <input placeholder={t('warehouse.intake.condition')} value={conditionGrade} onChange={(e) => setConditionGrade(e.target.value)} style={{ width: '6rem' }} />
      </div>
      <div className="field-row">
        <select value={binId} onChange={(e) => setBinId(e.target.value)} required>
          <option value="">{t('intake.selectBin')}</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>{b.barcode} — {b.zone}</option>
          ))}
        </select>
        <label className="stepper">
          {t('intake.quantity')}
          <button type="button" className="btn btn--ghost" onClick={() => setQuantity((q) => clampQty(q - 1))} aria-label="-">−</button>
          <input
            type="number"
            min={1}
            max={100}
            value={quantity}
            onChange={(e) => setQuantity(clampQty(Number(e.target.value)))}
            dir="ltr"
            style={{ width: '4rem' }}
          />
          <button type="button" className="btn btn--ghost" onClick={() => setQuantity((q) => clampQty(q + 1))} aria-label="+">+</button>
        </label>
        <label>
          <input type="checkbox" checked={isLot} onChange={(e) => setIsLot(e.target.checked)} /> {t('intake.isLot')}
        </label>
        {isLot && (
          <label>
            {t('intake.lotSize')}
            <input type="number" min={1} value={lotSize} onChange={(e) => setLotSize(Math.max(1, Number(e.target.value)))} dir="ltr" style={{ width: '5rem' }} />
          </label>
        )}
        <button className="btn btn--primary" disabled={!binId || !typeClass} onClick={intake}>{t('warehouse.intake.submit')}</button>
      </div>
      {labels.length > 0 && (
        <>
          <h4>{t('warehouse.intake.lastLabels')}</h4>
          <ul className="card-grid">
            {labels.map((l) => (
              <li key={l.id} className="card">
                <BarcodeLabel value={l.barcode} caption={description || typeClass} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

interface OpenLot {
  id: string;
  serialNumber: string;
  barcode: string;
  typeClass: string;
  description: string;
  lotSize: number;
}

/**
 * Break Lot service (Requirement 10.5). A lot is stored and counted as ONE item;
 * breaking it intakes each contained item individually, so every contained item
 * becomes a standalone item with its own record, label, bin and charge.
 */
function LotsPanel({ onLog }: { onLog: (line: string) => void }) {
  const t = useT();
  const [lots, setLots] = useState<OpenLot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLots(await api.get<OpenLot[]>('/intake/lots'));
    } catch (e) {
      onLog((e as Error).message);
    }
  }, [onLog]);

  useEffect(() => {
    void load();
  }, [load]);

  async function breakLot(lot: OpenLot) {
    setBusy(lot.id);
    try {
      const res = await api.post<{ producedCount: number }>(`/intake/items/${lot.id}/break-lot`);
      onLog(t('warehouse.lots.broken', { lot: lot.serialNumber, count: res.producedCount }));
      await load();
    } catch (e) {
      onLog(t('warehouse.lots.breakError', { message: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  if (lots.length === 0) return <p className="hint">{t('warehouse.lots.empty')}</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('warehouse.lots.colLot')}</th>
            <th>{t('warehouse.intake.description')}</th>
            <th>{t('warehouse.lots.colSize')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr key={lot.id}>
              <td dir="ltr"><code>{lot.serialNumber}</code></td>
              <td>{lot.description || lot.typeClass}</td>
              <td>{lot.lotSize}</td>
              <td>
                <button className="btn btn--accent" disabled={busy === lot.id} onClick={() => breakLot(lot)}>
                  {t('intake.breakLot')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Structured shipment fulfillment (Requirement 5.3). The operator loads the
 * shipment, verifies EVERY item, and fills the required carrier / weight / notes
 * fields before the request can be closed.
 */
interface ShipmentDetail {
  id: string;
  code: string | null;
  status: string;
  carrier: string | null;
  itemIds: string[];
  destinationAddress: string;
}

function FulfillmentPanel({ onLog }: { onLog: (line: string) => void }) {
  const t = useT();
  const [shipmentId, setShipmentId] = useState('');
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [carrier, setCarrier] = useState('DHL');
  const [weight, setWeight] = useState('500');
  const [notes, setNotes] = useState('');

  async function load() {
    try {
      const s = await api.get<ShipmentDetail>(`/shipping/shipments/${shipmentId}`);
      setDetail(s);
      setVerified({});
      if (s.carrier) setCarrier(s.carrier);
    } catch (e) {
      onLog((e as Error).message);
    }
  }

  const allVerified = detail ? detail.itemIds.every((id) => verified[id]) : false;

  async function complete() {
    if (!detail) return;
    if (!allVerified || !carrier || weight === '' || notes.trim() === '') {
      onLog(t('warehouse.required'));
      return;
    }
    try {
      const res = await api.post<{ trackingNumber: string }>(`/shipping/shipments/${detail.id}/dispatch`, {
        scannedItemIds: detail.itemIds,
        carrier,
        packageWeightGrams: Number(weight),
        fulfillmentNotes: notes,
      });
      onLog(t('warehouse.log.dispatchDone', { id: detail.code ?? detail.id, tracking: res.trackingNumber }));
      setDetail(null);
      setShipmentId('');
      setNotes('');
    } catch (e) {
      onLog(t('warehouse.log.dispatchError', { message: (e as Error).message }));
    }
  }

  return (
    <div>
      <div className="field-row">
        <input placeholder={t('warehouse.dispatch.shipmentId')} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} dir="ltr" />
        <button className="btn btn--ghost" disabled={!shipmentId} onClick={load}>{t('warehouse.fulfill')}</button>
      </div>
      {detail && (
        <div className="card">
          <p className="hint">{detail.destinationAddress}</p>
          <ul className="check-list">
            {detail.itemIds.map((id) => (
              <li key={id}>
                <label>
                  <input type="checkbox" checked={!!verified[id]} onChange={() => setVerified((p) => ({ ...p, [id]: !p[id] }))} />{' '}
                  <code dir="ltr">{id}</code>
                </label>
              </li>
            ))}
          </ul>
          <div className="field-row">
            <label>
              {t('warehouse.carrier')}
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </label>
            <label>
              {t('warehouse.packageWeight')}
              <input type="number" min={1} value={weight} onChange={(e) => setWeight(e.target.value)} dir="ltr" style={{ width: '6rem' }} />
            </label>
            <input placeholder={t('warehouse.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label>
            <input type="checkbox" checked={allVerified} readOnly /> {t('warehouse.itemsVerified')}
          </label>
          <div className="actions">
            <button className="btn btn--primary" disabled={!allVerified || !carrier || weight === '' || notes.trim() === ''} onClick={complete}>
              {t('warehouse.complete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** INV-01: create bins (barcode auto-generated when omitted) + list all bins. */
function BinsPanel({ bins, reloadBins, onLog }: { bins: Bin[]; reloadBins: () => Promise<void>; onLog: (line: string) => void }) {
  const t = useT();
  const [zone, setZone] = useState('');
  const [capacity, setCapacity] = useState('10');
  const [barcode, setBarcode] = useState('');

  async function create() {
    try {
      const bin = await api.post<Bin>('/custody/bins', {
        zone,
        capacity: Number(capacity),
        barcode: barcode || undefined,
      });
      onLog(t('warehouse.log.binCreated', { barcode: bin.barcode, zone: bin.zone }));
      setZone('');
      setBarcode('');
      await reloadBins();
    } catch (e) {
      onLog(t('warehouse.log.binCreateError', { message: (e as Error).message }));
    }
  }

  return (
    <div>
      <div className="field-row">
        <input placeholder={t('warehouse.bins.zone')} value={zone} onChange={(e) => setZone(e.target.value)} />
        <input
          type="number"
          min={0}
          placeholder={t('warehouse.bins.capacity')}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          dir="ltr"
        />
        <input placeholder={t('warehouse.bins.barcode')} value={barcode} onChange={(e) => setBarcode(e.target.value)} dir="ltr" />
        <button className="btn btn--primary" disabled={!zone || capacity === ''} onClick={create}>{t('warehouse.bins.create')}</button>
      </div>
      {bins.length === 0 ? (
        <p className="hint">{t('warehouse.bins.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('warehouse.bins.colBarcode')}</th>
                <th>{t('warehouse.bins.colZone')}</th>
                <th>{t('warehouse.bins.colCapacity')}</th>
              </tr>
            </thead>
            <tbody>
              {bins.map((b) => (
                <tr key={b.id}>
                  {/* Shelf labels get printed and stuck on the physical bin. */}
                  <td dir="ltr">
                    <div className="barcode-label">
                      <Barcode value={b.barcode} options={{ moduleWidth: 1, height: 34 }} />
                      <BarcodePrintButton value={b.barcode} caption={`Zone ${b.zone}`} />
                    </div>
                  </td>
                  <td>{b.zone}</td>
                  <td>{b.capacity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const CUT_LABEL: Record<string, MessageKey> = {
  shelf: 'warehouse.report.cut.shelf',
  owner: 'warehouse.report.cut.owner',
  condition: 'warehouse.report.cut.condition',
  item_class: 'warehouse.report.cut.itemClass',
};

interface ReportRow {
  key: string | null;
  label: string | null;
  count: number;
}

/** CST-06: inventory report grouped by the selected cut, with a PDF export. */
function ReportPanel() {
  const t = useT();
  const [cut, setCut] = useState('shelf');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ rows: ReportRow[] } | ReportRow[]>(`/custody/report?cut=${cut}`)
      .then((r) => {
        setRows(Array.isArray(r) ? r : r.rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [cut]);

  const cutKey = CUT_LABEL[cut];
  const cutLabel = cutKey ? t(cutKey) : cut;

  return (
    <div>
      <div className="field-row">
        <label>
          {t('warehouse.report.cutLabel')}
          <select value={cut} onChange={(e) => setCut(e.target.value)}>
            {Object.entries(CUT_LABEL).map(([value, key]) => (
              <option key={value} value={value}>{t(key)}</option>
            ))}
          </select>
        </label>
        <a className="btn btn--accent" href={`/api/v1/custody/report.pdf?cut=${cut}`} target="_blank" rel="noopener noreferrer">
          {t('warehouse.report.exportPdf')}
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      {rows.length === 0 ? (
        <p className="hint">{t('warehouse.report.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{cutLabel}</th>
                <th>{t('warehouse.report.colCount')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.key ?? 'none'}-${i}`}>
                  <td dir="ltr">{r.label ?? r.key ?? t('warehouse.report.noValue')}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
