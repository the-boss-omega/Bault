import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../shared/i18n';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import {
  DISPOSAL_CATEGORIES,
  DISPOSAL_OUTCOMES,
  ITEM_CLASSES,
  itemClassOption,
} from '../../shared/itemClasses';
import { useRoute, useNavigation } from '../../shared/routing';
import { Barcode, BarcodeLabel, BarcodePrintButton } from '../../shared/Barcode';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  MetricCard,
  Panel,
  SkeletonTable,
  StatusBadge,
  TabPanel,
  ViewAllLink,
} from '../../shared/ui/primitives';
import {
  IconAlert,
  IconBox,
  IconDownload,
  IconLayers,
  IconLocation,
  IconPlus,
  IconScan,
  IconServices,
  IconShipping,
} from '../../shared/ui/icons';
import { ServiceQueue } from './ServiceQueue';
import { GradingSubmissions } from './GradingSubmissions';
import { ParcelQueue } from './ParcelQueue';
import { SupportQueue } from './SupportQueue';
import type { ParcelQueueRow } from '../../shared/parcels';

interface Bin {
  id: string;
  barcode: string;
  zone: string;
  capacity: number;
}

interface ReportRow {
  key: string | null;
  label: string | null;
  count: number;
}

const TABS = ['overview', 'parcels', 'intake', 'inventory', 'shipments', 'locations', 'services', 'support'] as const;
type WarehouseTab = (typeof TABS)[number];

const CUT_LABEL: Record<string, MessageKey> = {
  shelf: 'warehouse.report.cut.shelf',
  owner: 'warehouse.report.cut.owner',
  condition: 'warehouse.report.cut.condition',
  item_class: 'warehouse.report.cut.itemClass',
};

/** A bin is flagged once it is 80% full — the operator's real "act now" signal. */
const NEAR_CAPACITY = 0.8;

/**
 * Warehouse console (T054), rebuilt on the shared application shell.
 *
 * The rail, header and workspace are exactly the ones every other section uses;
 * only the contextual tabs below the title belong to the warehouse. Operator
 * flows are unchanged: bulk intake with a mandatory bin, relocate, lot breaking,
 * scan-verified shipment fulfillment, bin management, the inventory report and
 * the service queue.
 */
