import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../shared/i18n';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import {
  DISPOSAL_CATEGORIES,
  DISPOSAL_OUTCOMES,
} from '../../shared/itemClasses';
import { useRoute, useNavigation } from '../../shared/routing';
import { Barcode, BarcodePrintButton } from '../../shared/Barcode';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Field,
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
import { ReceiveParcels } from './ReceiveParcels';
import { IntakeBench } from './IntakeBench';
import { HouseOrdersPanel } from './HouseOrdersPanel';
import { SupportQueue } from './SupportQueue';
import type { InboundAddress, ParcelWorkflow } from '../../shared/parcels';
import { boxLabel } from '../../shared/carriers';

/**
 * A shelf, as the console sees one.
 *
 * `itemCount` is what replaced `capacity`. The difference is not cosmetic: the
 * old field was a number an operator typed once and nothing enforced, which the
 * console then divided into to draw a utilisation bar and an amber "near
 * capacity" badge that meant nothing. This is a count of what is actually on
 * the shelf. It informs; it does not adjudicate.
 */
interface Bin {
  id: string;
  /**
   * The shelf's identity, minted rather than named.
   *
   * It used to be `BIN-<zone>-<nnn>`, counted up per zone — a name, with a
   * name's problems: it raced between two operators building out the same zone,
   * it leaked how much shelving the building has, and it baked the zone into the
   * shelf's identity, so moving a shelf between zones meant renaming it and
   * invalidating the label stuck to it. The zone below is now purely a label.
   */
  serialNumber: string;
  barcode: string;
  zone: string;
  /** Oversized shelving — the kind that takes a sealed case, not a card. */
  oversized: boolean;
  /** A shelf out of service is never deleted, only stopped being stowed into. */
  active: boolean;
  itemCount: number;
  facilityId: string | null;
  facilityCode: string | null;
}

/** `GET /custody/bins/suggest` — where the system says to put the next thing. */
interface ReportRow {
  key: string | null;
  label: string | null;
  count: number;
}

/**
 * ONE RECEIVING TAB, not two.
 *
 * `parcels` and `intake` were separate tabs, and the split cut the single piece
 * of work they describe in half. Every intake begins with a parcel: a box is
 * received, it is opened, and its contents are booked in. Pressing "Book
 * contents" on the parcel bench SWITCHED TABS to a form on another screen, and
 * closing the box out happened over there too — so the operator moved back and
 * forth between two places to work through one box, and the count of what had
 * come out of it was visible on one of them at a time.
 *
 * They are now one tab that reads top to bottom the way the work goes: receive
 * the stack, see the queue, book the contents of the box you are holding, close
 * it out. Nothing navigates; "Book contents" points the bench below at that box.
 *
 * What moved to `inventory` — relocate, hold, break-lot, disposal — is work on
 * cards that are ALREADY on a shelf. It was on the intake tab only because that
 * is where the scan fields happened to live.
 */
const TABS = ['overview', 'receiving', 'inventory', 'shipments', 'locations', 'services', 'support'] as const;
type WarehouseTab = (typeof TABS)[number];

const CUT_LABEL: Record<string, MessageKey> = {
  shelf: 'warehouse.report.cut.shelf',
  owner: 'warehouse.report.cut.owner',
  condition: 'warehouse.report.cut.condition',
  item_class: 'warehouse.report.cut.itemClass',
};

