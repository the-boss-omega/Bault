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
import { navigate, useNavigation, useRoute } from '../../../shared/routing';
import {
  SHIPMENT_TONE,
  PREPARING_STATUSES,
  isInTransit,
  matchesShipmentSearch,
  needsCollector,
  shipmentNextKey,
  shipmentStatusLabel,
  sortShipments,
  type ShipmentSort,
  type ShipmentSummary,
} from '../../../shared/shipments';
import {
  Button,
  ContextTabs,
  DetailRow,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  TabPanel,
  type StatusTone,
} from '../../../shared/ui/primitives';
import { CountUp } from '../../../shared/ui/CountUp';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { serviceLabel, shipmentServiceLabel, trackingUrl, type QuotedRate } from '../../../shared/carriers';
import { ShipmentComposer } from './ShipmentComposer';
import { SharedParcelsTab } from './SharedParcelsTab';
import { ShowPickupPanel, WhiteGlovePanel, WhiteGloveQuotes } from './HumanFulfilmentPanels';
import { IconAlert, IconScan } from '../../../shared/ui/icons';

const TABS = ['overview', 'shipping', 'in-person', 'tracking', 'shared', 'requests', 'history', 'not-accepted'] as const;
type SsTab = (typeof TABS)[number];

const STATUS_TONE: Record<string, StatusTone> = {
  requested: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
};

const OPEN_STATUSES = new Set(['requested', 'in_progress']);