export function WarehouseConsole() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);

  const [log, setLog] = useState<string[]>([]);
  const append = useCallback((line: string) => setLog((prev) => [line, ...prev].slice(0, 20)), []);

  const [bins, setBins] = useState<Bin[]>([]);
  const [shelfRows, setShelfRows] = useState<ReportRow[] | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tab: WarehouseTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as WarehouseTab)
    : 'overview';

  const loadBins = useCallback(async () => {
    try {
      setBins(await api.get<Bin[]>('/custody/bins'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const [report, queue] = await Promise.all([
        api.get<{ rows: ReportRow[] } | ReportRow[]>('/custody/report?cut=shelf'),
        api.get<unknown[]>('/services/queue'),
      ]);
      setShelfRows(Array.isArray(report) ? report : report.rows);
      setQueueCount(queue.length);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setShelfRows([]);
    }
  }, []);

  useEffect(() => {
    void loadBins();
    void loadSummary();
  }, [loadBins, loadSummary]);

  /** Items in stock, and how full each bin is — derived from the shelf report. */
  const stats = useMemo(() => {
    const rows = shelfRows ?? [];
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const countByBin = new Map(rows.filter((r) => r.key).map((r) => [r.key as string, r.count]));
    const nearCapacity = bins.filter((b) => {
      const used = countByBin.get(b.id) ?? 0;
      return b.capacity > 0 && used / b.capacity >= NEAR_CAPACITY;
    }).length;
    return { total, nearCapacity, countByBin };
  }, [shelfRows, bins]);

  const tabs = TABS.map((key) => ({ key, label: t(`warehouse.tab.${key}` as MessageKey) }));

  return (
    <>
      <ContextTabs
        label={t('warehouse.title')}
        tabs={tabs}
        active={tab}
        onSelect={goTab}
        actions={
          <Button variant="gold" icon={<IconPlus />} onClick={() => goTab('intake')}>
            {t('warehouse.addInventory')}
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void loadSummary()} retryLabel={t('ui.retry')} />}

      {tab === 'overview' && (
        <TabPanel tab="overview">
          <div className="metric-grid">
            <MetricCard
              label={t('warehouse.metric.itemsInStock')}
              value={shelfRows === null ? '—' : stats.total.toLocaleString()}
              icon={<IconBox />}
              tone="green"
              footer={t('warehouse.metric.itemsNote')}
            />
            <MetricCard
              label={t('warehouse.metric.nearCapacity')}
              value={shelfRows === null ? '—' : stats.nearCapacity}
              icon={<IconAlert />}
              tone="amber"
              footer={
                <ViewAllLink onClick={() => goTab('locations')}>{t('warehouse.viewLocations')}</ViewAllLink>
              }
            />
            <MetricCard
              label={t('warehouse.metric.pendingRequests')}
              value={queueCount ?? '—'}
              icon={<IconServices />}
              tone="blue"
              footer={
                <ViewAllLink onClick={() => goTab('services')}>{t('warehouse.viewRequests')}</ViewAllLink>
              }
            />
            <MetricCard
              label={t('warehouse.metric.locations')}
              value={bins.length}
              icon={<IconLocation />}
              tone="violet"
              footer={
                <ViewAllLink onClick={() => goTab('locations')}>{t('warehouse.viewLocations')}</ViewAllLink>
              }
            />
          </div>

          <Panel
            title={t('warehouse.inventoryOverview')}
            subtitle={t('warehouse.report.cut.shelf')}
            flush
            footer={<ViewAllLink onClick={() => goTab('inventory')}>{t('warehouse.viewInventory')}</ViewAllLink>}
          >
            <InventoryRows
              rows={(shelfRows ?? []).slice(0, 6)}
              loading={shelfRows === null}
              cut="shelf"
              bins={bins}
              t={t}
            />
          </Panel>

          <Panel title={t('warehouse.log.title')} flush>
            {log.length === 0 ? (
              <EmptyState title={t('warehouse.log.empty')} text={t('warehouse.log.emptyText')} icon={<IconScan />} />
            ) : (
              <ul className="log">
                {log.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </Panel>
        </TabPanel>
      )}

      {tab === 'parcels' && (
        <TabPanel tab="parcels">
          <ParcelQueue onChanged={loadSummary} />
        </TabPanel>
      )}

      {tab === 'intake' && (
        <TabPanel tab="intake">
          <Panel title={t('warehouse.intake.legend')} subtitle={t('warehouse.intake.subtitle')}>
            <IntakePanel bins={bins} onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.relocate.legend')}>
            <RelocatePanel bins={bins} onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.lots.legend')} flush>
            <LotsPanel onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.disposal.legend')} subtitle={t('warehouse.disposal.subtitle')}>
            <DisposalPanel onLog={append} />
          </Panel>

          {log.length > 0 && (
            <Panel title={t('warehouse.log.title')} flush>
              <ul className="log">
                {log.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </Panel>
          )}
        </TabPanel>
      )}

      {tab === 'inventory' && (
        <TabPanel tab="inventory">
          <InventoryTab bins={bins} t={t} />
        </TabPanel>
      )}

      {tab === 'shipments' && (
        <TabPanel tab="shipments">
          <Panel title={t('warehouse.fulfillShipment')} subtitle={t('warehouse.shipments.subtitle')}>
            <FulfillmentPanel onLog={append} />
          </Panel>
        </TabPanel>
      )}

      {tab === 'locations' && (
        <TabPanel tab="locations">
          <BinsPanel
            bins={bins}
            counts={stats.countByBin}
            reloadBins={loadBins}
            onLog={append}
            t={t}
          />
        </TabPanel>
      )}

      {tab === 'services' && (
        <TabPanel tab="services">
          <ServiceQueue onChanged={loadSummary} />
          {/* The batch sits under the queue because it is the step AFTER
              accepting a grading request, not a separate job. */}
          <GradingSubmissions />
        </TabPanel>
      )}

      {tab === 'support' && (
        <TabPanel tab="support">
          <SupportQueue onChanged={loadSummary} />
        </TabPanel>
      )}
    </>
  );
}

/* ============================================================
   Inventory report
   ============================================================ */

function InventoryTab({ bins, t }: { bins: Bin[]; t: TranslateFn }) {
  const [cut, setCut] = useState('shelf');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const report = await api.get<{ rows: ReportRow[] } | ReportRow[]>(`/custody/report?cut=${cut}`);
      setRows(Array.isArray(report) ? report : report.rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [cut]);

  useEffect(() => {
    void load();
  }, [load]);

  const cutKey = CUT_LABEL[cut];

  return (
    <Panel
      title={t('warehouse.inventoryOverview')}
      subtitle={cutKey ? t(cutKey) : cut}
      flush
      tools={
        <>
          <label className="control">
            <IconLayers />
            <select value={cut} onChange={(e) => setCut(e.target.value)} aria-label={t('warehouse.report.cutLabel')}>
              {Object.entries(CUT_LABEL).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </label>
          <a
            className="btn btn--gold btn--sm"
            href={`/api/v1/custody/report.pdf?cut=${cut}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconDownload />
            {t('warehouse.report.exportPdf')}
          </a>
        </>
      }
    >
      {error && <div style={{ padding: 16 }}><ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} /></div>}
      <InventoryRows rows={rows ?? []} loading={rows === null} cut={cut} bins={bins} t={t} />
    </Panel>
  );
}

/**
 * The inventory table. On the shelf cut each row is joined to its bin so the
 * operator sees utilisation and a real stock status, not just a count.
 */
function InventoryRows({
  rows,
  loading,
  cut,
  bins,
  t,
}: {
  rows: readonly ReportRow[];
  loading: boolean;
  cut: string;
  bins: Bin[];
  t: TranslateFn;
}) {
  if (loading) return <SkeletonTable rows={5} columns={4} />;
  if (rows.length === 0) {
    return <EmptyState title={t('warehouse.report.empty')} text={t('warehouse.report.emptyText')} icon={<IconBox />} />;
  }

  const byId = new Map(bins.map((b) => [b.id, b]));
  const cutKey = CUT_LABEL[cut];
  const isShelf = cut === 'shelf';

  return (
    <div className="dt-wrap dt-wrap--stack">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{cutKey ? t(cutKey) : cut}</th>
            {isShelf && <th scope="col">{t('warehouse.bins.colZone')}</th>}
            <th scope="col" className="td-end">
              {t('warehouse.report.colCount')}
            </th>
            {isShelf && <th scope="col">{t('warehouse.bins.utilisation')}</th>}
            {isShelf && <th scope="col">{t('admin.col.status')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const bin = row.key ? byId.get(row.key) : undefined;
            const used = row.count;
            const ratio = bin && bin.capacity > 0 ? used / bin.capacity : null;
            return (
              <tr key={`${row.key ?? 'none'}-${index}`}>
                <td data-label={cutKey ? t(cutKey) : cut}>
                  <span className="dt-primary" dir="ltr">
                    {row.label ?? row.key ?? t('warehouse.report.noValue')}
                  </span>
                </td>
                {isShelf && <td data-label={t('warehouse.bins.colZone')}>{bin?.zone ?? '—'}</td>}
                <td data-label={t('warehouse.report.colCount')} className="td-end num">
                  {used.toLocaleString()}
                </td>
                {isShelf && (
                  <td data-label={t('warehouse.bins.utilisation')} className="num">
                    {bin ? (
                      <span dir="ltr">
                        {used} / {bin.capacity}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                {isShelf && (
                  <td data-label={t('admin.col.status')}>
                    {ratio === null ? (
                      <StatusBadge>{t('warehouse.status.unshelved')}</StatusBadge>
                    ) : ratio >= 1 ? (
                      <StatusBadge tone="error">{t('warehouse.status.full')}</StatusBadge>
                    ) : ratio >= NEAR_CAPACITY ? (
                      <StatusBadge tone="warning">{t('warehouse.status.nearCapacity')}</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">{t('warehouse.status.inStock')}</StatusBadge>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
   Intake
   ============================================================ */

/** Bulk intake with a quantity stepper (1–100), a MANDATORY bin, and lot support. */
function IntakePanel({
  bins,
  onLog,
  onDone,
}: {
  bins: Bin[];
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  // The owner is named by their PERMANENT USERNAME. The OW- intake ID is retired
  // from this form: it is not offered, not defaulted, and not typed. The API
  // still accepts one on `/intake/items` so a parcel bearing an old pre-printed
  // label can be received, but that is a compatibility path, not a workflow.
  const [ownerUsername, setOwnerUsername] = useState('');
  // A key from the shared taxonomy, not free text. The API rejects anything it
  // does not know, so the control has to offer exactly what the API accepts.
  const [typeClass, setTypeClass] = useState<string>(ITEM_CLASSES[0]?.key ?? 'trading_card');
  const [description, setDescription] = useState('');
  const [conditionGrade, setConditionGrade] = useState('');
  const [binId, setBinId] = useState('');
  const [quantity, setQuantity] = useState(1);
  // Optional pre-assigned serial. Left blank the API mints one, which is the norm.
  // It matters for a card that already has a catalogue photograph on file: photos
  // are stored as /images/<SERIAL>, so booking the card in under that same serial
  // is what makes its picture appear. Only meaningful for a single item — a bulk
  // intake must mint a distinct serial per copy.
  const [serialNumber, setSerialNumber] = useState('');
  const [isLot, setIsLot] = useState(false);
  const [lotSize, setLotSize] = useState(2);
  // Barcodes minted by the most recent intake, so the operator can print the
  // physical labels for exactly the items they just booked in.
  const [labels, setLabels] = useState<{ id: string; barcode: string }[]>([]);
  /**
   * The open parcel these items are coming out of, if any.
   *
   * Choosing one fills in the owner and locks it, because the API refuses items
   * booked into a parcel that belongs to somebody else — better to make that
   * impossible to express than to explain it in an error.
   */
  const [openParcels, setOpenParcels] = useState<ParcelQueueRow[]>([]);
  const [parcelId, setParcelId] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const queue = await api.get<ParcelQueueRow[]>('/parcels');
        setOpenParcels(queue.filter((p) => p.status === 'opened' && p.ownerUsername));
      } catch {
        /* the parcel link is optional; hand intake still works without it */
      }
    })();
  }, []);

  const clampQty = (n: number) => Math.max(1, Math.min(100, Math.trunc(n) || 1));

  const normalizedOwner = normalizeUsername(ownerUsername);
  const ownerOk = isValidUsername(normalizedOwner);

  const selectedClass = itemClassOption(typeClass);
  // The lot controls are hidden entirely for classes that cannot arrive in bulk
  // (a single graded slab is never "a lot"), and a lot below the threshold is
  // announced here rather than being silently converted by the API without the
  // operator knowing why they got N labels back instead of one.
  const lotAllowed = selectedClass?.lotEligible ?? true;
  const lotMin = selectedClass?.lotMinSize;
  const lotWillSplit = isLot && lotAllowed && lotMin !== undefined && lotSize < lotMin;

  async function intake() {
    if (!binId) {
      onLog(t('intake.binRequired'));
      return;
    }
    if (!ownerOk) {
      onLog(t('warehouse.intake.ownerUsernameInvalid'));
      return;
    }
    // The API honours an explicit serial only when no quantity is sent, since a
    // bulk intake has to mint one per copy. Omit quantity for that single case.
    const serial = quantity === 1 ? serialNumber.trim() : '';
    try {
      const res = await api.post<{ id: string; barcode: string } | Array<{ id: string; barcode: string }>>(
        '/intake/items',
        {
          ownerUsername: normalizedOwner,
          typeClass,
          description: description || undefined,
          conditionGrade: conditionGrade || undefined,
          binId,
          serialNumber: serial || undefined,
          quantity: serial ? undefined : quantity,
          // Never send a lot for a class that cannot be one — the checkbox is
          // hidden in that case, but its state survives a class change.
          isLot: isLot && lotAllowed,
          lotSize: isLot && lotAllowed ? lotSize : undefined,
          parcelId: parcelId || undefined,
        },
      );
      // A bulk intake returns the array; a single intake returns the one item.
      const created = Array.isArray(res) ? res : [res];
      setLabels(created);
      onLog(t('intake.bulkDone', { count: created.length }));
      await onDone();
    } catch (e) {
      onLog(t('warehouse.log.intakeError', { message: (e as Error).message }));
    }
  }

  return (
    <div className="stack stack--tight">
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t('warehouse.intake.parcel')}</span>
          <select
            value={parcelId}
            onChange={(e) => {
              const next = e.target.value;
              setParcelId(next);
              const chosen = openParcels.find((p) => p.id === next);
              if (chosen?.ownerUsername) setOwnerUsername(chosen.ownerUsername);
            }}
          >
            <option value="">{t('warehouse.intake.noParcel')}</option>
            {openParcels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.ownerUsername}
              </option>
            ))}
          </select>
          <span className="field-hint">{t('warehouse.intake.parcelHint')}</span>
        </label>

        <label className="field">
          <span className="field-label">{t('warehouse.intake.ownerUsername')}</span>
          <input
            value={ownerUsername}
            onChange={(e) => setOwnerUsername(e.target.value)}
            aria-invalid={ownerUsername.length > 0 && !ownerOk}
            aria-describedby="intake-owner-hint"
            disabled={parcelId !== ''}
            dir="ltr"
          />
          <span
            className={ownerUsername.length > 0 && !ownerOk ? 'field-error' : 'field-hint'}
            id="intake-owner-hint"
          >
            {ownerUsername.length > 0 && !ownerOk
              ? t('warehouse.intake.ownerUsernameInvalid')
              : t('warehouse.intake.ownerUsernameHint')}
          </span>
        </label>
        <label className="field">
          <span className="field-label">{t('warehouse.intake.typeClass')}</span>
          <select value={typeClass} onChange={(e) => setTypeClass(e.target.value)}>
            {ITEM_CLASSES.map((c) => (
              <option key={c.key} value={c.key}>
                {t(c.labelKey)}
              </option>
            ))}
          </select>
          {selectedClass?.oversized && (
            <span className="field-hint">{t('warehouse.intake.oversizedHint')}</span>
          )}
        </label>
        <label className="field">
          <span className="field-label">{t('warehouse.intake.description')}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('warehouse.intake.condition')}</span>
          <input value={conditionGrade} onChange={(e) => setConditionGrade(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('warehouse.intake.serialNumber')}</span>
          <input
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder={t('warehouse.intake.serialNumberPlaceholder')}
            disabled={quantity !== 1}
            dir="ltr"
          />
          <span className="field-hint">{t('warehouse.intake.serialNumberHint')}</span>
        </label>
        <label className="field">
          <span className="field-label">{t('intake.binRequired')}</span>
          <select value={binId} onChange={(e) => setBinId(e.target.value)} required>
            <option value="">{t('intake.selectBin')}</option>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.barcode} — {b.zone}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="field-label">{t('intake.quantity')}</span>
          <span className="stepper">
            <Button size="sm" aria-label="−" onClick={() => setQuantity((q) => clampQty(q - 1))}>
              −
            </Button>
            <input
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(clampQty(Number(e.target.value)))}
              dir="ltr"
              aria-label={t('intake.quantity')}
            />
            <Button size="sm" aria-label="+" onClick={() => setQuantity((q) => clampQty(q + 1))}>
              +
            </Button>
          </span>
        </div>
      </div>

      <div className="row">
        {lotAllowed && (
          <label className="check">
            <input type="checkbox" checked={isLot} onChange={(e) => setIsLot(e.target.checked)} />
            {t('intake.isLot')}
          </label>
        )}
        {lotAllowed && isLot && (
          <label className="check">
            {t('intake.lotSize')}
            <input
              type="number"
              min={1}
              value={lotSize}
              onChange={(e) => setLotSize(Math.max(1, Number(e.target.value)))}
              dir="ltr"
              style={{ width: '6rem' }}
            />
          </label>
        )}
        <span className="spacer" />
        <Button variant="gold" icon={<IconPlus />} disabled={!binId || !typeClass} onClick={intake}>
          {t('warehouse.intake.submit')}
        </Button>
      </div>

      {lotWillSplit && (
        <p className="field-hint">{t('intake.lotTooSmall', { min: lotMin ?? 0, count: lotSize })}</p>
      )}

      {labels.length > 0 && (
        <>
          <h3 className="panel-title" style={{ fontSize: 15 }}>
            {t('warehouse.intake.lastLabels')}
          </h3>
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

function RelocatePanel({
  bins,
  onLog,
  onDone,
}: {
  bins: Bin[];
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [scanItem, setScanItem] = useState('');
  const [scanBin, setScanBin] = useState('');

  async function relocate() {
    try {
      await api.post(`/custody/items/${scanItem}/relocate`, { binId: scanBin });
      onLog(t('warehouse.log.relocateDone', { item: scanItem, bin: scanBin }));
      setScanItem('');
      setScanBin('');
      await onDone();
    } catch (e) {
      onLog(t('warehouse.log.relocateError', { message: (e as Error).message }));
    }
  }

  return (
    <div className="form-grid" style={{ alignItems: 'end' }}>
      <label className="field">
        <span className="field-label">{t('warehouse.relocate.scanItem')}</span>
        <input value={scanItem} onChange={(e) => setScanItem(e.target.value)} dir="ltr" />
      </label>
      <label className="field">
        <span className="field-label">{t('warehouse.relocate.scanShelf')}</span>
        <select value={scanBin} onChange={(e) => setScanBin(e.target.value)}>
          <option value="">{t('intake.selectBin')}</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.barcode} — {b.zone}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field-label" aria-hidden="true">
          &nbsp;
        </span>
        <Button variant="navy" icon={<IconScan />} disabled={!scanItem || !scanBin} onClick={relocate}>
          {t('warehouse.relocate.submit')}
        </Button>
      </div>
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
function LotsPanel({ onLog, onDone }: { onLog: (line: string) => void; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [lots, setLots] = useState<OpenLot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLots(await api.get<OpenLot[]>('/intake/lots'));
    } catch (e) {
      onLog((e as Error).message);
      setLots([]);
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
      await onDone();
    } catch (e) {
      onLog(t('warehouse.lots.breakError', { message: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  if (lots === null) return <SkeletonTable rows={3} columns={4} />;
  if (lots.length === 0) {
    return <EmptyState title={t('warehouse.lots.empty')} text={t('warehouse.lots.emptyText')} icon={<IconLayers />} />;
  }

  return (
    <div className="dt-wrap dt-wrap--stack">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{t('warehouse.lots.colLot')}</th>
            <th scope="col">{t('warehouse.intake.description')}</th>
            <th scope="col" className="td-end">
              {t('warehouse.lots.colSize')}
            </th>
            <th scope="col" className="td-tight" />
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr key={lot.id}>
              <td data-label={t('warehouse.lots.colLot')}>
                <code dir="ltr">{lot.serialNumber}</code>
              </td>
              <td data-label={t('warehouse.intake.description')}>{lot.description || lot.typeClass}</td>
              <td data-label={t('warehouse.lots.colSize')} className="td-end num">
                {lot.lotSize}
              </td>
              <td className="td-tight">
                <Button size="sm" variant="secondary" disabled={busy === lot.id} onClick={() => breakLot(lot)}>
                  {t('intake.breakLot')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
   Arrivals that were not accepted
   ============================================================ */

/**
 * Record something that arrived for a collector and did not go into their vault:
 * a prohibited item, a GPS tracker riding along in the parcel, or a box of
 * commons worth less than the cost of processing it.
 *
 * The physical act already happened at a bench — a battery came out of an
 * AirTag, a bottle went in a bin, a box went to a youth club. Nothing here
 * performs any of that or can check that it was done. What this form does is
 * make the decision a RECORD: which of the permitted outcomes occurred, in whose
 * name, and why. The collector is notified the moment it is filed, so nothing
 * addressed to them can vanish silently.
 *
 * Notes are mandatory, matching the fulfillment forms elsewhere in this console.
 * This row is the only account of why somebody's property was destroyed, and it
 * has to read as one.
 */
function DisposalPanel({ onLog }: { onLog: (line: string) => void }) {
  const { t } = useI18n();
  const [ownerUsername, setOwnerUsername] = useState('');
  const [category, setCategory] = useState(DISPOSAL_CATEGORIES[0]?.key ?? 'gps_tracker');
  const [outcome, setOutcome] = useState(DISPOSAL_OUTCOMES[0]?.key ?? 'destroyed');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const normalizedOwner = normalizeUsername(ownerUsername);
  const ownerOk = isValidUsername(normalizedOwner);
  const complete = ownerOk && description.trim() !== '' && notes.trim() !== '';

  async function record() {
    setBusy(true);
    try {
      const row = await api.post<{ code: string }>('/intake/disposals', {
        ownerUsername: normalizedOwner,
        category,
        outcome,
        description: description.trim(),
        notes: notes.trim(),
      });
      onLog(t('warehouse.disposal.recorded', { code: row.code, owner: normalizedOwner }));
      setDescription('');
      setNotes('');
    } catch (e) {
      onLog(t('warehouse.disposal.error', { message: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight">
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t('warehouse.intake.ownerUsername')}</span>
          <input
            value={ownerUsername}
            onChange={(e) => setOwnerUsername(e.target.value)}
            aria-invalid={ownerUsername.length > 0 && !ownerOk}
            dir="ltr"
          />
        </label>

        <label className="field">
          <span className="field-label">{t('warehouse.disposal.category')}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {DISPOSAL_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {t(c.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">{t('warehouse.disposal.outcome')}</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {DISPOSAL_OUTCOMES.map((o) => (
              <option key={o.key} value={o.key}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">{t('warehouse.disposal.description')}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <label className="field">
          <span className="field-label">{t('warehouse.disposal.notes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="row row--end">
        {!complete && <span className="field-hint">{t('warehouse.required')}</span>}
        <Button variant="danger" disabled={busy || !complete} onClick={() => void record()}>
          {t('warehouse.disposal.submit')}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   Shipment fulfillment
   ============================================================ */

interface ShipmentDetail {
  id: string;
  code: string | null;
  status: string;
  carrier: string | null;
  itemIds: string[];
  destinationAddress: string;
}

/**
 * Structured shipment fulfillment (Requirement 5.3). The operator loads the
 * shipment, verifies EVERY item, and fills the required carrier / weight / notes
 * fields before the request can be closed.
 */
function FulfillmentPanel({ onLog }: { onLog: (line: string) => void }) {
  const { t } = useI18n();
  const [shipmentId, setShipmentId] = useState('');
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [carrier, setCarrier] = useState('DHL');
  const [weight, setWeight] = useState('500');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const s = await api.get<ShipmentDetail>(`/shipping/shipments/${shipmentId}`);
      setDetail(s);
      setVerified({});
      setError(null);
      if (s.carrier) setCarrier(s.carrier);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const allVerified = detail ? detail.itemIds.every((id) => verified[id]) : false;
  const complete = allVerified && carrier !== '' && weight !== '' && notes.trim() !== '';

  async function completeShipment() {
    if (!detail || !complete) return;
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
      setError((e as Error).message);
      onLog(t('warehouse.log.dispatchError', { message: (e as Error).message }));
    }
  }

  return (
    <div className="stack stack--tight">
      <div className="row">
        <label className="field" style={{ flex: '1 1 260px' }}>
          <span className="field-label">{t('warehouse.dispatch.shipmentId')}</span>
          <input value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} dir="ltr" />
        </label>
        <Button
          variant="navy"
          icon={<IconShipping />}
          disabled={!shipmentId}
          onClick={load}
          style={{ alignSelf: 'end' }}
        >
          {t('warehouse.fulfill')}
        </Button>
      </div>

      {error && <ErrorState message={error} />}

      {detail && (
        <div className="stack stack--tight">
          <p className="infobox" dir="auto">
            {detail.destinationAddress}
          </p>

          <div className="field">
            <span className="field-label">{t('warehouse.itemsVerified')}</span>
            <ul className="check-list">
              {detail.itemIds.map((id) => (
                <li key={id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!verified[id]}
                      onChange={() => setVerified((p) => ({ ...p, [id]: !p[id] }))}
                    />
                    <code dir="ltr">{id}</code>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">{t('warehouse.carrier')}</span>
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('warehouse.packageWeight')}</span>
              <input
                type="number"
                min={1}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                dir="ltr"
              />
            </label>
            <label className="field">
              <span className="field-label">{t('warehouse.notes')}</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

          {!complete && <p className="field-hint">{t('warehouse.required')}</p>}

          <div className="row row--end">
            <Button variant="gold" disabled={!complete} onClick={completeShipment}>
              {t('warehouse.complete')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Locations (bins & shelves)
   ============================================================ */

/** INV-01: create bins (barcode auto-generated when omitted) + list all bins. */
function BinsPanel({
  bins,
  counts,
  reloadBins,
  onLog,
  t,
}: {
  bins: Bin[];
  counts: Map<string, number>;
  reloadBins: () => Promise<void>;
  onLog: (line: string) => void;
  t: TranslateFn;
}) {
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
    <>
      <Panel title={t('warehouse.bins.legend')} subtitle={t('warehouse.bins.subtitle')}>
        <div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field">
            <span className="field-label">{t('warehouse.bins.zone')}</span>
            <input value={zone} onChange={(e) => setZone(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('warehouse.bins.capacity')}</span>
            <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} dir="ltr" />
          </label>
          <label className="field">
            <span className="field-label">{t('warehouse.bins.barcode')}</span>
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} dir="ltr" />
          </label>
          <div className="field">
            <span className="field-label" aria-hidden="true">
              &nbsp;
            </span>
            <Button variant="gold" icon={<IconPlus />} disabled={!zone || capacity === ''} onClick={create}>
              {t('warehouse.bins.create')}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title={t('warehouse.metric.locations')} flush>
        {bins.length === 0 ? (
          <EmptyState title={t('warehouse.bins.empty')} text={t('warehouse.bins.emptyText')} icon={<IconLocation />} />
        ) : (
          <div className="dt-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('warehouse.bins.colBarcode')}</th>
                  <th scope="col">{t('warehouse.bins.colZone')}</th>
                  <th scope="col" className="td-end">
                    {t('warehouse.bins.utilisation')}
                  </th>
                  <th scope="col">{t('admin.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => {
                  const used = counts.get(b.id) ?? 0;
                  const ratio = b.capacity > 0 ? used / b.capacity : 0;
                  return (
                    <tr key={b.id}>
                      {/* Shelf labels get printed and stuck on the physical bin. */}
                      <td dir="ltr">
                        <div className="barcode-label">
                          <Barcode value={b.barcode} options={{ moduleWidth: 1, height: 34 }} />
                          <BarcodePrintButton value={b.barcode} caption={`Zone ${b.zone}`} />
                        </div>
                      </td>
                      <td>{b.zone}</td>
                      <td className="td-end num">
                        <span dir="ltr">
                          {used} / {b.capacity}
                        </span>
                      </td>
                      <td>
                        {ratio >= 1 ? (
                          <StatusBadge tone="error">{t('warehouse.status.full')}</StatusBadge>
                        ) : ratio >= NEAR_CAPACITY ? (
                          <StatusBadge tone="warning">{t('warehouse.status.nearCapacity')}</StatusBadge>
                        ) : used === 0 ? (
                          <StatusBadge>{t('warehouse.status.empty')}</StatusBadge>
                        ) : (
                          <StatusBadge tone="success">{t('warehouse.status.inStock')}</StatusBadge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