/**
 * Warehouse console (T054), rebuilt on the shared application shell.
 *
 * The rail, header and workspace are exactly the ones every other section uses;
 * only the contextual tabs below the title belong to the warehouse.
 *
 * The inbound half of it now reads left to right the way the physical work
 * does: a box arrives and is received, it is opened and checked, its contents
 * are booked in one unit at a time onto a shelf the system directs the operator
 * to, and the box is closed out against the count of what came out of it. What
 * is gone is the arrangement where booking contents in meant leaving the parcel
 * bench for a different tab, choosing a shelf from a dropdown of every shelf in
 * the company, and coming back to close the box with nothing checking that
 * anything had been booked at all.
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
  const [inbound, setInbound] = useState<ParcelWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The parcel the operator is working through, set by "Book contents" on the
   * parcel bench and read by the intake panel.
   *
   * It is held here rather than in either panel because it is the one piece of
   * state the two share: pressing Book contents on a box has to open the intake
   * form already pointed at that box, which is the whole difference between one
   * workflow and two screens that happen to be adjacent.
   */
  const [focusParcelId, setFocusParcelId] = useState<string>('');
  /**
   * Bumped after a batch of arrivals is booked in, to remount the queue below.
   *
   * Receiving used to live INSIDE the queue component, so it could just reload
   * itself. It is its own panel now — the two are different jobs at the same
   * bench — and this is the one thread between them: boxes were received, so the
   * list of boxes is stale.
   */
  const [queueVersion, setQueueVersion] = useState(0);

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

  /**
   * Run a receive and refresh what it invalidated.
   *
   * Shaped like the queue's own `act` so the receiving panel does not have to
   * know anything about the console: hand it a call and a sentence, and it
   * reports whichever of the two happened.
   */
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

  /**
   * Items in stock, and how much shelving is in service.
   *
   * There is no "bins near capacity" figure any more, and there is nothing to
   * put in its place derived from bins — a shelf has no fullness the database
   * knows about. The honest "act now" number on an inbound bench is the backlog
   * of boxes, which is what the overview shows instead.
   */
  const stats = useMemo(() => {
    const rows = shelfRows ?? [];
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const inService = bins.filter((b) => b.active).length;
    return { total, inService };
  }, [shelfRows, bins]);

  const tabs = TABS.map((key) => ({ key, label: t(`warehouse.tab.${key}` as MessageKey) }));

  return (
    /*
      The whole console runs at WAREHOUSE density.

      This screen is worked standing up, one hand on a scanner, and it was set at
      exactly the same rhythm as the wallet: 24px panel padding, 16px field gaps,
      56px table rows. The receiving bench needed three panels and 1,900px of
      scroll to do one job.

      `data-density` swaps four variables — panel padding, section gap, group
      gap, row height — and drops the base size to 13px. Nothing else changes:
      the same Panel, the same Register, the same Field, measured for the job
      instead of rewritten for it.
    */
    <div data-density="warehouse">
      <ContextTabs
        label={t('warehouse.title')}
        tabs={tabs}
        active={tab}
        onSelect={goTab}
        actions={
          /* Secondary, not primary. The bench below has the primary action of
             every screen it appears on, and two gold buttons on one screen is
             the same as none. */
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

      {tab === 'receiving' && (
        <TabPanel tab="receiving">
          {/* 1. The stack that just came off the van. */}
          <ReceiveParcels onReceived={receiveParcels} />

          {/* 2. What is on the bench, and what each box needs next. */}
          <ParcelQueue
            key={queueVersion}
            onChanged={loadSummary}
            onBookContents={(parcelId) => {
              setFocusParcelId(parcelId);
              // Same page, so the bench below is brought into view rather than
              // the operator being moved to it.
              requestAnimationFrame(() => {
                // Optional-called: bringing the bench into view is a courtesy,
                // and an environment without smooth scrolling (or a bench that
                // has not painted yet) must not take the click down with it.
                document
                  .getElementById('intake-bench')
                  ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
              });
            }}
          />

          {/* 3. Emptying the box, and closing it out at the end of that. */}
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
                /*
                 * The BOX is stale too, not only the counters.
                 *
                 * Booking a unit out of a parcel changes that parcel's row —
                 * its unit count, and the line under its button that reads
                 * "Nothing has come out of this parcel yet". Only `loadSummary`
                 * ran here, so after an intake the queue still said nothing had
                 * come out of the box while the bench three inches below it said
                 * one unit had. Two statements about the same box, contradicting
                 * each other on one screen.
                 */
                setQueueVersion((v) => v + 1);
              }}
              onParcelClosed={() => setFocusParcelId('')}
            />
          </Panel>

          {/* 4. Cards sold from the Bault store: on the record already, still in
              the store's box. Label them and put them on a shelf. */}
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
          {/*
            Work on cards ALREADY on a shelf. It sat on the intake tab only
            because that is where the scan fields happened to live, and it made
            the receiving bench a page of five unrelated forms.
          */}
          <Panel title={t('warehouse.relocate.legend')} subtitle={t('warehouse.relocate.subtitle')}>
            <RelocatePanel onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.hold.legend')} subtitle={t('warehouse.hold.subtitle')}>
            <HoldPanel onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.lots.legend')} flush>
            <LotsPanel onLog={append} onDone={loadSummary} />
          </Panel>

          <Panel title={t('warehouse.disposal.legend')} subtitle={t('warehouse.disposal.subtitle')}>
            <DisposalPanel onLog={append} />
          </Panel>

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
          <BinsPanel bins={bins} reloadBins={loadBins} onLog={append} t={t} />
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
    </div>
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
 * operator sees where the shelf is, what kind of shelving it is, and whether it
 * is still in service — the three things that decide whether more goods can go
 * there. What it no longer shows is a utilisation ratio, because the denominator
 * it was drawn against was a number nobody enforced.
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

/* ============================================================
   Intake
   ============================================================ */

/**
 * Move something that is already in the vault to another shelf.
 *
 * Both fields take what a scanner produces. The item field accepts the SN-
 * barcode printed on the item's own label (or its serial); the shelf field
 * accepts the BIN- barcode on the shelf. Before this, both ends of a relocate
 * demanded the internal id — a string that is printed on nothing — so the one
 * way this form could not be driven was with the scanner it was named after.
 */
function RelocatePanel({
  onLog,
  onDone,
}: {
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [scanItem, setScanItem] = useState('');
  const [scanBin, setScanBin] = useState('');

  async function relocate() {
    try {
      await api.post(`/custody/items/${encodeURIComponent(scanItem.trim())}/relocate`, {
        binId: scanBin.trim(),
      });
      onLog(t('warehouse.log.relocateDone', { item: scanItem, bin: scanBin }));
      setScanItem('');
      setScanBin('');
      await onDone();
    } catch (e) {
      onLog(t('warehouse.log.relocateError', { message: (e as Error).message }));
    }
  }

  return (
    <div className="form-grid row-baseline">
      <Field label={t('warehouse.relocate.scanItem')} hint={t('warehouse.relocate.scanItemHint')}>
        <input value={scanItem} onChange={(e) => setScanItem(e.target.value)} placeholder="SN-…" dir="ltr" />
      </Field>
      <Field label={t('warehouse.relocate.scanShelf')} hint={t('warehouse.relocate.scanShelfHint')}>
        <input value={scanBin} onChange={(e) => setScanBin(e.target.value)} placeholder="BIN-XXXXXXXX" dir="ltr" />
      </Field>
      <div className="field">
        <span className="field-label" aria-hidden="true">
          &nbsp;
        </span>
        <Button
          variant="navy"
          icon={<IconScan />}
          disabled={!scanItem.trim() || !scanBin.trim()}
          onClick={relocate}
        >
          {t('warehouse.relocate.submit')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Place or lift a hold, by scan.
 *
 * Shaped like `RelocatePanel` deliberately: it is the same gesture at the same
 * bench — scan the card, press the thing. The two actions sit side by side
 * rather than behind a toggle, because an operator holding a card knows which
 * one they mean and a toggle would make them read before acting.
 *
 * The API is idempotent and now says so, so scanning a card that is already
 * frozen reports that it was already frozen instead of claiming the hold was
 * just placed.
 */
function HoldPanel({
  onLog,
  onDone,
}: {
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [scanItem, setScanItem] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(hold: boolean) {
    const id = scanItem.trim();
    setBusy(true);
    try {
      const path = `/custody/items/${encodeURIComponent(id)}/hold`;
      const res = hold
        ? await api.post<{ changed: boolean }>(path)
        : await api.del<{ changed: boolean }>(path);
      onLog(
        t(
          res.changed
            ? hold
              ? 'warehouse.log.holdPlaced'
              : 'warehouse.log.holdReleased'
            : hold
              ? 'warehouse.log.holdAlready'
              : 'warehouse.log.holdNone',
          { item: id },
        ),
      );
      setScanItem('');
      await onDone();
    } catch (e) {
      onLog(t('warehouse.log.holdError', { message: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-grid row-baseline">
      <Field label={t('warehouse.hold.scanItem')} hint={t('warehouse.hold.scanItemHint')}>
        <input value={scanItem} onChange={(e) => setScanItem(e.target.value)} placeholder="SN-…" dir="ltr" />
      </Field>
      <div className="field">
        <span className="field-label" aria-hidden="true">
          &nbsp;
        </span>
        <div className="actions">
          <Button
            variant="secondary"
            icon={<IconAlert />}
            disabled={busy || !scanItem.trim()}
            onClick={() => void act(true)}
          >
            {t('warehouse.hold.place')}
          </Button>
          <Button variant="ghost" disabled={busy || !scanItem.trim()} onClick={() => void act(false)}>
            {t('warehouse.hold.release')}
          </Button>
        </div>
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
  boxSize: string | null;
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
          {/* The collector was quoted for this box. Packing it in a bigger one
              ships a parcel that costs more than they paid. */}
          <p className="field-hint">
            {detail.boxSize
              ? t('warehouse.dispatch.packIn', { box: boxLabel(t, { key: detail.boxSize }) })
              : t('warehouse.dispatch.anyBox')}
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

/**
 * Shelving.
 *
 * Creating one asks for the two things the stow assignment needs, plus the zone
 * label: which building the shelf is in, and whether it is oversized storage.
 *
 * It used to ask for two more. A CAPACITY, which nothing enforced and which the
 * table then drew a utilisation bar against — a number that produced a red badge
 * and no decision. And a BARCODE, which is why shelves ended up called
 * `BIN-A-001`: given a field, an operator names the thing. The serial is minted
 * by the API now and cannot be typed, because a shelf that can be named is a
 * shelf whose identity encodes a zone it might be moved out of and an ordinal
 * that races the next operator to claim it.
 *
 * A shelf is never deleted: items reference their bin forever, and the transfer
 * ledger references bins that items left long ago. Taking one out of service is
 * a flag. It keeps everything it holds, stops being handed out by the directed
 * stow, and empties as its contents are picked.
 */
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
  const [zone, setZone] = useState('');
  const [oversized, setOversized] = useState(false);
  const [facilityCode, setFacilityCode] = useState('');
  const [facilities, setFacilities] = useState<InboundAddress[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<InboundAddress[]>('/me/inbound-addresses');
        // Only a storing site can hold a shelf. A forwarding facility holds
        // nothing by definition — everything that lands there is sent onward —
        // so offering one here would invite a bin in a building with no shelves.
        const storing = list.filter((f) => f.role === 'primary');
        setFacilities(storing);
        if (storing[0]) setFacilityCode(storing[0].code);
      } catch {
        /* the API defaults a new bin to the primary facility on its own */
      }
    })();
  }, []);

  async function create() {
    try {
      const bin = await api.post<Bin>('/custody/bins', {
        zone,
        facilityCode: facilityCode || undefined,
        oversized,
      });
      onLog(t('warehouse.log.binCreated', { serial: bin.serialNumber, zone: bin.zone }));
      setZone('');
      setOversized(false);
      await reloadBins();
    } catch (e) {
      onLog(t('warehouse.log.binCreateError', { message: (e as Error).message }));
    }
  }

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
        <div className="form-grid row-baseline">
          <label className="field">
            <span className="field-label">{t('warehouse.bins.zone')}</span>
            <input value={zone} onChange={(e) => setZone(e.target.value)} />
          </label>
          {facilities.length > 1 && (
            <label className="field">
              <span className="field-label">{t('warehouse.bins.facility')}</span>
              <select value={facilityCode} onChange={(e) => setFacilityCode(e.target.value)}>
                {facilities.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="field">
            <span className="field-label" aria-hidden="true">
              &nbsp;
            </span>
            <label className="check">
              <input
                type="checkbox"
                checked={oversized}
                onChange={(e) => setOversized(e.target.checked)}
              />
              {t('warehouse.bins.oversized')}
            </label>
          </div>
          <div className="field">
            <span className="field-label" aria-hidden="true">
              &nbsp;
            </span>
            <Button variant="gold" icon={<IconPlus />} disabled={!zone} onClick={create}>
              {t('warehouse.bins.create')}
            </Button>
          </div>
        </div>
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
                    {/* Shelf labels get printed and stuck on the physical bin. The
                        serial is printed under the bars because it is what an
                        operator reads out when the scanner will not read. */}
                    <td dir="ltr">
                      <div className="barcode-label">
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
