import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { formatDate, formatUsd } from '../../../shared/money';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { useVaultItems } from '../../../shared/useVaultItems';
import { serviceStatusLabel, serviceTypeLabel } from '../../../shared/serviceLabels';
import {
  disposalCategoryLabel,
  disposalOutcomeLabel,
  type ArrivalDisposal,
} from '../../../shared/itemClasses';
import { useNavigation, useRoute } from '../../../shared/routing';
import {
  SHIPMENT_TONE,
  carrierTrackingUrl,
  matchesShipmentSearch,
  shipmentStatusLabel,
  type ShipmentSummary,
} from '../../../shared/shipments';
import { serviceLabel, transitLabel, type QuotedRate } from '../../../shared/carriers';
import { itemClassLabel } from '../../../shared/itemClasses';
import {
  Button,
  ContextTabs,
  DetailRow,
  EmptyState,
  ErrorState,
  MetricCard,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  TabPanel,
  type StatusTone,
} from '../../../shared/ui/primitives';
import { DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { ShipmentComposer } from './ShipmentComposer';
import { SharedParcelsTab } from './SharedParcelsTab';
import { ShowPickupPanel, WhiteGlovePanel, WhiteGloveQuotes } from './HumanFulfilmentPanels';
import {
  IconAlert,
  IconArchive,
  IconBox,
  IconClock,
  IconScan,
  IconServices,
  IconShipping,
} from '../../../shared/ui/icons';

/**
 * Shipping & Services — the merged operational section.
 *
 * Services stopped being a section of its own. Ordering a service is a thing you
 * do TO A CARD, so it now lives in the Vault card drawer; what remains here is
 * the operational half: getting cards out of the vault, following them, and the
 * ledger of every service request raised against them.
 *
 * Every tab is backed by a real endpoint. There is no "Tracking" that invents
 * carrier scan events and no "History" that shows placeholder rows: tracking is
 * `GET /shipping/shipments/:id` (owner-scoped) and history is the terminal half
 * of `GET /services/mine`.
 */
const TABS = ['overview', 'shipping', 'in-person', 'tracking', 'shared', 'requests', 'history', 'not-accepted'] as const;
type SsTab = (typeof TABS)[number];

const STATUS_TONE: Record<string, StatusTone> = {
  requested: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
};

/** Service requests that are still moving; everything else is history. */
const OPEN_STATUSES = new Set(['requested', 'in_progress']);

/* The shipment status→tone map moved to `shared/shipments.ts` with the rest of
   the tracking vocabulary. The copy that used to live here listed statuses the
   API's enum does not have (`dispatched`, `cancelled`) and omitted ones it does
   (`picking`, `packed`, `labeled`, `in_transit`, `exception`). */

interface MyRequest {
  id: string;
  type: string;
  status: string;
  itemId: string | null;
  /** The card it is about, so a row can say which one. */
  itemSerial?: string | null;
  itemDescription?: string | null;
  createdAt: string;
  typeFields: Record<string, unknown> | null;
}

/**
 * A custom request's status, by what the COLLECTOR is waiting for.
 *
 * The generic status said "Approved" the moment an operator picked the request
 * up — before any price existed, let alone one the collector had agreed to —
 * while the step beside it said "You accepted". Custom requests are read by
 * their stage instead.
 */
const CUSTOM_STAGE: Record<string, { key: MessageKey; tone: StatusTone }> = {
  awaiting_quote: { key: 'custom.stage.awaitingQuote', tone: 'warning' },
  quoted: { key: 'custom.stage.quoted', tone: 'gold' },
  accepted: { key: 'custom.stage.accepted', tone: 'info' },
  done: { key: 'custom.stage.done', tone: 'success' },
  declined: { key: 'custom.stage.declined', tone: 'error' },
  quote_declined: { key: 'custom.stage.quoteDeclined', tone: 'neutral' },
};

interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  country: string;
  postalCode: string;
  isDefault: boolean;
}

/* `ShipmentDetail` was this page's private copy of one shipment. The tracking
   list and its drawer now share `ShipmentSummary` from shared/shipments.ts, so
   the two views cannot drift apart in what they claim a shipment has. */

/** One-line rendering of a saved address, also persisted with the shipment. */
export function formatAddress(a: Address): string {
  return [a.recipient, a.line1, a.line2, a.city, [a.region, a.postalCode].filter(Boolean).join(' '), a.country]
    .filter((part) => part && part.trim() !== '')
    .join(', ');
}

