import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../shared/i18n';
import { itemName } from '../../shared/itemClasses';
import { useRoute, useNavigation } from '../../shared/routing';
import { Barcode, BarcodePrintButton } from '../../shared/Barcode';
import {
  Button,
  ButtonLink,
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
import { scrollBehavior } from '../../shared/ui/motionPreference';
import { ShelfMap, type ShelfBin } from './ShelfMap';
import { ShelfContents } from './ShelfContents';
import {
  IconAlert,
  IconBox,
  IconDownload,
  IconLayers,
  IconLocation,
  IconPlus,
  IconScan,
  IconServices,
} from '../../shared/ui/icons';
import { ServiceQueue } from './ServiceQueue';
import { GradingSubmissions } from './GradingSubmissions';
import { ParcelQueue } from './ParcelQueue';
import { ReceiveParcels } from './ReceiveParcels';
import {
  DisposalBench,
  FulfillmentBench,
  HoldBench,
  NewShelfBench,
  RelocateBench,
} from './Benches';
import { IntakeBench } from './IntakeBench';
import { HouseOrdersPanel } from './HouseOrdersPanel';
import { SupportQueue } from './SupportQueue';
import type { ParcelWorkflow } from '../../shared/parcels';

interface Bin {
  id: string;
  serialNumber: string;
  barcode: string;
  zone: string;
  oversized: boolean;
  active: boolean;
  itemCount: number;
  facilityId: string | null;
  facilityCode: string | null;
}

interface ReportRow {
  key: string | null;
  label: string | null;
  count: number;
}

const TABS = ['overview', 'receiving', 'inventory', 'shipments', 'locations', 'services', 'support'] as const;
type WarehouseTab = (typeof TABS)[number];

const CUT_LABEL: Record<string, MessageKey> = {
  shelf: 'warehouse.report.cut.shelf',
  owner: 'warehouse.report.cut.owner',
  condition: 'warehouse.report.cut.condition',
  item_class: 'warehouse.report.cut.itemClass',
};

export function WarehouseConsole() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);

  const [log, setLog] = useState<string[]>([]);
  const append = useCallback((line: string) => setLog((prev) => [line, ...prev].slice(0, 20)), []);

  const [bins, setBins] = useState<Bin[]>([]);
  const [shelfRows, setShelfRows] = useState<ReportRow[] | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [inbound, setInbound] = useState<ParcelWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusParcelId, setFocusParcelId] = useState<string>('');
  const [queueVersion, setQueueVersion] = useState(0);
  const [openShelf, setOpenShelf] = useState<ShelfBin | null>(null);

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
      const [report, queue, workflow] = await Promise.all([
        api.get<{ rows: ReportRow[] } | ReportRow[]>('/custody/report?cut=shelf'),
        api.get<unknown[]>('/services/queue'),
        api.get<ParcelWorkflow>('/parcels/workflow/status'),
      ]);
      setShelfRows(Array.isArray(report) ? report : report.rows);
      setQueueCount(queue.length);
      setInbound(workflow);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setShelfRows([]);
    }
  }, []);

  const receiveParcels = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      try {
        await fn();
        append(ok);
        setQueueVersion((v) => v + 1);
        await loadSummary();
      } catch (e) {
        append(t('warehouse.log.intakeError', { message: (e as Error).message }));
      }
    },
    [append, loadSummary, t],
  );

  useEffect(() => {
    void loadBins();
    void loadSummary();
  }, [loadBins, loadSummary]);

  const stats = useMemo(() => {
    const rows = shelfRows ?? [];
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const inService = bins.filter((b) => b.active).length;
    return { total, inService };
  }, [shelfRows, bins]);

  const tabs = TABS.map((key) => ({ key, label: t(`warehouse.tab.${key}` as MessageKey) }));

  return (
    <div data-density="warehouse">
      <ContextTabs
        label={t('warehouse.title')}
        tabs={tabs}
        active={tab}
        onSelect={goTab}
        actions={
          <Button variant="secondary" icon={<IconPlus />} onClick={() => goTab('receiving')}>
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
              label={t('warehouse.metric.inboundBacklog')}
              value={inbound === null ? '—' : inbound.awaitingOpen + inbound.awaitingProcessing}
              icon={<IconAlert />}
              tone="amber"
              footer={
                inbound?.oldestWaitingHours != null ? (
                  <span className="hint">
                    {t('warehouse.metric.oldestWaiting', { hours: inbound.oldestWaitingHours })}
                  </span>
                ) : (
                  <ViewAllLink onClick={() => goTab('receiving')}>{t('warehouse.viewParcels')}</ViewAllLink>
                )
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
              value={stats.inService}
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
            {bins.length > 0 && shelfRows !== null ? (
              <ShelfMap bins={bins} counts={shelfRows} onOpen={setOpenShelf} t={t} />
            ) : (
              <InventoryRows
                rows={(shelfRows ?? []).slice(0, 6)}
                loading={shelfRows === null}
                cut="shelf"
                bins={bins}
                t={t}
              />
            )}
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

      {tab === 'receiving' && (
        <TabPanel tab="receiving">
          <ReceiveParcels onReceived={receiveParcels} />

          <ParcelQueue
            key={queueVersion}
            onChanged={loadSummary}
            onBookContents={(parcelId) => {
              setFocusParcelId(parcelId);
              requestAnimationFrame(() => {
                document
                  .getElementById('intake-bench')
                  ?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
              });
            }}
          />

          <Panel
            id="intake-bench"
            title={t('warehouse.intake.legend')}
            subtitle={t('warehouse.intake.subtitle')}
          >
            <IntakeBench
              initialParcelId={focusParcelId}
              onLog={append}
              onDone={async () => {
                await loadSummary();
                setQueueVersion((v) => v + 1);
              }}
              onParcelClosed={() => setFocusParcelId('')}
            />
          </Panel>

          <HouseOrdersPanel onLog={append} />

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
          <Panel title={t('warehouse.relocate.legend')} subtitle={t('warehouse.relocate.subtitle')}>
            <RelocateBench shelves={bins} onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.hold.legend')} subtitle={t('warehouse.hold.subtitle')}>
            <HoldBench onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.lots.legend')} flush>
            <LotsPanel onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.disposal.legend')} subtitle={t('warehouse.disposal.subtitle')}>
            <DisposalBench onLog={append} />
          </Panel>

          <InventoryTab bins={bins} t={t} />
        </TabPanel>
      )}

      {tab === 'shipments' && (
        <TabPanel tab="shipments">
          <Panel title={t('warehouse.fulfillShipment')} subtitle={t('warehouse.shipments.subtitle')}>
            <FulfillmentBench onLog={append} />
          </Panel>
        </TabPanel>
      )}

      {tab === 'locations' && (
        <TabPanel tab="locations">
          <BinsPanel bins={bins} reloadBins={loadBins} onLog={append} t={t} />
        </TabPanel>
      )}

      {tab === 'services' && (
        <TabPanel tab="services">
          <ServiceQueue onChanged={loadSummary} />
          <GradingSubmissions />
        </TabPanel>
      )}

      {tab === 'support' && (
        <TabPanel tab="support">
          <SupportQueue onChanged={loadSummary} />
        </TabPanel>
      )}

      {openShelf && <ShelfContents bin={openShelf} onClose={() => setOpenShelf(null)} />}
    </div>
  );
}

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
          <ButtonLink
            variant="primary"
            size="sm"
            icon={<IconDownload />}
            href={`/api/v1/custody/report.pdf?cut=${cut}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('warehouse.report.exportPdf')}
          </ButtonLink>
        </>
      }
    >
      {error && <div style={{ padding: 16 }}><ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} /></div>}
      <InventoryRows rows={rows ?? []} loading={rows === null} cut={cut} bins={bins} t={t} />
    </Panel>
  );
}

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
            {isShelf && <th scope="col">{t('warehouse.bins.kind')}</th>}
            {isShelf && <th scope="col">{t('admin.col.status')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const bin = row.key ? byId.get(row.key) : undefined;
            const used = row.count;
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
                  <td data-label={t('warehouse.bins.kind')}>
                    {bin ? t(bin.oversized ? 'warehouse.bins.kind.oversized' : 'warehouse.bins.kind.standard') : '—'}
                  </td>
                )}
                {isShelf && (
                  <td data-label={t('admin.col.status')}>
                    {!bin ? (
                      <StatusBadge>{t('warehouse.status.unshelved')}</StatusBadge>
                    ) : !bin.active ? (
                      <StatusBadge tone="warning">{t('warehouse.status.outOfService')}</StatusBadge>
                    ) : used === 0 ? (
                      <StatusBadge>{t('warehouse.status.empty')}</StatusBadge>
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

interface OpenLot {
  id: string;
  serialNumber: string;
  barcode: string;
  typeClass: string;
  description: string;
  lotSize: number;
}

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
              <td data-label={t('warehouse.intake.description')}>{itemName(t, lot)}</td>
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

function BinsPanel({
  bins,
  reloadBins,
  onLog,
  t,
}: {
  bins: Bin[];
  reloadBins: () => Promise<void>;
  onLog: (line: string) => void;
  t: TranslateFn;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function setActive(b: Bin, active: boolean) {
    setBusy(b.id);
    try {
      await api.patch(`/custody/bins/${b.id}`, { active });
      onLog(
        t(active ? 'warehouse.log.binReturned' : 'warehouse.log.binRetired', {
          serial: b.serialNumber,
        }),
      );
      await reloadBins();
    } catch (e) {
      onLog(t('warehouse.log.binCreateError', { message: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Panel title={t('warehouse.bins.legend')} subtitle={t('warehouse.bins.subtitle')}>
        <NewShelfBench onLog={onLog} onCreated={reloadBins} />
      </Panel>

      <Panel title={t('warehouse.metric.locations')} subtitle={t('warehouse.bins.listSubtitle')} flush>
        {bins.length === 0 ? (
          <EmptyState title={t('warehouse.bins.empty')} text={t('warehouse.bins.emptyText')} icon={<IconLocation />} />
        ) : (
          <div className="dt-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('warehouse.bins.colSerial')}</th>
                  <th scope="col">{t('warehouse.bins.colZone')}</th>
                  <th scope="col">{t('warehouse.bins.kind')}</th>
                  <th scope="col" className="td-end">
                    {t('warehouse.bins.colItems')}
                  </th>
                  <th scope="col">{t('admin.col.status')}</th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="barcode-label" dir="ltr">
                        <Barcode value={b.barcode} options={{ moduleWidth: 1, height: 34 }} />
                        <code>{b.serialNumber}</code>
                        <BarcodePrintButton value={b.barcode} caption={`Zone ${b.zone}`} />
                      </div>
                    </td>
                    <td data-label={t('warehouse.bins.colZone')}>
                      {b.zone}
                      {b.facilityCode && <span className="dt-sub">{b.facilityCode}</span>}
                    </td>
                    <td data-label={t('warehouse.bins.kind')}>
                      {t(b.oversized ? 'warehouse.bins.kind.oversized' : 'warehouse.bins.kind.standard')}
                    </td>
                    <td data-label={t('warehouse.bins.colItems')} className="td-end num">
                      {b.itemCount.toLocaleString()}
                    </td>
                    <td data-label={t('admin.col.status')}>
                      {!b.active ? (
                        <StatusBadge tone="warning">{t('warehouse.status.outOfService')}</StatusBadge>
                      ) : b.itemCount === 0 ? (
                        <StatusBadge>{t('warehouse.status.empty')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">{t('warehouse.status.inStock')}</StatusBadge>
                      )}
                    </td>
                    <td className="td-tight">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === b.id}
                        onClick={() => void setActive(b, !b.active)}
                      >
                        {t(b.active ? 'warehouse.bins.retire' : 'warehouse.bins.return')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