interface MyRequest {
  id: string;
  code?: string | null;
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

export function formatAddress(a: Address): string {
  return `${a.recipient}, ${a.line1}, ${a.city} ${a.postalCode}, ${a.country}`;
}

export function ShippingServicesPage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab, openRecord, closeRecord, setParams } = useNavigation(route);
  const way = route.params.way === 'hand' ? 'hand' : 'show';

  const { items: vaultItems, error: itemsError, loaded: itemsLoaded, reload } = useVaultItems(false);
  const items = useMemo(() => vaultItems.filter((i) => i.lifecycleState === 'stored'), [vaultItems]);
  const serials = useMemo(() => new Map(vaultItems.map((i) => [i.id, i.serialNumber])), [vaultItems]);
  const [requests, setRequests] = useState<MyRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [underWay, setUnderWay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [shipmentsVersion, setShipmentsVersion] = useState(0);

  const tab: SsTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as SsTab)
    : 'overview';

  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [tab]);

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await api.get<MyRequest[]>('/services/mine'));
      setRequestsError(null);
    } catch (e) {
      setRequestsError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (tab !== 'overview') return;
    let live = true;
    void api
      .get<ShipmentSummary[]>('/shipping/shipments')
      .then((rows) => {
        if (!live || !Array.isArray(rows)) return;
        setUnderWay(rows.filter((s) => PREPARING_STATUSES.includes(s.status) || isInTransit(s.status)).length);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tab, shipmentsVersion]);

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
          <Panel title={t('ss.overview.title')} subtitle={t('ss.overview.subtitle')}>
            <ul className="departures">
              <li className="departure">
                <div className="departure-text">
                  <h3 className="departure-title">{t('ss.tab.shipping')}</h3>
                  <p className="departure-desc">{t('ss.overview.shippingDesc')}</p>
                </div>
                <p className="departure-figure">
                  <span className="departure-number">
                    {itemsLoaded ? <CountUp value={String(items.length)} /> : '—'}
                  </span>
                  <span className="slip-label">{t('ss.metric.shippable')}</span>
                </p>
                <div className="departure-action">
                  <Button variant="primary" onClick={() => goTab('shipping')}>
                    {t('ss.overview.goShipping')}
                  </Button>
                </div>
              </li>
              <li className="departure">
                <div className="departure-text">
                  <h3 className="departure-title">{t('ss.tab.tracking')}</h3>
                  <p className="departure-desc">{t('ship.overview.trackingDesc')}</p>
                </div>
                <p className="departure-figure">
                  {underWay === null ? (
                    <span className="departure-icon" aria-hidden="true">
                      <IconScan />
                    </span>
                  ) : (
                    <>
                      <span className="departure-number">
                        <CountUp value={String(underWay)} />
                      </span>
                      <span className="slip-label">{t('ship.overview.underWay')}</span>
                    </>
                  )}
                </p>
                <div className="departure-action">
                  <Button variant="secondary" onClick={() => goTab('tracking')}>
                    {t('ss.overview.goTracking')}
                  </Button>
                </div>
              </li>
              <li className="departure">
                <div className="departure-text">
                  <h3 className="departure-title">{t('ss.tab.requests')}</h3>
                  <p className="departure-desc">{t('ss.overview.requestsDesc')}</p>
                </div>
                <p className="departure-figure">
                  <span className="departure-number">
                    {requests === null ? '—' : <CountUp value={String(open.length)} />}
                  </span>
                  <span className="slip-label">{t('ss.metric.openRequests')}</span>
                  {requests !== null && (
                    <span className="departure-aside">
                      {past.length} {t('ss.metric.pastRequests')}
                    </span>
                  )}
                </p>
                <div className="departure-action">
                  <Button variant="secondary" onClick={() => goTab('requests')}>
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
            onCreated={() => {
              setShipmentsVersion((v) => v + 1);
              void reload();
            }}
          />
        </TabPanel>
      )}

      {tab === 'in-person' && (
        <TabPanel tab="in-person">
          <WhiteGloveQuotes
            reloadToken={shipmentsVersion}
            onError={setError}
            onStatus={setStatus}
            onChanged={() => setShipmentsVersion((v) => v + 1)}
          />
          <div className="row" role="group" aria-label={t('ship.inPerson.choose')}>
            <Button
              variant={way === 'show' ? 'primary' : 'secondary'}
              pressed={way === 'show'}
              onClick={() => setParams({ way: null })}
            >
              {t('ship.inPerson.show')}
            </Button>
            <Button
              variant={way === 'hand' ? 'primary' : 'secondary'}
              pressed={way === 'hand'}
              onClick={() => setParams({ way: 'hand' })}
            >
              {t('ship.inPerson.hand')}
            </Button>
          </div>
          {way === 'show' ? (
            <ShowPickupPanel
              items={items}
              reloadToken={shipmentsVersion}
              onError={setError}
              onStatus={setStatus}
              onCreated={() => {
                setShipmentsVersion((v) => v + 1);
                void reload();
              }}
            />
          ) : (
            <WhiteGlovePanel
              items={items}
              reloadToken={shipmentsVersion}
              onError={setError}
              onStatus={setStatus}
              onCreated={() => {
                setShipmentsVersion((v) => v + 1);
                void reload();
              }}
            />
          )}
        </TabPanel>
      )}

      {tab === 'tracking' && (
        <TabPanel tab="tracking">
          <TrackingTab
            reloadToken={shipmentsVersion}
            openId={route.params.shipment ?? null}
            onOpen={(id) => openRecord('shipment', id)}
            onClose={() => closeRecord('shipment')}
            onStatus={setStatus}
            onCreate={() => goTab('shipping')}
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
            error={requestsError}
            onRetry={() => void loadRequests()}
            serials={serials}
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
            error={requestsError}
            onRetry={() => void loadRequests()}
            serials={serials}
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
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={t('ss.notAccepted.title')} subtitle={t('ss.notAccepted.subtitle')} flush>
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      {rows === null ? (
        error ? null : (
          <SkeletonTable rows={3} columns={4} />
        )
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
                    <span className="dt-sub">{row.notes}</span>
                  </td>
                  <td data-label={t('ss.notAccepted.col.outcome')}>
                    {disposalOutcomeLabel(t, row.outcome)}
                  </td>
                  <td data-label={t('ss.notAccepted.col.date')}>
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

function TrackingTab({
  reloadToken,
  openId,
  onOpen,
  onClose,
  onStatus,
  onCreate,
}: {
  reloadToken: number;
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onStatus: (m: string | null) => void;
  onCreate: () => void;
}) {
  const { t, locale } = useI18n();
  const [shipments, setShipments] = useState<ShipmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ShipmentSort>('newest');

  const load = useCallback(async () => {
    try {
      setShipments(await api.get<ShipmentSummary[]>('/shipping/shipments'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const rows = useMemo(
    () =>
      sortShipments(
        (shipments ?? []).filter((shipment) =>
          matchesShipmentSearch(shipment, query, shipmentStatusLabel(t, shipment.status)),
        ),
        sort,
      ),
    [shipments, query, sort, t],
  );

  const selected = useMemo(
    () => (shipments ?? []).find((shipment) => shipment.id === openId) ?? null,
    [shipments, openId],
  );
  const missing = Boolean(openId && shipments !== null && !selected);
  const hasAny = (shipments ?? []).length > 0;

  return (
    <>
      <Panel
        title={t('ss.tracking.title')}
        subtitle={t('ss.tracking.subtitle')}
        flush
        tools={
          hasAny ? (
            <div className="row">
              <div className="search search--wide">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('ship.tracking.searchPlaceholder')}
                  aria-label={t('ss.tracking.searchLabel')}
                />
              </div>
              <select
                className="vault-sort"
                value={sort}
                aria-label={t('ship.sort.label')}
                onChange={(e) => setSort(e.target.value as ShipmentSort)}
              >
                <option value="newest">{t('ship.sort.newest')}</option>
                <option value="oldest">{t('ship.sort.oldest')}</option>
                <option value="needsYou">{t('ship.sort.needsYou')}</option>
              </select>
            </div>
          ) : undefined
        }
      >
        {error && (
          <ErrorState
            title={t('ship.tracking.failed')}
            message={error}
            onRetry={() => void load()}
            retryLabel={t('ui.retry')}
          />
        )}
        {missing && <SuccessNote tone="warning">{t('ship.tracking.notFound')}</SuccessNote>}

        {shipments === null ? (
          error ? null : (
            <SkeletonTable rows={4} columns={6} />
          )
        ) : rows.length === 0 ? (
          <EmptyState
            title={query ? t('ss.tracking.noMatches') : t('ss.tracking.empty')}
            text={query ? t('ss.tracking.noMatchesText') : t('ss.tracking.emptyText')}
            icon={<IconScan />}
            action={
              query ? (
                <Button variant="secondary" onClick={() => setQuery('')}>
                  {t('ship.search.clear')}
                </Button>
              ) : (
                <Button variant="primary" onClick={onCreate}>
                  {t('ss.overview.goShipping')}
                </Button>
              )
            }
          />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <caption className="sr-only">{t('ss.tracking.title')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('ss.tracking.col.recipient')}</th>
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
                    onClick={() => onOpen(shipment.id)}
                  >
                    <td data-label={t('ss.tracking.col.recipient')} className="dt-primary">
                      {shipment.recipientName || '—'}
                      {shipment.code && (
                        <span className="dt-sub" dir="ltr">
                          {shipment.code}
                        </span>
                      )}
                    </td>
                    <td data-label={t('ss.tracking.col.created')}>
                      <span className="date">{formatDate(shipment.createdAt, locale)}</span>
                    </td>
                    <td data-label={t('ss.tracking.col.carrier')}>
                      {shipment.carrier ? shipmentServiceLabel(t, shipment) : '—'}
                    </td>
                    <td data-label={t('ss.tracking.col.trackingNumber')}>
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
                      {needsCollector(shipment) && (
                        <span className="dt-sub">{t('ship.requests.waitingOnYou')}</span>
                      )}
                    </td>
                    <td data-label={t('ss.tracking.col.eta')}>
                      {shipment.estimatedDeliveryAt ? (
                        <span className="date">{formatDate(shipment.estimatedDeliveryAt, locale)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td data-label={t('ss.tracking.col.updated')}>
                      <span className="date">
                        {formatDate(shipment.updatedAt ?? shipment.createdAt, locale)}
                      </span>
                    </td>
                    <td className="td-tight">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`${t('ss.tracking.details')} ${shipment.code ?? ''}`.trim()}
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
          onStatus={onStatus}
        />
      )}
    </>
  );
}

export function ShipmentDrawer({
  shipment,
  locale,
  t,
  onClose,
  onChanged,
  onStatus,
}: {
  shipment: ShipmentSummary;
  locale: string;
  t: TranslateFn;
  onClose: () => void;
  onChanged: () => void;
  onStatus: (m: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [short, setShort] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [restockingFeeMinor, setRestockingFeeMinor] = useState<number | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const fee = await api.get<{ restockingFeeMinor: number }>(`/shipping/shipments/${shipment.id}/cancel-fee`);
        setRestockingFeeMinor(fee.restockingFeeMinor ?? null);
      } catch {
      }
    })();
  }, [shipment.id]);

  const cancellable = ['requested', 'awaiting_payment', 'rates_selected'].includes(shipment.status);
  const payable = shipment.status === 'awaiting_payment';

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      onStatus(ok);
      setError(null);
      setShort(false);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setShort((e as { code?: string }).code === 'insufficient_balance');
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
      {error && <ErrorState message={error} />}
      {error && short && (
        <p className="field-hint">
          <Button variant="link" onClick={() => navigate({ section: 'wallet', tab: 'cash-in' })}>
            {t('ship.cashInLink')}
          </Button>
        </p>
      )}

      <p className="drawer-note drawer-note--archive" role="note">
        <span>
          <strong>{t('ship.next.label')}</strong> {t(shipmentNextKey(shipment.status))}
        </span>
      </p>

      <dl className="detail-list">
        <DetailRow label={t('ss.tracking.status')}>
          <StatusBadge tone={SHIPMENT_TONE[shipment.status] ?? 'neutral'}>
            {shipmentStatusLabel(t, shipment.status)}
          </StatusBadge>
        </DetailRow>
        <DetailRow label={t('ss.tracking.col.recipient')}>
          {shipment.recipientName || '—'}
        </DetailRow>
        <DetailRow label={t('ss.tracking.trackingNumber')}>
          {shipment.trackingNumber ? (
            <>
              <code dir="ltr">{shipment.trackingNumber}</code>
              {trackingUrl(shipment.carrier, shipment.trackingNumber) && (
                <>
                  {' '}
                  <a
                    href={trackingUrl(shipment.carrier, shipment.trackingNumber)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('ss.tracking.trackOn', { carrier: shipment.carrier ?? '' })}
                  </a>
                </>
              )}
            </>
          ) : (
            <span className="hint">{t('ss.tracking.noTrackingYet')}</span>
          )}
        </DetailRow>
        <DetailRow label={t('ss.tracking.carrier')}>
          {shipment.carrier ? shipmentServiceLabel(t, shipment) : '—'}
        </DetailRow>
        <DetailRow label={t('ss.tracking.col.eta')}>
          {shipment.estimatedDeliveryAt ? (
            <span className="date">{formatDate(shipment.estimatedDeliveryAt, locale)}</span>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label={t('ss.tracking.cost')}>
          {shipment.cost === null ? '—' : <span dir="ltr">{formatUsd(shipment.cost)}</span>}
        </DetailRow>
        <DetailRow label={t('ss.tracking.itemCount')}>{shipment.itemIds.length}</DetailRow>
        {(shipment.items ?? []).length > 0 && (
          <DetailRow label={t('ship.tracking.contents')}>
            <ul className="list-unbounded">
              {shipment.items.map((item) => (
                <li key={item.id}>
                  <span dir="ltr">{item.serialNumber ?? '—'}</span>
                  {item.description && <span className="detail-value-sub">{item.description}</span>}
                </li>
              ))}
            </ul>
          </DetailRow>
        )}
        <DetailRow label={t('ss.tracking.destination')}>{shipment.destinationAddress}</DetailRow>
        {shipment.contactPhone && (
          <DetailRow label={t('ff.wg.courierPhone')}>
            <span dir="ltr">{shipment.contactPhone}</span>
          </DetailRow>
        )}
        <DetailRow label={t('ss.tracking.created')}>
          <span className="date">{formatDate(shipment.createdAt, locale)}</span>
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
            <span className="date">{formatDate(shipment.paymentDueAt, locale)}</span>
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
            <span className="date">{formatDate(shipment.fulfilledAt, locale)}</span>
          </DetailRow>
        )}
      </dl>

      {shipment.destinationCountry !== 'US' && shipment.declaredValueMinor > 0 && (
        <p className="field-hint">{t('ship.customsOnFile')}</p>
      )}

      {shipment.destinationCountry !== 'US' && <CustomsReadiness shipmentId={shipment.id} />}

      {shipment.labelRefused && (
        <RechooseService shipment={shipment} t={t} busy={busy} onChosen={(fn) => act(fn, t('ship.rechosen'))} />
      )}

      {(payable || cancellable) && (
        <div className="row stack-top">
          {payable && (
            <Button
              variant="primary"
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
            <input value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} />
          </label>
          <span className="field-hint">
            {shipment.status !== 'rates_selected'
              ? t('ship.cancelFree')
              : restockingFeeMinor === 0
                ? t('ship.cancelNoFee')
                : t('ship.cancelFeeWarning', {
                    amount: restockingFeeMinor === null ? '—' : formatUsd(restockingFeeMinor),
                  })}
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

export function RechooseService({
  shipment,
  t,
  busy,
  onChosen,
}: {
  shipment: ShipmentSummary;
  t: TranslateFn;
  busy: boolean;
  onChosen: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [rates, setRates] = useState<QuotedRate[] | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        setRates(await api.get<QuotedRate[]>(`/shipping/shipments/${shipment.id}/rates`));
      } catch {
        setRates([]);
      }
    })();
  }, [shipment.id]);

  const paid = shipment.cost ?? 0;
  const eligible = (rates ?? []).filter((r) => r.eligible);
  return (
    <div className="stack stack--tight stack-top">
      <p className="field-hint">{t('ship.labelRefused')}</p>
      {shipment.labelRefused?.reason && (
        <p className="hint">{shipment.labelRefused.reason}</p>
      )}
      {eligible.map((r) => {
        const difference = r.totalMinor - paid;
        return (
          <div key={r.serviceKey} className="row">
            <span>
              {serviceLabel(t, r)} · <span dir="ltr">{formatUsd(r.totalMinor)}</span>
              <span className="detail-value-sub" dir="ltr">
                {difference < 0
                  ? t('ship.rechoose.refund', { amount: formatUsd(-difference) })
                  : difference > 0
                    ? t('ship.rechoose.extra', { amount: formatUsd(difference) })
                    : t('ship.rechoose.same')}
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void onChosen(() =>
                  api.post(`/shipping/shipments/${shipment.id}/select-rate`, {
                    carrier: r.carrier,
                    serviceLevel: r.serviceLevel,
                  }),
                )
              }
            >
              {t('shipping.selectRate')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

type RequestSort = 'newest' | 'oldest' | 'needsYou';

function awaitingAnswer(request: MyRequest): boolean {
  return (
    request.status === 'in_progress' &&
    (request.type === 'custom' || request.type === 'buyout') &&
    (request.typeFields as { stage?: string } | null)?.stage === 'quoted'
  );
}

function RequestTable({
  requests,
  error,
  onRetry,
  serials,
  title,
  subtitle,
  emptyTitle,
  emptyText,
  onChanged,
  onError,
}: {
  requests: MyRequest[] | null;
  error: string | null;
  onRetry: () => void;
  serials: ReadonlyMap<string, string>;
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyText: string;
  onChanged?: (message: string) => Promise<void> | void;
  onError?: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RequestSort>('newest');
  const [confirming, setConfirming] = useState<MyRequest | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const hits = (requests ?? []).filter((request) =>
      !needle
        ? true
        : [
            request.code ?? '',
            serviceTypeLabel(t, request.type),
            serviceStatusLabel(t, request.status),
            request.itemId ? (serials.get(request.itemId) ?? '') : '',
            String((request.typeFields as { summary?: string } | null)?.summary ?? ''),
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
    );
    const byDate = (a: MyRequest, b: MyRequest) => b.createdAt.localeCompare(a.createdAt);
    if (sort === 'oldest') return hits.sort((a, b) => byDate(b, a));
    if (sort === 'needsYou') {
      return hits.sort((a, b) => Number(awaitingAnswer(b)) - Number(awaitingAnswer(a)) || byDate(a, b));
    }
    return hits.sort(byDate);
  }, [requests, query, sort, serials, t]);

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
    <Panel
      title={title}
      subtitle={subtitle}
      flush
      tools={
        (requests ?? []).length > 0 ? (
          <div className="row">
            <div className="search search--wide">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('ship.requests.searchPlaceholder')}
                aria-label={t('ship.requests.search')}
              />
            </div>
            <select
              className="vault-sort"
              value={sort}
              aria-label={t('ship.sort.label')}
              onChange={(e) => setSort(e.target.value as RequestSort)}
            >
              <option value="newest">{t('ship.sort.newest')}</option>
              <option value="oldest">{t('ship.sort.oldest')}</option>
              <option value="needsYou">{t('ship.sort.needsYou')}</option>
            </select>
          </div>
        ) : undefined
      }
    >
      {error && (
        <ErrorState title={t('ship.requests.failed')} message={error} onRetry={onRetry} retryLabel={t('ui.retry')} />
      )}
      {requests === null ? (
        error ? null : (
          <SkeletonTable rows={4} columns={3} />
        )
      ) : rows.length === 0 ? (
        query.trim() ? (
          <EmptyState
            title={t('ship.requests.noMatches')}
            text={t('ship.requests.noMatchesText')}
            action={
              <Button variant="secondary" onClick={() => setQuery('')}>
                {t('ship.search.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={emptyTitle}
            text={emptyText}
            action={
              <Button variant="secondary" onClick={() => navigate({ section: 'vault' })}>
                {t('ship.requests.toVault')}
              </Button>
            }
          />
        )
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('services.colService')}</th>
                <th scope="col">{t('services.colStatus')}</th>
                <th scope="col">{t('services.colDate')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => (
                <tr key={request.id}>
                  <td data-label={t('services.colService')} className="dt-primary">
                    {serviceTypeLabel(t, request.type)}
                    {(request.code || (request.itemId && serials.get(request.itemId))) && (
                      <span className="dt-sub" dir="ltr">
                        {[request.code, request.itemId ? serials.get(request.itemId) : null].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>
                  <td data-label={t('services.colStatus')}>
                    <StatusBadge tone={STATUS_TONE[request.status] ?? 'neutral'}>
                      {serviceStatusLabel(t, request.status)}
                    </StatusBadge>
                    {awaitingAnswer(request) && <span className="dt-sub">{t('ship.requests.waitingOnYou')}</span>}
                  </td>
                  <td data-label={t('services.colDate')} className="td-tight">
                    <span className="date">{formatDate(request.createdAt, locale)}</span>
                  </td>
                  <td className="td-tight">
                    {request.type === 'custom' && <CustomRequestRow request={request} />}

                    {request.type === 'custom' &&
                      request.status === 'in_progress' &&
                      (request.typeFields as { stage?: string } | null)?.stage === 'quoted' && (
                        <div className="actions actions--row">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy}
                            onClick={() => setConfirming(request)}
                          >
                            {t('custom.acceptQuoteAmount', {
                              amount: formatUsd(
                                Number((request.typeFields as { priceMinor?: number })?.priceMinor ?? 0),
                              ),
                            })}
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void answerCustomQuote(request, 'decline')}
                          >
                            {t('custom.declineQuote')}
                          </Button>
                        </div>
                      )}

                    {request.type === 'buyout' &&
                      request.status === 'in_progress' &&
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
                            variant="primary"
                            disabled={busy}
                            onClick={() => setConfirming(request)}
                          >
                            {t('services.buyout.acceptAmount', {
                              amount: formatUsd(
                                Number((request.typeFields as { offerMinor?: number })?.offerMinor ?? 0),
                              ),
                            })}
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
      {confirming && (
        <QuoteConfirmation
          request={confirming}
          serial={confirming.itemId ? serials.get(confirming.itemId) : undefined}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const request = confirming;
            if (request.type === 'buyout') await answerQuote(request, 'accept');
            else await answerCustomQuote(request, 'accept');
            setConfirming(null);
          }}
        />
      )}
    </Panel>
  );
}

function QuoteConfirmation({
  request,
  serial,
  busy,
  onConfirm,
  onCancel,
}: {
  request: MyRequest;
  serial: string | undefined;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const fields = (request.typeFields ?? {}) as { offerMinor?: number; priceMinor?: number };
  const card = serial ?? request.code ?? '';
  if (request.type === 'buyout') {
    const amount = formatUsd(Number(fields.offerMinor ?? 0));
    return (
      <ConfirmationModal
        title={t('services.buyout.confirmTitle', { amount })}
        body={<p>{t('services.buyout.confirmBody', { amount, item: card })}</p>}
        confirmLabel={t('services.buyout.acceptAmount', { amount })}
        cancelLabel={t('ui.cancel')}
        busy={busy}
        onConfirm={() => void onConfirm()}
        onCancel={onCancel}
      />
    );
  }
  const amount = formatUsd(Number(fields.priceMinor ?? 0));
  return (
    <ConfirmationModal
      title={t('custom.confirmTitle', { amount })}
      body={<p>{t('custom.confirmBody', { amount, code: request.code ?? '' })}</p>}
      confirmLabel={t('custom.acceptQuoteAmount', { amount })}
      cancelLabel={t('ui.cancel')}
      busy={busy}
      onConfirm={() => void onConfirm()}
      onCancel={onCancel}
    />
  );
}

function CustomRequestRow({ request }: { request: MyRequest }) {
  const { t } = useI18n();
  const fields = (request.typeFields as Record<string, unknown> | null) ?? {};
  const stage = String(fields.stage ?? '');
  const price = Number(fields.priceMinor ?? 0);
  const scope = String(fields.scope ?? '');
  const declined = stage === 'declined';

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

const CUSTOMS_WARNING_KEY: Record<string, MessageKey> = {
  no_customs_lines: 'customs.warn.no_customs_lines',
  unvalued_items: 'customs.warn.unvalued_items',
  estimated_weight: 'customs.warn.estimated_weight',
};

function customsWarningText(t: TranslateFn, warning: ReadinessWarning): string {
  const key = CUSTOMS_WARNING_KEY[warning.code];
  return key ? t(key) : warning.message;
}

function CustomsReadiness({ shipmentId }: { shipmentId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<Readiness | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.get<Readiness>(`/shipping/shipments/${shipmentId}/customs/readiness`));
      } catch {
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
                <span className="hint">{customsWarningText(t, w)}</span>
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
        <p className="field-hint">{t('customs.noGuidance', { country: data.destinationCountry })}</p>
      )}
    </div>
  );
}
