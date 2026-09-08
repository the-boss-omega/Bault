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
  matchesShipmentSearch,
  shipmentStatusLabel,
  type ShipmentSummary,
} from '../../../shared/shipments';
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
  createdAt: string;
  typeFields: Record<string, unknown> | null;
}

interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  city: string;
  country: string;
  postalCode: string;
  isDefault: boolean;
}

/* `ShipmentDetail` was this page's private copy of one shipment. The tracking
   list and its drawer now share `ShipmentSummary` from shared/shipments.ts, so
   the two views cannot drift apart in what they claim a shipment has. */

/** One-line rendering of a saved address, also persisted with the shipment. */
export function formatAddress(a: Address): string {
  return `${a.recipient}, ${a.line1}, ${a.city} ${a.postalCode}, ${a.country}`;
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
                <p className="card-desc">{t('ss.overview.shippingDesc')}</p>
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
                <p className="card-desc">{t('ss.overview.trackingDesc')}</p>
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
                <p className="card-desc">{t('ss.overview.requestsDesc')}</p>
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
                        <code dir="ltr">{shipment.trackingNumber}</code>
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

/** One shipment in full. Opened from the list; never from a typed identifier. */
function ShipmentDrawer({
  shipment,
  locale,
  t,
  onClose,
  onChanged,
  onError,
  onStatus,
}: {
  shipment: ShipmentSummary;
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

  /**
   * A request that has not been picked can be called off for nothing; one that
   * was already paid for costs the restocking fee. Both are the server's rule —
   * this only decides whether to show the button at all.
   */
  const cancellable = ['requested', 'awaiting_payment', 'rates_selected'].includes(shipment.status);
  const payable = shipment.status === 'awaiting_payment';

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      onStatus(ok);
      onError(null);
      onChanged();
      onClose();
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
        <DetailRow label={t('ss.tracking.col.username')}>
          {shipment.username ? <code dir="ltr">{shipment.username}</code> : '—'}
        </DetailRow>
        <DetailRow label={t('ss.tracking.trackingNumber')}>
          {shipment.trackingNumber ? (
            <code dir="ltr">{shipment.trackingNumber}</code>
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
        <DetailRow label={t('ss.tracking.itemCount')}>{shipment.itemIds.length}</DetailRow>
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
            {shipment.addOns.map((a) => t(`ship.addon.${a.key}` as MessageKey)).join(', ')}
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

      {shipment.destinationCountry !== 'US' && shipment.declaredValueMinor > 0 && (
        <p className="field-hint">{t('ship.customsOnFile')}</p>
      )}

      {/* What happens at the far end. Shown on any parcel crossing a border,
          including one with nothing declared yet — that is precisely the case
          worth warning about. */}
      {shipment.destinationCountry !== 'US' && <CustomsReadiness shipmentId={shipment.id} />}

      {(payable || cancellable) && (
        <div className="row stack-top">
          {payable && (
            <Button
              variant="gold"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(() => api.post(`/shipping/shipments/${shipment.id}/pay`), t('ship.paid'))
              }
            >
              {t('ship.payNow')}
            </Button>
          )}
          {cancellable && (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              {t('ship.cancel')}
            </Button>
          )}
        </div>
      )}

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
                <th scope="col">{t('services.colStatus')}</th>
                <th scope="col">{t('services.colDate')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td data-label={t('services.colService')} className="dt-primary">
                    {serviceTypeLabel(t, request.type)}
                  </td>
                  <td data-label={t('services.colStatus')}>
                    <StatusBadge tone={STATUS_TONE[request.status] ?? 'neutral'}>
                      {serviceStatusLabel(t, request.status)}
                    </StatusBadge>
                  </td>
                  <td data-label={t('services.colDate')} className="td-tight">
                    <span className="date">{formatDate(request.createdAt, locale)}</span>
                  </td>
                  <td className="td-tight">
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
      name: t('custom.step.accept'),
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