export function ShippingServicesPage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab, openRecord, closeRecord } = useNavigation(route);

  const { items, error: itemsError, reload } = useVaultItems(true);
  const [requests, setRequests] = useState<MyRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /**
   * Bumped when a shipment is created, so the tracking list refetches and the
   * new shipment is there the moment the user switches to that tab. The list
   * would show it on its own next load anyway — this only removes the wait.
   */
  const [shipmentsVersion, setShipmentsVersion] = useState(0);

  const tab: SsTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as SsTab)
    : 'overview';

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await api.get<MyRequest[]>('/services/mine'));
    } catch (e) {
      setError((e as Error).message);
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const open = (requests ?? []).filter((r) => OPEN_STATUSES.has(r.status));
  const past = (requests ?? []).filter((r) => !OPEN_STATUSES.has(r.status));

  const tabs = TABS.map((key) => ({ key, label: t(`ss.tab.${key}` as MessageKey) }));

  return (
    <>
      <ContextTabs label={t('shippingServices.title')} tabs={tabs} active={tab} onSelect={goTab} />

      {status && <SuccessNote>{status}</SuccessNote>}
      {(error || itemsError) && <ErrorState message={error ?? itemsError ?? ''} />}

      {tab === 'overview' && (
        <TabPanel tab="overview">
          <div className="metric-grid">
            <MetricCard
              label={t('ss.metric.shippable')}
              value={items.length}
              icon={<IconBox />}
              tone="green"
              footer={t('ss.metric.shippableNote')}
            />
            <MetricCard
              label={t('ss.metric.openRequests')}
              value={open.length}
              icon={<IconClock />}
              tone="amber"
              footer={t('ss.metric.openRequestsNote')}
            />
            <MetricCard
              label={t('ss.metric.pastRequests')}
              value={past.length}
              icon={<IconArchive />}
              tone="violet"
              footer={t('ss.metric.pastRequestsNote')}
            />
          </div>

          <Panel title={t('ss.overview.title')} subtitle={t('ss.overview.subtitle')}>
            <ul className="card-grid">
              <li className="card">
                <span className="metric-icon metric-icon--blue">
                  <IconShipping />
                </span>
                <h3 className="card-title">{t('ss.tab.shipping')}</h3>
                <p className="card-desc card-desc--full">{t('ss.overview.shippingDesc')}</p>
                <div className="actions">
                  <Button size="sm" variant="gold" block onClick={() => goTab('shipping')}>
                    {t('ss.overview.goShipping')}
                  </Button>
                </div>
              </li>
              <li className="card">
                <span className="metric-icon metric-icon--blue">
                  <IconScan />
                </span>
                <h3 className="card-title">{t('ss.tab.tracking')}</h3>
                <p className="card-desc card-desc--full">{t('ss.overview.trackingDesc')}</p>
                <div className="actions">
                  <Button size="sm" variant="secondary" block onClick={() => goTab('tracking')}>
                    {t('ss.overview.goTracking')}
                  </Button>
                </div>
              </li>
              <li className="card">
                <span className="metric-icon metric-icon--blue">
                  <IconServices />
                </span>
                <h3 className="card-title">{t('ss.tab.requests')}</h3>
                {/* Says where ordering moved to, so the merge does not read as
                    a removed feature. */}
                <p className="card-desc card-desc--full">{t('ss.overview.requestsDesc')}</p>
                <div className="actions">
                  <Button size="sm" variant="secondary" block onClick={() => goTab('requests')}>
                    {t('ss.overview.goRequests')}
                  </Button>
                </div>
              </li>
            </ul>
          </Panel>
        </TabPanel>
      )}

      {tab === 'shipping' && (
        <TabPanel tab="shipping">
          <ShipmentComposer
            items={items}
            onError={setError}
            onStatus={setStatus}
            onCreated={() => {
              setShipmentsVersion((v) => v + 1);
              void reload();
            }}
          />
        </TabPanel>
      )}

      {/* The two routes out of the vault that are a person rather than a
          parcel. Kept off the main Shipping tab on purpose: neither has a rate
          to select, and folding them into a carrier flow would make the carrier
          flow answer questions it does not have. */}
      {tab === 'in-person' && (
        <TabPanel tab="in-person">
          <ShowPickupPanel
            items={items}
            onError={setError}
            onStatus={setStatus}
            onCreated={() => {
              setShipmentsVersion((v) => v + 1);
              void reload();
            }}
          />
          <WhiteGloveQuotes
            reloadToken={shipmentsVersion}
            onError={setError}
            onStatus={setStatus}
            onChanged={() => setShipmentsVersion((v) => v + 1)}
          />
          <WhiteGlovePanel
            items={items}
            onError={setError}
            onStatus={setStatus}
            onCreated={() => {
              setShipmentsVersion((v) => v + 1);
              void reload();
            }}
          />
        </TabPanel>
      )}

      {tab === 'tracking' && (
        <TabPanel tab="tracking">
          {/* The open shipment lives in the URL, so Back closes the drawer
              before it leaves the page (Requirement 37). */}
          <TrackingTab
            reloadToken={shipmentsVersion}
            openId={route.params.shipment ?? null}
            onOpen={(id) => openRecord('shipment', id)}
            onClose={() => closeRecord('shipment')}
            onStatus={setStatus}
            onPageError={setError}
          />
        </TabPanel>
      )}

      {tab === 'shared' && (
        <TabPanel tab="shared">
          <SharedParcelsTab
            reloadToken={shipmentsVersion}
            onChanged={() => setShipmentsVersion((v) => v + 1)}
            onError={setError}
            onStatus={setStatus}
          />
        </TabPanel>
      )}

      {tab === 'requests' && (
        <TabPanel tab="requests">
          <RequestTable
            requests={requests === null ? null : open}
            title={t('ss.requests.openTitle')}
            subtitle={t('ss.requests.openSubtitle')}
            emptyTitle={t('ss.requests.noneOpen')}
            emptyText={t('ss.requests.noneOpenText')}
            onChanged={async (m) => {
              setStatus(m);
              await loadRequests();
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {tab === 'history' && (
        <TabPanel tab="history">
          <RequestTable
            requests={requests === null ? null : past}
            title={t('ss.history.title')}
            subtitle={t('ss.history.subtitle')}
            emptyTitle={t('ss.history.none')}
            emptyText={t('ss.history.noneText')}
          />
        </TabPanel>
      )}

      {tab === 'not-accepted' && (
        <TabPanel tab="not-accepted">
          <NotAcceptedTable />
        </TabPanel>
      )}
    </>
  );
}

/* ============================================================
   Arrivals that were not accepted
   ============================================================ */

/**
 * Things that arrived addressed to the signed-in collector and never reached
 * their vault — a prohibited item, a tracker found in a parcel, or something
 * given away because processing it cost more than it was worth.
 *
 * It lives here rather than in the Vault because these are precisely the things
 * that are NOT in the vault: rendering them in a grid of card photographs, next
 * to items the collector owns, would suggest they are holdings. This section
 * already holds the operational record of what happened to a collector's
 * property, which is what these are.
 *
 * Read-only by construction. The rows are append-only server-side, and there is
 * no action to offer — the decision was made at a warehouse bench and cannot be
 * undone from a screen.
 */
function NotAcceptedTable() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ArrivalDisposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<ArrivalDisposal[]>('/me/disposals'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={t('ss.notAccepted.title')} subtitle={t('ss.notAccepted.subtitle')} flush>
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      {rows === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('ss.notAccepted.empty')}
          text={t('ss.notAccepted.emptyText')}
          icon={<IconAlert />}
        />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <caption>{t('ss.notAccepted.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('ss.notAccepted.col.item')}</th>
                <th scope="col">{t('ss.notAccepted.col.reason')}</th>
                <th scope="col">{t('ss.notAccepted.col.outcome')}</th>
                <th scope="col">{t('ss.notAccepted.col.date')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('ss.notAccepted.col.item')} className="dt-primary">
                    {row.description}
                    <span className="dt-sub" dir="ltr">
                      {row.code}
                    </span>
                  </td>
                  <td data-label={t('ss.notAccepted.col.reason')}>
                    <StatusBadge tone="warning">
                      {disposalCategoryLabel(t, row.category)}
                    </StatusBadge>
                    {/* The operator's account of the decision. It is the whole
                        reason the record exists, so it is shown, not hidden
                        behind a drawer. */}
                    <span className="dt-sub">{row.notes}</span>
                  </td>
                  <td data-label={t('ss.notAccepted.col.outcome')}>
                    {disposalOutcomeLabel(t, row.outcome)}
                  </td>
                  <td data-label={t('ss.notAccepted.col.date')} dir="ltr">
                    {formatDate(row.occurredAt, locale)}
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

/* ============================================================
   Shipping — create a shipment request and pick a carrier rate
   ============================================================ */

/* ============================================================
   Tracking — every shipment of the signed-in user
   ============================================================ */

/**
 * The Shipment Tracking tab.
 *
 * This used to be a lookup: paste a shipment id, get one shipment. It is now a
 * LIST, backed by `GET /shipping/shipments`, and nothing has to be pasted
 * anywhere. A shipment created on the Shipping tab appears here the moment it is
 * created — there is no separate "add to tracking" step, because appearing here
 * is simply what having a shipment means.
 *
 * Authorization is the endpoint's, not this component's: the API returns exactly
 * the shipments the caller may see (their own, or all of them for staff), so
 * there is no client-side filter that could be widened by accident.
 *
 * Status is whatever the API last recorded. The worker's tracking-refresh job
 * polls the carrier and updates the row, so reloading this tab shows the current
 * state without anyone re-entering anything.
 */
function TrackingTab({
  reloadToken,
  openId,
  onOpen,
  onClose,
  onStatus,
  onPageError,
}: {
  /** Bumped by the Shipping tab after a create, so the list refetches. */
  reloadToken: number;
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onStatus: (m: string | null) => void;
  onPageError: (m: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const [shipments, setShipments] = useState<ShipmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setShipments(await api.get<ShipmentSummary[]>('/shipping/shipments'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setShipments([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const rows = useMemo(
    () => (shipments ?? []).filter((shipment) => matchesShipmentSearch(shipment, query)),
    [shipments, query],
  );

  const selected = useMemo(
    () => (shipments ?? []).find((shipment) => shipment.id === openId) ?? null,
    [shipments, openId],
  );

  return (
    <>
      <Panel
        title={t('ss.tracking.title')}
        subtitle={t('ss.tracking.subtitle')}
        flush
        tools={
          <div className="search search--wide">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ss.tracking.searchPlaceholder')}
              aria-label={t('ss.tracking.searchLabel')}
            />
          </div>
        }
      >
        {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

        {shipments === null ? (
          <SkeletonTable rows={4} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={query ? t('ss.tracking.noMatches') : t('ss.tracking.empty')}
            text={query ? t('ss.tracking.noMatchesText') : t('ss.tracking.emptyText')}
            icon={<IconScan />}
          />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <caption>{t('ss.tracking.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('ss.tracking.col.recipient')}</th>
                  <th scope="col">{t('ss.tracking.col.username')}</th>
                  <th scope="col">{t('ss.tracking.col.created')}</th>
                  <th scope="col">{t('ss.tracking.col.carrier')}</th>
                  <th scope="col">{t('ss.tracking.col.trackingNumber')}</th>
                  <th scope="col">{t('ss.tracking.col.status')}</th>
                  <th scope="col">{t('ss.tracking.col.eta')}</th>
                  <th scope="col">{t('ss.tracking.col.updated')}</th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {rows.map((shipment) => (
                  <tr
                    key={shipment.id}
                    className={'is-clickable' + (shipment.id === openId ? ' is-selected' : '')}
                    tabIndex={0}
                    onClick={() => onOpen(shipment.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(shipment.id);
                      }
                    }}
                  >
                    <td data-label={t('ss.tracking.col.recipient')} className="dt-primary">
                      {shipment.recipientName || shipment.customerName || '—'}
                      {shipment.code && (
                        <span className="dt-sub" dir="ltr">
                          {shipment.code}
                        </span>
                      )}
                    </td>
                    <td data-label={t('ss.tracking.col.username')} dir="ltr">
                      {shipment.username ? <code>{shipment.username}</code> : '—'}
                    </td>
                    <td data-label={t('ss.tracking.col.created')}>
                      <span dir="ltr">{formatDate(shipment.createdAt, locale)}</span>
                    </td>
                    <td data-label={t('ss.tracking.col.carrier')}>
                      {shipment.carrier ?? '—'}
                      {shipment.serviceLevel && <span className="dt-sub">{shipment.serviceLevel}</span>}
                    </td>
                    <td data-label={t('ss.tracking.col.trackingNumber')}>
                      {/* Supplied by the carrier. Nothing here is an internal id,
                          and nothing has to be typed to reach this row. */}
                      {shipment.trackingNumber ? (
                        <TrackingNumber carrier={shipment.carrier} number={shipment.trackingNumber} />
                      ) : (
                        <span className="muted">{t('ss.tracking.noTrackingYet')}</span>
                      )}
                    </td>
                    <td data-label={t('ss.tracking.col.status')}>
                      <StatusBadge tone={SHIPMENT_TONE[shipment.status] ?? 'neutral'}>
                        {shipmentStatusLabel(t, shipment.status)}
                      </StatusBadge>
                    </td>
                    <td data-label={t('ss.tracking.col.eta')}>
                      {/* "—" until a rate is chosen: showing a date the carrier
                          never quoted would be an invention. */}
                      {shipment.estimatedDeliveryAt ? (
                        <span dir="ltr">{formatDate(shipment.estimatedDeliveryAt, locale)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td data-label={t('ss.tracking.col.updated')}>
                      <span dir="ltr">
                        {formatDate(shipment.updatedAt ?? shipment.createdAt, locale)}
                      </span>
                    </td>
                    <td className="td-tight">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(shipment.id);
                        }}
                      >
                        {t('ss.tracking.details')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <ShipmentDrawer
          shipment={selected}
          others={shipments ?? []}
          locale={locale}
          t={t}
          onClose={onClose}
          onChanged={() => void load()}
          onError={onPageError}
          onStatus={onStatus}
        />
      )}
    </>
  );
}

/** A carrier tracking number that opens the carrier's own tracking page. */
function TrackingNumber({ carrier, number }: { carrier: string | null; number: string }) {
  const url = carrierTrackingUrl(carrier, number);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      <code dir="ltr">{number}</code>
    </a>
  ) : (
    <code dir="ltr">{number}</code>
  );
}

/** `GET /shipping/shipments/:id` — the summary plus each item by serial. */
interface ShipmentDetail extends ShipmentSummary {
  items: { id: string; serialNumber: string; barcode: string; description: string | null }[];
}

/** One shipment in full. Opened from the list; never from a typed identifier. */
function ShipmentDrawer({
  shipment,
  others,
  locale,
  t,
  onClose,
  onChanged,
  onError,
  onStatus,
}: {
  shipment: ShipmentSummary;
  /** The collector's other shipments — a request can be combined with another. */
  others: ShipmentSummary[];
  locale: string;
  t: TranslateFn;
  onClose: () => void;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  /** Which of the request's own tools is open: choose a service, edit it, or the invoice. */
  const [mode, setMode] = useState<'none' | 'choose' | 'edit' | 'invoice'>('none');
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  /**
   * What cancelling would cost, fetched so the warning can name it.
   *
   * Loaded lazily and only when the drawer is open — it is one small published
   * constant, and asking for it on every list render would be a request per card
   * for a number that does not change.
   */
  const [restockingFeeMinor, setRestockingFeeMinor] = useState<number | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const svc = await api.get<{ restockingFeeMinor: number }>('/shipping/services');
        setRestockingFeeMinor(svc.restockingFeeMinor ?? null);
      } catch {
        /* the warning falls back to an em dash; cancelling still works */
      }
    })();
  }, []);

  // The list row says how many cards; the drawer says which.
  useEffect(() => {
    let live = true;
    void api
      .get<ShipmentDetail>(`/shipping/shipments/${shipment.id}`)
      .then((d) => live && setDetail(d))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [shipment.id, shipment.updatedAt]);

  /**
   * A request that has not been picked can be called off for nothing; one that
   * was already paid for costs the restocking fee. Both are the server's rule —
   * this only decides whether to show the button at all.
   */
  const cancellable = ['requested', 'awaiting_payment', 'rates_selected'].includes(shipment.status);
  const payable = shipment.status === 'awaiting_payment';
  /** Still a request: no service, nothing charged, so it can be changed. */
  const open = shipment.status === 'requested' && !shipment.mergedIntoShipmentId;
  const carrierShipment = (shipment.fulfilmentMethod ?? 'carrier') === 'carrier';
  const international = shipment.destinationCountry !== 'US';

  async function act(fn: () => Promise<unknown>, ok: string, close = true) {
    setBusy(true);
    try {
      await fn();
      onStatus(ok);
      onError(null);
      onChanged();
      if (close) onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <DetailDrawer
      title={shipment.code ?? t('ss.tracking.details')}
      subtitle={shipmentStatusLabel(t, shipment.status)}
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('ui.close')}
        </Button>
      }
    >
      <dl className="detail-list">
        <DetailRow label={t('ss.tracking.status')}>
          <StatusBadge tone={SHIPMENT_TONE[shipment.status] ?? 'neutral'}>
            {shipmentStatusLabel(t, shipment.status)}
          </StatusBadge>
        </DetailRow>
        <DetailRow label={t('ss.tracking.col.recipient')}>
          {shipment.recipientName || shipment.customerName || '—'}
        </DetailRow>
        <DetailRow label={t('ss.tracking.trackingNumber')}>
          {shipment.trackingNumber ? (
            <TrackingNumber carrier={shipment.carrier} number={shipment.trackingNumber} />
          ) : (
            <span className="hint">{t('ss.tracking.noTrackingYet')}</span>
          )}
        </DetailRow>
        <DetailRow label={t('ss.tracking.carrier')}>
          {shipment.carrier ? (shipment.carrier + ' · ' + (shipment.serviceLevel ?? '')).trim() : '—'}
        </DetailRow>
        <DetailRow label={t('ss.tracking.col.eta')}>
          {shipment.estimatedDeliveryAt ? (
            <span dir="ltr">{formatDate(shipment.estimatedDeliveryAt, locale)}</span>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label={t('ss.tracking.cost')}>
          {shipment.cost === null ? '—' : <span dir="ltr">{formatUsd(shipment.cost)}</span>}
        </DetailRow>
        <DetailRow label={t('ss.tracking.destination')}>{shipment.destinationAddress}</DetailRow>
        <DetailRow label={t('ss.tracking.created')}>
          <span dir="ltr">{formatDate(shipment.createdAt, locale)}</span>
        </DetailRow>
        {shipment.insuredValueMinor > 0 && (
          <DetailRow label={t('ship.insuredValue')}>
            <span dir="ltr">{formatUsd(shipment.insuredValueMinor)}</span>
            {shipment.insurancePremiumMinor > 0 && (
              <span className="detail-value-sub" dir="ltr">
                {t('ship.premium', { amount: formatUsd(shipment.insurancePremiumMinor) })}
              </span>
            )}
          </DetailRow>
        )}
        {shipment.signatureRequired && (
          <DetailRow label={t('ship.signature')}>
            <StatusBadge tone="info">{t('ship.signatureOn')}</StatusBadge>
          </DetailRow>
        )}
        {shipment.declaredValueMinor > 0 && (
          <DetailRow label={t('ship.customsValue')}>
            <span dir="ltr">{formatUsd(shipment.declaredValueMinor)}</span>
          </DetailRow>
        )}
        {shipment.addOns.length > 0 && (
          <DetailRow label={t('ship.addOns')}>
            {shipment.addOns.map((a) => (a.key === 'gps_tracker' ? t('ship.addon.gps_tracker') : a.key)).join(', ')}
          </DetailRow>
        )}
        {shipment.customerNotes && (
          <DetailRow label={t('ship.notes')}>{shipment.customerNotes}</DetailRow>
        )}
        {shipment.paymentDueAt && (
          <DetailRow label={t('ship.paymentDue')}>
            <span dir="ltr">{formatDate(shipment.paymentDueAt, locale)}</span>
          </DetailRow>
        )}
        {shipment.cancelReason && (
          <DetailRow label={t('ship.cancelReason')}>
            {shipment.cancelReason}
            {shipment.restockingFeeMinor > 0 && (
              <span className="detail-value-sub" dir="ltr">
                {t('ship.restockingCharged', { amount: formatUsd(shipment.restockingFeeMinor) })}
              </span>
            )}
          </DetailRow>
        )}
        {shipment.fulfilledAt && (
          <DetailRow label={t('ss.tracking.dispatched')}>
            <span dir="ltr">{formatDate(shipment.fulfilledAt, locale)}</span>
          </DetailRow>
        )}
      </dl>

      {/* Which cards, not how many. A direct parcel has none: it was never opened. */}
      <h3 className="drawer-heading">{t('ss.tracking.itemsHeading', { count: shipment.itemIds.length })}</h3>
      {shipment.sourceParcelId && shipment.itemIds.length === 0 ? (
        <p className="field-hint">{t('ss.tracking.directParcel')}</p>
      ) : detail === null ? (
        <p className="hint">{t('grp.loading')}</p>
      ) : (
        <ul className="check-list list-unbounded">
          {detail.items.map((it) => (
            <li key={it.id}>
              <a className="link-more" href={`#/vault/active?item=${encodeURIComponent(it.id)}`}>
                <code dir="ltr">{it.serialNumber}</code>
              </a>
              {it.description && <span className="hint clamp-2">{it.description}</span>}
            </li>
          ))}
        </ul>
      )}

      {international && shipment.declaredValueMinor > 0 && (
        <p className="field-hint">{t('ship.customsOnFile')}</p>
      )}

      {/* What happens at the far end. Shown on any parcel crossing a border,
          including one with nothing declared yet — that is precisely the case
          worth warning about. */}
      {international && <CustomsReadiness shipmentId={shipment.id} />}

      <div className="row stack-top" style={{ flexWrap: 'wrap' }}>
        {open && carrierShipment && (
          <Button variant="gold" size="sm" disabled={busy} onClick={() => setMode(mode === 'choose' ? 'none' : 'choose')}>
            {t('ship.chooseService')}
          </Button>
        )}
        {open && carrierShipment && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')}>
            {t('ship.editRequest')}
          </Button>
        )}
        {payable && (
          <Button
            variant="gold"
            size="sm"
            disabled={busy}
            onClick={() => void act(() => api.post(`/shipping/shipments/${shipment.id}/pay`), t('ship.paid'))}
          >
            {t('ship.payNow')}
          </Button>
        )}
        {international && shipment.declaredValueMinor > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setMode(mode === 'invoice' ? 'none' : 'invoice')}>
            {t('ship.invoice.view')}
          </Button>
        )}
        {cancellable && (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
            {t('ship.cancel')}
          </Button>
        )}
      </div>

      {mode === 'choose' && (
        <ChooseService
          shipment={shipment}
          restockingFeeMinor={restockingFeeMinor}
          busy={busy}
          onBook={(rate) =>
            void act(
              () =>
                api.post(`/shipping/shipments/${shipment.id}/select-rate`, {
                  carrier: rate.carrier,
                  serviceLevel: rate.serviceLevel,
                }),
              t('ship.booked', { id: shipment.code ?? shipment.id, amount: formatUsd(rate.totalMinor) }),
            )
          }
          onError={onError}
        />
      )}

      {mode === 'edit' && (
        <EditRequest
          shipment={shipment}
          others={others.filter((o) => o.id !== shipment.id && o.status === 'requested' && !o.mergedIntoShipmentId)}
          busy={busy}
          onSave={(patch) =>
            void act(() => api.patch(`/shipping/shipments/${shipment.id}`, patch), t('ship.requestUpdated'), false).then(
              () => setMode('none'),
            )
          }
          onMerge={(sourceId, code) =>
            void act(
              () => api.post(`/shipping/shipments/${shipment.id}/merge`, { sourceShipmentId: sourceId }),
              t('ship.merged', { from: code, into: shipment.code ?? '' }),
              false,
            ).then(() => setMode('none'))
          }
        />
      )}

      {mode === 'invoice' && <CommercialInvoice shipmentId={shipment.id} />}

      {confirming && (
        <div className="stack stack--tight" style={{ marginBlockStart: 'var(--sp-3)' }}>
          <label className="field">
            <span className="field-label">{t('ship.cancelReasonLabel')}</span>
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
          {/* Said plainly BEFORE the button, not in a receipt afterwards. */}
          <span className="field-hint">
            {shipment.status === 'rates_selected'
              ? t('ship.cancelFeeWarning', {
                  // Named, not implied. The figure is published on
                  // `/shipping/services`; a warning that says "a fee" is asking
                  // somebody to accept a cost nobody was willing to state.
                  amount: restockingFeeMinor === null ? '—' : formatUsd(restockingFeeMinor),
                })
              : t('ship.cancelFree')}
          </span>
          <div className="row">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                void act(
                  () => api.post(`/shipping/shipments/${shipment.id}/cancel`, { reason }),
                  t('ship.cancelled'),
                )
              }
            >
              {t('ship.confirmCancel')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('ui.cancel')}
            </Button>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

/**
 * Choose a service for a saved request, and pay for it.
 *
 * Only on a request — a shipment already paid for is not offered this, because
 * choosing again charged it twice (the API now refuses that as well). Choosing
 * and paying are two steps here too: the total and the cancellation fee are
 * stated before anything is taken.
 */
function ChooseService({
  shipment,
  restockingFeeMinor,
  busy,
  onBook,
  onError,
}: {
  shipment: ShipmentSummary;
  restockingFeeMinor: number | null;
  busy: boolean;
  onBook: (rate: QuotedRate) => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const [rates, setRates] = useState<QuotedRate[] | null>(null);
  const [picked, setPicked] = useState<QuotedRate | null>(null);

  useEffect(() => {
    void api
      .get<QuotedRate[]>(`/shipping/shipments/${shipment.id}/rates`)
      .then(setRates)
      .catch((e: Error) => {
        onError(e.message);
        setRates([]);
      });
  }, [shipment.id, onError]);

  if (rates === null) return <p className="hint stack-top">{t('ship.quoting')}</p>;
  const eligible = rates.filter((r) => r.eligible);
  if (eligible.length === 0) return <p className="field-hint stack-top">{t('ship.noneEligibleText')}</p>;

  return (
    <div className="stack stack--tight stack-top">
      <ul className="check-list list-unbounded">
        {eligible.map((r) => (
          <li key={r.serviceKey}>
            <label className="check">
              <input
                type="radio"
                name={`svc-${shipment.id}`}
                checked={picked?.serviceKey === r.serviceKey}
                onChange={() => setPicked(r)}
              />
              <span>
                {serviceLabel(t, r)} · {transitLabel(t, r.transitDaysMin, r.transitDaysMax)} ·{' '}
                <span dir="ltr">{formatUsd(r.totalMinor)}</span>
                {r.recommended && (
                  <>
                    {' '}
                    <StatusBadge tone="gold">{t('ship.recommended')}</StatusBadge>
                  </>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {picked && (
        <div className="infobox stack stack--tight">
          <span className="field-hint">{t('ship.confirmWallet', { days: 7 })}</span>
          <span className="field-hint">
            {t('ship.confirmCancelFee', {
              amount: restockingFeeMinor === null ? '—' : formatUsd(restockingFeeMinor),
            })}
          </span>
          <div className="row">
            <Button variant="gold" size="sm" loading={busy} onClick={() => onBook(picked)}>
              {t('ship.bookAndPay', { amount: formatUsd(picked.totalMinor) })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Change a request before anything is paid: which cards, rush, the note — or
 * fold another of your requests into this one. Both are refused by the API
 * once a service has been chosen; the help guide has always promised them.
 */
function EditRequest({
  shipment,
  others,
  busy,
  onSave,
  onMerge,
}: {
  shipment: ShipmentSummary;
  others: ShipmentSummary[];
  busy: boolean;
  onSave: (patch: { itemIds: string[]; rush: boolean; customerNotes?: string }) => void;
  onMerge: (sourceId: string, code: string) => void;
}) {
  const { t } = useI18n();
  const { items } = useVaultItems(false);
  const [chosen, setChosen] = useState<string[]>(shipment.itemIds);
  const [rush, setRush] = useState(shipment.rush);
  const [notes, setNotes] = useState(shipment.customerNotes ?? '');
  const [mergeFrom, setMergeFrom] = useState('');

  // What this request can hold: its own cards, and any stored card nothing else has claimed.
  const candidates = items.filter(
    (i) =>
      shipment.itemIds.includes(i.id) ||
      (i.lifecycleState === 'stored' && !i.holdFlag && !i.commitment),
  );
  const source = others.find((o) => o.id === mergeFrom);

  return (
    <div className="stack stack--tight stack-top">
      <ul className="check-list">
        {candidates.map((i) => (
          <li key={i.id}>
            <label className="check">
              <input
                type="checkbox"
                checked={chosen.includes(i.id)}
                onChange={() =>
                  setChosen((prev) => (prev.includes(i.id) ? prev.filter((x) => x !== i.id) : [...prev, i.id]))
                }
              />
              <span>
                {i.serialNumber && <code dir="ltr">{i.serialNumber}</code>} {itemClassLabel(t, i.typeClass)} ·{' '}
                {i.description}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <label className="check">
        <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} />
        {t('shipping.rush')}
      </label>
      <label className="field">
        <span className="field-label">{t('ship.notes')}</span>
        <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="row">
        <Button
          variant="gold"
          size="sm"
          disabled={busy || chosen.length === 0}
          onClick={() => onSave({ itemIds: chosen, rush, customerNotes: notes.trim() || undefined })}
        >
          {t('ship.saveChanges')}
        </Button>
      </div>

      {others.length > 0 && (
        <div className="stack stack--tight stack-top">
          <label className="field">
            <span className="field-label">{t('ship.mergeLabel')}</span>
            <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
              <option value="">{t('ship.mergePick')}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code ?? o.id.slice(0, 8)} · {t('ss.tracking.itemsHeading', { count: o.itemIds.length })}
                </option>
              ))}
            </select>
          </label>
          <span className="field-hint">{t('ship.mergeHint')}</span>
          <div className="row">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !source}
              onClick={() => source && onMerge(source.id, source.code ?? source.id.slice(0, 8))}
            >
              {t('ship.mergeButton')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Invoice {
  shipmentCode: string | null;
  issuedFor: { username: string | null; name: string | null };
  shipper: { name: string; line1: string; line2: string | null; city: string; region: string; postalCode: string; country: string } | null;
  consignee: { name: string | null; address: string; country: string; postalCode: string };
  carrier: string | null;
  serviceLevel: string | null;
  trackingNumber: string | null;
  lines: { itemId: string; serialNumber: string; description: string; valueMinor: number; hsCode: string; countryOfOrigin: string; weightGrams: number }[];
  totals: { lineCount: number; valueMinor: number; weightGrams: number; currency: string | null };
  declaration: string;
  dutyNote: string;
}

/** The HTML-escaped text of a value, for the printable invoice. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The commercial invoice, readable here and printable as a document.
 *
 * The API has produced it for every international parcel; nothing showed it.
 * Printing opens it on its own page rather than printing the app around it —
 * this is the sheet that goes in the pouch on the outside of the box.
 */
function CommercialInvoice({ shipmentId }: { shipmentId: string }) {
  const { t } = useI18n();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Invoice>(`/shipping/shipments/${shipmentId}/customs`)
      .then(setInvoice)
      .catch((e: Error) => setError(e.message));
  }, [shipmentId]);

  function print() {
    if (!invoice) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = invoice.lines
      .map(
        (l) =>
          `<tr><td>${esc(l.serialNumber)}</td><td>${esc(l.description)}</td><td>${esc(l.hsCode)}</td><td>${esc(
            l.countryOfOrigin,
          )}</td><td class="n">${esc(l.weightGrams)} g</td><td class="n">${esc(formatUsd(l.valueMinor))}</td></tr>`,
      )
      .join('');
    const shipper = invoice.shipper
      ? [invoice.shipper.name, invoice.shipper.line1, invoice.shipper.line2, `${invoice.shipper.city}, ${invoice.shipper.region} ${invoice.shipper.postalCode}`, invoice.shipper.country]
          .filter(Boolean)
          .map(esc)
          .join('<br>')
      : '';
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Commercial invoice ${esc(
      invoice.shipmentCode,
    )}</title><style>body{font:12px/1.4 system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;text-align:left}.n{text-align:right}h1{font-size:18px}</style></head><body>
<h1>Commercial invoice — ${esc(invoice.shipmentCode)}</h1>
<p><strong>Shipper</strong><br>${shipper}</p>
<p><strong>Consignee</strong><br>${esc(invoice.consignee.name)}<br>${esc(invoice.consignee.address)}</p>
<p>${esc(invoice.carrier)} ${esc(invoice.serviceLevel)} ${esc(invoice.trackingNumber)}</p>
<table><thead><tr><th>Serial</th><th>Description</th><th>HS code</th><th>Origin</th><th class="n">Weight</th><th class="n">Value</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><th colspan="4">${esc(invoice.totals.lineCount)} lines</th><th class="n">${esc(invoice.totals.weightGrams)} g</th><th class="n">${esc(
      formatUsd(invoice.totals.valueMinor),
    )}</th></tr></tfoot></table>
<p>${esc(invoice.declaration)}</p><p>${esc(invoice.dutyNote)}</p></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  if (error) return <ErrorState message={error} />;
  if (!invoice) return <p className="hint stack-top">{t('grp.loading')}</p>;

  return (
    <div className="stack stack--tight stack-top">
      <div className="dt-wrap dt-wrap--stack">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('ship.invoice.item')}</th>
              <th scope="col">{t('ship.invoice.hs')}</th>
              <th scope="col" className="td-end">
                {t('ship.invoice.value')}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.itemId}>
                <td data-label={t('ship.invoice.item')}>
                  <code dir="ltr">{l.serialNumber}</code>
                  <span className="dt-sub clamp-2">{l.description}</span>
                </td>
                <td data-label={t('ship.invoice.hs')} dir="ltr">
                  {l.hsCode} · {l.countryOfOrigin}
                </td>
                <td data-label={t('ship.invoice.value')} className="td-end num" dir="ltr">
                  {formatUsd(l.valueMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-hint">
        {t('ship.invoice.total', { value: formatUsd(invoice.totals.valueMinor), count: invoice.totals.lineCount })}
      </p>
      <p className="field-hint">{invoice.declaration}</p>
      <p className="field-hint">{invoice.dutyNote}</p>
      <div className="row">
        <Button variant="secondary" size="sm" onClick={print}>
          {t('ship.invoice.print')}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   Service request tables (open / history)
   ============================================================ */

function RequestTable({
  requests,
  title,
  subtitle,
  emptyTitle,
  emptyText,
  onChanged,
  onError,
}: {
  requests: MyRequest[] | null;
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyText: string;
  onChanged?: (message: string) => Promise<void> | void;
  onError?: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);

  /**
   * A buyout quote is the one service request a COLLECTOR has to answer.
   *
   * Everything else here is a record of work being done for them; this is a
   * number on the table that expires into nothing unless they say yes. So it is
   * the one row type that carries buttons.
   */
  async function answerQuote(request: MyRequest, action: 'accept' | 'decline') {
    setBusy(true);
    try {
      const res = await api.post<{ creditedMinor?: number }>(
        `/services/buyout/${request.id}/${action}`,
      );
      await onChanged?.(
        action === 'accept'
          ? t('services.buyout.accepted', { amount: formatUsd(res.creditedMinor ?? 0) })
          : t('services.buyout.declined'),
      );
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A custom request is the second thing a collector has to answer.
   *
   * The routes are separate from the buyout's because the two are opposite
   * trades: accepting a buyout quote CREDITS the wallet, and accepting a custom
   * quote DEBITS it. Sharing one handler would have made the difference a
   * parameter, and the difference is the whole point.
   */
  async function answerCustomQuote(request: MyRequest, action: 'accept' | 'decline') {
    setBusy(true);
    try {
      await api.post(`/services/custom/${request.id}/${action}-quote`);
      await onChanged?.(action === 'accept' ? t('custom.quoteAccepted') : t('custom.quoteDeclined'));
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={title} subtitle={subtitle} flush>
      {requests === null ? (
        <SkeletonTable rows={4} columns={3} />
      ) : requests.length === 0 ? (
        <EmptyState title={emptyTitle} text={emptyText} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('services.colService')}</th>
                <th scope="col">{t('services.colItem')}</th>
                <th scope="col">{t('services.colStatus')}</th>
                <th scope="col">{t('services.colDate')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td data-label={t('services.colService')} className="dt-primary">
                    {serviceTypeLabel(t, request.type)}
                  </td>
                  <td data-label={t('services.colItem')}>
                    {request.itemId ? (
                      <a className="link-more" href={`#/vault/active?item=${encodeURIComponent(request.itemId)}`}>
                        {request.itemSerial && <code dir="ltr">{request.itemSerial}</code>}
                        {request.itemDescription && <span className="dt-sub clamp-2">{request.itemDescription}</span>}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td data-label={t('services.colStatus')}>
                    {request.type === 'custom' && CUSTOM_STAGE[String(request.typeFields?.stage ?? '')] ? (
                      <StatusBadge tone={CUSTOM_STAGE[String(request.typeFields?.stage)]!.tone}>
                        {t(CUSTOM_STAGE[String(request.typeFields?.stage)]!.key)}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone={STATUS_TONE[request.status] ?? 'neutral'}>
                        {serviceStatusLabel(t, request.status)}
                      </StatusBadge>
                    )}
                  </td>
                  <td data-label={t('services.colDate')}>
                    <span className="date" dir="ltr">
                      {formatDate(request.createdAt, locale)}
                    </span>
                  </td>
                  <td className="td-steps">
                    {/*
                      What the collector asked for, in their own words — without
                      it a row reads "A custom request", which names the type and
                      not the thing.
                    */}
                    {request.type === 'custom' && <CustomRequestRow request={request} />}

                    {request.type === 'custom' &&
                      (request.typeFields as { stage?: string } | null)?.stage === 'quoted' && (
                        <div className="actions actions--row">
                          {/* The amount is stated on the step above, beside the
                              scope it buys. Repeating it next to the button was
                              the price appearing twice and the scope not at all. */}
                          <Button
                            size="sm"
                            variant="gold"
                            disabled={busy}
                            onClick={() => void answerCustomQuote(request, 'accept')}
                          >
                            {t('custom.acceptQuoteAmount', {
                              amount: formatUsd(
                                Number((request.typeFields as { priceMinor?: number })?.priceMinor ?? 0),
                              ),
                            })}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void answerCustomQuote(request, 'decline')}
                          >
                            {t('custom.declineQuote')}
                          </Button>
                        </div>
                      )}

                    {request.type === 'buyout' &&
                      (request.typeFields as { stage?: string } | null)?.stage === 'quoted' && (
                        <div className="actions">
                          <span className="hint">
                            {t('services.buyout.quoted', {
                              amount: formatUsd(
                                Number((request.typeFields as { offerMinor?: number })?.offerMinor ?? 0),
                              ),
                            })}
                          </span>
                          <Button
                            size="sm"
                            variant="gold"
                            disabled={busy}
                            onClick={() => void answerQuote(request, 'accept')}
                          >
                            {t('services.buyout.accept')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => void answerQuote(request, 'decline')}
                          >
                            {t('services.buyout.decline')}
                          </Button>
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
  );
}

/**
 * A custom request, as a three-step register.
 *
 * ASK (free) → an operator PROPOSES a price and a scope → you ACCEPT. Those are
 * the three steps of the flow, they are the whole reason the box marked "custom"
 * is not frightening, and the interface showed none of them: one status word in
 * a pill, and the price — the thing being agreed to — inside a collapsed row
 * beside the button that agrees to it.
 *
 * Drawn horizontally with the current step marked by the same custody rule that
 * marks an active tab and an active rail destination. Each step states its own
 * fact where that fact belongs: the ask carries the summary, the proposal
 * carries THE AMOUNT AND THE SCOPE — a collector accepting a figure is agreeing
 * to whatever the operator understood the ask to be, and "$18.00" with nothing
 * behind it is not something anybody can agree to — and the last step carries
 * what was actually done.
 *
 * A declined request is not a fourth step; it is the second step answered "no",
 * so it takes the second step's position and states the reason. A refusal
 * without one leaves the collector guessing whether to ask differently or stop
 * asking.
 */
function CustomRequestRow({ request }: { request: MyRequest }) {
  const { t } = useI18n();
  const fields = (request.typeFields as Record<string, unknown> | null) ?? {};
  const stage = String(fields.stage ?? '');
  const price = Number(fields.priceMinor ?? 0);
  const scope = String(fields.scope ?? '');
  const declined = stage === 'declined';

  /** Where the request has got to, as an index into the three steps. */
  const at = stage === 'awaiting_quote' ? 0 : stage === 'quoted' || declined ? 1 : 2;

  const steps = [
    {
      name: t('custom.step.ask'),
      detail: String(fields.summary ?? ''),
    },
    {
      name: t('custom.step.propose'),
      detail: declined
        ? t('custom.declinedBy', { reason: String(fields.declineReason ?? '') })
        : price > 0
          ? `${formatUsd(price)} · ${scope}`
          : t('custom.awaitingQuote'),
    },
    {
      name: stage === 'accepted' || stage === 'done' ? t('custom.step.accept') : t('custom.step.answer'),
      detail:
        stage === 'done'
          ? String(fields.completionNotes ?? t('custom.stepDone'))
          : stage === 'accepted'
            ? t('custom.inProgress')
            : t('custom.step.acceptWaiting'),
    },
  ];

  return (
    <ol className="steps">
      {steps.map((step, index) => (
        <li
          key={step.name}
          className={[
            'step',
            index < at ? 'is-done' : '',
            index === at ? 'is-current' : '',
            index === 1 && declined ? 'is-declined' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={index === at ? 'step' : undefined}
        >
          <span className="step-name">{step.name}</span>
          {step.detail && <span className="step-detail ltr-run">{step.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/* ============================================================
   Customs readiness
   ============================================================ */

interface ReadinessWarning {
  code: string;
  message: string;
}

interface DestinationSpecific {
  country: string;
  name: string;
  authority: { name: string; url: string };
  notes: string[];
  notHandled: string[];
}

interface Readiness {
  destinationCountry: string;
  international: boolean;
  ready: boolean;
  warnings: ReadinessWarning[];
  guidance: { universal: string[]; specific: DestinationSpecific | null };
}

/**
 * What will happen to this parcel at the border, before it leaves.
 *
 * The commercial invoice answers "what did you declare"; this answers the
 * question that comes first and had nowhere to be asked — "am I about to send
 * this somewhere it will get stuck, and what will the person receiving it owe".
 *
 * Three things it deliberately will not do. It never states a duty figure:
 * thresholds move, and a number Bault made up is a number somebody plans
 * around, so the destination's own authority is linked instead. It reports
 * rather than blocks, because an estimated weight is a fact worth knowing and
 * not grounds to refuse a parcel. And it names what Bault does NOT do at the
 * destination — a collector expecting Bault to lodge a clearance instruction it
 * has never lodged is exactly who this panel exists for.
 */
function CustomsReadiness({ shipmentId }: { shipmentId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<Readiness | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.get<Readiness>(`/shipping/shipments/${shipmentId}/customs/readiness`));
      } catch {
        /* guidance is additive — a shipment page still works without it */
      }
    })();
  }, [shipmentId]);

  if (!data || !data.international) return null;
  const spec = data.guidance.specific;

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="panel-title" style={{ fontSize: 15, margin: 0 }}>
        {t('customs.title', { country: spec?.name ?? data.destinationCountry })}
      </h3>

      {data.warnings.length > 0 && (
        <ul className="check-list list-unbounded">
          {data.warnings.map((w) => (
            <li key={w.code}>
              <span>
                <StatusBadge tone="warning">{t('customs.check')}</StatusBadge>{' '}
                <span className="hint">{w.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ul className="check-list list-unbounded">
        {data.guidance.universal.map((line) => (
          <li key={line}>
            <span className="hint">{line}</span>
          </li>
        ))}
        {spec?.notes.map((line) => (
          <li key={line}>
            <span className="hint">{line}</span>
          </li>
        ))}
      </ul>

      {spec ? (
        <>
          {spec.notHandled.length > 0 && (
            <>
              <p className="field-hint" style={{ margin: 0 }}>
                <strong>{t('customs.notHandled')}</strong>
              </p>
              <ul className="check-list list-unbounded">
                {spec.notHandled.map((line) => (
                  <li key={line}>
                    <span className="hint">{line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="field-hint">
            {t('customs.authority')}{' '}
            <a href={spec.authority.url} target="_blank" rel="noopener noreferrer">
              {spec.authority.name}
            </a>
          </p>
        </>
      ) : (
        /* An honest absence. A generic paragraph pretending to be
           destination advice would be worse than saying we have not written it. */
        <p className="field-hint">{t('customs.noGuidance', { country: data.destinationCountry })}</p>
      )}
    </div>
  );
}
