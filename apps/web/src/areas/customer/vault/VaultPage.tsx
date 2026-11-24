import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { getAllPages } from '../../../shared/paging';
import { SERVICE_FEE_ACTION, priceLabel, useServicePrices, type PriceEntry } from '../../../shared/servicePrices';
import { EntryPrice } from '../../../shared/ui/TierPrice';
import { useViewerTier } from '../../../shared/tiers';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { slabLeave, slabMove } from '../../../shared/ui/slabTilt';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { itemClassLabel, itemName } from '../../../shared/itemClasses';
import {
  STATE_META,
  departureLabel,
  stateLabel,
  collectorTimeline,
  timelineDetail,
  timelineKindLabel,
  type Departure,
  type TimelineEvent,
} from '../../../shared/itemTimeline';
import { bpsToPercent, formatDate, formatUsd, isolate } from '../../../shared/money';
import { navigate, useNavigation, useRoute } from '../../../shared/routing';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonBlock,
  StatusBadge,
  SuccessNote,
} from '../../../shared/ui/primitives';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { Serial } from '../../../shared/ui/Serial';
import {
  IconAlert,
  IconAsk,
  IconArchive,
  IconBox,
  IconChart,
  IconChevronRight,
  IconClock,
  IconReceipt,
  IconSearch,
  IconServices,
  IconTag,
  IconVault,
} from '../../../shared/ui/icons';
import { ConsignmentForm } from './ConsignmentForm';
import { GradingForm } from './GradingForm';
import { InspectionForm } from './InspectionForm';
import { CustomRequestForm } from './CustomRequestForm';
import { RemoveCommonsPanel } from './RemoveCommonsPanel';

interface VaultItem {
  id: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  holdFlag?: boolean;
  isLot: boolean;
  lotSize: number;
  lotBroken: boolean;
  oversized?: boolean;
  receivedAt?: string | null;
  historical?: boolean;
  departedAt?: string | null;
  departure?: Departure | null;
  stillOwned?: boolean;
}

interface ItemMedia {
  id: string;
  type: string;
  version: number;
  url: string;
}

interface StorageStatus {
  oversized: boolean;
  freeDays: number;
  periodDays: number;
  percentOfIntakeBps: number;
  intakeMinor: number;
  periodsBilled: number;
  totalChargedMinor: number;
  periodChargeMinor: number;
  freeUntil: string | null;
  nextChargeAt: string | null;
}

interface VaultCounts {
  active: number;
  hold: number;
  history: number;
}

const SCOPES = ['active', 'hold', 'history'] as const;

const SORTS = ['newest', 'oldest', 'name', 'serial'] as const;
type Sort = (typeof SORTS)[number];

function whenOf(item: VaultItem): number {
  const at = item.historical ? item.departedAt : item.receivedAt;
  return at ? new Date(at).getTime() : 0;
}

export function sortVaultItems<T extends VaultItem>(items: readonly T[], sort: Sort, nameOf: (item: T) => string): T[] {
  const out = [...items];
  if (sort === 'newest') out.sort((a, b) => whenOf(b) - whenOf(a));
  else if (sort === 'oldest') out.sort((a, b) => whenOf(a) - whenOf(b));
  else if (sort === 'name') out.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  else out.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
  return out;
}
type Scope = (typeof SCOPES)[number];

const SCOPE_ICON: Record<Scope, ReactNode> = {
  active: <IconVault />,
  hold: <IconClock />,
  history: <IconArchive />,
};

interface OpenServiceRequest {
  code: string;
  type: string;
  status: 'requested' | 'in_progress';
  createdAt: string;
}

interface CardAction {
  key: string;
  label: MessageKey;
  description: MessageKey;
  icon: ReactNode;
  ok: MessageKey;
  confirm?: boolean;
  confirmTitle?: MessageKey;
  confirmBody?: MessageKey;
  states: readonly string[];
  lotOnly?: boolean;
  gradedOnly?: boolean;
  form?: FormKind;
  serviceType?: string;
  run: (item: VaultItem) => Promise<unknown>;
}

type FormKind = 'consignment' | 'grading' | 'inspection' | 'custom';

const CARD_ACTIONS: readonly CardAction[] = [
  {
    key: 'photography',
    serviceType: 'professional_photography',
    label: 'services.photography',
    description: 'services.photography.desc',
    icon: <IconServices />,
    ok: 'services.photographyRequested',
    states: ['stored'],
    run: (item) => api.post('/services/photography', { itemId: item.id }),
  },
  {
    key: 'grading',
    serviceType: 'third_party_grading',
    label: 'services.grading',
    description: 'services.grading.desc',
    icon: <IconChart />,
    ok: 'services.gradingRequested',
    states: ['stored'],
    form: 'grading',
    run: async () => undefined,
  },
  {
    key: 'video',
    serviceType: 'video_review',
    label: 'services.video',
    description: 'services.video.desc',
    icon: <IconServices />,
    ok: 'services.videoRequested',
    states: ['stored', 'listed'],
    run: (item) => api.post('/services/video', { itemId: item.id }),
  },
  {
    key: 'inspection',
    serviceType: 'condition_inspection',
    label: 'services.inspection',
    description: 'services.inspection.desc',
    icon: <IconSearch />,
    ok: 'services.inspectionRequested',
    states: ['stored', 'listed'],
    form: 'inspection',
    run: async () => undefined,
  },
  {
    key: 'lot-split',
    serviceType: 'batch_split',
    label: 'services.lotSplit',
    description: 'services.lotSplit.desc',
    icon: <IconBox />,
    ok: 'services.lotSplitRequested',
    states: ['stored'],
    lotOnly: true,
    run: (item) => api.post('/services/lot-split', { itemId: item.id }),
  },
  {
    key: 'consignment',
    serviceType: 'consignment',
    label: 'services.consignment',
    description: 'services.consignment.desc',
    icon: <IconTag />,
    ok: 'services.consignmentRequested',
    states: ['stored'],
    form: 'consignment',
    run: async () => undefined,
  },
  {
    key: 'buyout',
    serviceType: 'buyout',
    label: 'services.buyout',
    description: 'services.buyout.desc',
    icon: <IconReceipt />,
    ok: 'services.buyoutRequested',
    states: ['stored'],
    run: (item) => api.post('/services/buyout', { itemId: item.id }),
  },
  {
    key: 'custom',
    label: 'custom.action',
    description: 'custom.action.desc',
    icon: <IconAsk />,
    ok: 'custom.requested',
    states: ['stored', 'listed'],
    form: 'custom',
    run: async () => undefined,
  },
  {
    key: 'deslab',
    serviceType: 'deslab',
    label: 'services.deslab',
    description: 'services.deslab.desc',
    icon: <IconAlert />,
    ok: 'services.deslabRequested',
    confirm: true,
    confirmTitle: 'services.deslab.confirmTitle',
    confirmBody: 'services.deslab.confirmBody',
    states: ['stored'],
    gradedOnly: true,
    run: async (item) => {
      const challenge = await api.post<{ confirmationToken: string }>('/services/deslab', {
        itemId: item.id,
      });
      await api.post('/services/deslab/confirm', {
        confirmationToken: challenge.confirmationToken,
      });
    },
  },
  {
    key: 'donation',
    serviceType: 'donation',
    label: 'services.donation',
    description: 'services.donation.desc',
    icon: <IconAlert />,
    ok: 'services.donated',
    confirm: true,
    confirmTitle: 'services.donation.confirmTitle',
    confirmBody: 'services.donation.confirmBody',
    states: ['stored'],
    run: async (item) => {
      const challenge = await api.post<{ confirmationToken: string }>('/services/donation', {
        itemId: item.id,
      });
      await api.post('/services/donation/confirm', {
        confirmationToken: challenge.confirmationToken,
      });
    },
  },
];

export function VaultPage() {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord, setParams } = useNavigation(route);

  const scope: Scope = (SCOPES as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as Scope)
    : 'active';

  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [counts, setCounts] = useState<VaultCounts | null>(null);
  const [q, setQ] = useState(() => route.params.q ?? '');
  const [sort, setSort] = useState<Sort>(() =>
    (SORTS as readonly string[]).includes(route.params.sort ?? '') ? (route.params.sort as Sort) : 'newest',
  );
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusFollow, setStatusFollow] = useState(false);
  const [culling, setCulling] = useState(false);
  const [cullWindowDays, setCullWindowDays] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [shipPicks, setShipPicks] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    const query = new URLSearchParams({ scope });
    if (q) query.set('q', q);
    try {
      const [list, totals] = await Promise.all([
        getAllPages<VaultItem>(`/vault/items?${query.toString()}`),
        api.get<VaultCounts>(`/vault/counts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      ]);
      setItems(list);
      setCounts(totals);
      setLoadFailed(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setLoadFailed(true);
      setItems((prev) => prev ?? []);
    }
  }, [q, scope]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const { windowDays } = await api.get<{ windowDays: number }>('/services/remove-commons/window');
        setCullWindowDays(windowDays);
      } catch {
      }
    })();
  }, []);

  const selected = useMemo(
    () => (items ?? []).find((i) => i.id === route.params.item) ?? null,
    [items, route.params.item],
  );

  const shown = useMemo(
    () => (items === null ? null : sortVaultItems(items, sort, (item) => itemName(t, item))),
    [items, sort, t],
  );

  const goScope = (next: Scope) => {
    setStatus(null);
    navigate({ section: route.section, tab: next, params: sort === 'newest' ? {} : { sort } });
  };
  const chooseSort = (next: Sort) => {
    setSort(next);
    setParams({ sort: next === 'newest' ? null : next });
  };

  const countFor = (s: Scope) => (counts ? counts[s] : undefined);

  const canShip = (item: VaultItem) => item.lifecycleState === 'stored' && !item.historical && !item.holdFlag;
  const togglePick = (id: string) =>
    setShipPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setShipPicks(new Set());
  };
  const shippable = (items ?? []).filter(canShip);
  const allPicked = shippable.length > 0 && shippable.every((item) => shipPicks.has(item.id));
  const pickAll = () =>
    setShipPicks(allPicked ? new Set() : new Set(shippable.map((item) => item.id)));
  const shipThese = () =>
    navigate({ section: 'shipping-services', tab: 'shipping', params: { items: Array.from(shipPicks).join(',') } });

  return (
    <>
      <div className="vault-command">
        <div className="vault-search">
          <IconSearch />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('vault.searchPlaceholder')}
            aria-label={t('vault.search')}
          />
        </div>

        <div className="state-controls" role="group" aria-label={t('vault.stateGroup')}>
          {SCOPES.map((s) => {
            const count = countFor(s);
            const label = t(`vault.scope.${s}` as MessageKey);
            return (
              <button
                key={s}
                type="button"
                className={`state-control${scope === s ? ' is-on' : ''}`}
                aria-pressed={scope === s}
                title={label}
                aria-label={
                  count === undefined ? label : t('vault.scopeWithCount', { label, count })
                }
                onClick={() => goScope(s)}
              >
                <span className="state-icon" aria-hidden="true">
                  {SCOPE_ICON[s]}
                </span>
                <span className="state-label">{label}</span>
                {count !== undefined && (
                  <span className="state-count" aria-hidden="true">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <select
          className="vault-sort"
          value={sort}
          aria-label={t('vault.sort.label')}
          onChange={(e) => chooseSort(e.target.value as Sort)}
        >
          {SORTS.map((key) => (
            <option key={key} value={key}>
              {t(`vault.sort.${key}` as MessageKey)}
            </option>
          ))}
        </select>

        <span className="spacer" />

        {items !== null && (
          <span className="vault-count" role="status">
            {items.length === 1 ? t('vault.assetsCountOne') : t('vault.assetsCount', { count: items.length })}
          </span>
        )}
        {scope === 'active' && (
          <Button size="sm" pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
            {selecting ? t('vault.select.stop') : t('vault.select.start')}
          </Button>
        )}
        {scope === 'active' && cullWindowDays !== null && (
          <Button size="sm" onClick={() => setCulling((v) => !v)}>
            {culling ? t('cull.close') : t('cull.open')}
          </Button>
        )}
      </div>

      {status && (
        <div className="row">
          <SuccessNote>{status}</SuccessNote>
          {statusFollow && (
            <Button size="sm" variant="ghost" onClick={() => navigate({ section: 'shipping-services', tab: 'requests' })}>
              {t('vault.acted.follow')}
            </Button>
          )}
        </div>
      )}
      {error && (
        <ErrorState
          title={loadFailed ? t('vault.loadFailed') : undefined}
          message={error}
          onRetry={() => {
            setError(null);
            void load();
          }}
          retryLabel={t('ui.retry')}
        />
      )}

      {culling && cullWindowDays !== null && (
        <RemoveCommonsPanel
          items={items ?? []}
          windowDays={cullWindowDays}
          onDone={(message) => {
            setStatus(message);
            setStatusFollow(false);
            setCulling(false);
            void load();
          }}
          onError={setError}
        />
      )}

      <Panel flush>
        {scope === 'history' && (
          <p className="hint vault-history-note">{t('vault.history.note')}</p>
        )}
        {selecting && scope === 'active' && (
          <p className="hint vault-history-note">{t('vault.select.hint')}</p>
        )}

        {shown === null ? (
          <ul className="card-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <SkeletonBlock className="skel-metric" />
              </li>
            ))}
          </ul>
        ) : shown.length === 0 && loadFailed ? null : shown.length === 0 ? (
          <EmptyState
            title={t(`vault.empty.${scope}` as MessageKey)}
            text={q ? t('vault.empty.searchText') : t(`vault.empty.${scope}Text` as MessageKey)}
            icon={scope === 'history' ? <IconArchive /> : <IconBox />}
            action={
              q ? (
                <Button size="sm" onClick={() => setQ('')}>
                  {t('vault.clearSearch')}
                </Button>
              ) : scope === 'active' ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => navigate({ section: 'inbound', tab: 'addresses' })}
                >
                  {t('vault.empty.getStarted')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="card-grid card-grid--register">
            {shown.map((item) => (
              <CardTile
                key={item.id}
                item={item}
                t={t}
                locale={locale}
                onOpen={() => openRecord('item', item.id)}
                select={
                  selecting && scope === 'active'
                    ? { on: shipPicks.has(item.id), can: canShip(item), toggle: () => togglePick(item.id) }
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      {selecting && scope === 'active' && (
        <div className="vault-select-bar" role="region" aria-label={t('vault.select.bar')}>
          <span className="vault-select-count" role="status">
            {t('vault.select.count', { count: shipPicks.size })}
          </span>
          <span className="spacer" />
          <Button variant="ghost" size="sm" pressed={allPicked} disabled={shippable.length === 0} onClick={pickAll}>
            {t('vault.select.all', { count: shippable.length })}
          </Button>
          <Button variant="ghost" size="sm" onClick={stopSelecting}>
            {t('vault.select.stop')}
          </Button>
          <Button variant="primary" size="sm" icon={<IconBox />} disabled={shipPicks.size === 0} onClick={shipThese}>
            {t('vault.select.ship')}
          </Button>
        </div>
      )}

      {selected && (
        <ItemDrawer
          item={selected}
          locale={locale}
          t={t}
          onClose={() => closeRecord('item')}
          onActed={(message) => {
            setStatus(message);
            setStatusFollow(true);
            void load();
          }}
          onShip={
            canShip(selected)
              ? () => navigate({ section: 'shipping-services', tab: 'shipping', params: { items: selected.id } })
              : undefined
          }
        />
      )}
    </>
  );
}

function CardTile({
  item,
  t,
  locale,
  onOpen,
  select,
}: {
  item: VaultItem;
  t: TranslateFn;
  locale: string;
  onOpen: () => void;
  select?: { on: boolean; can: boolean; toggle: () => void };
}) {
  const meta = STATE_META[item.lifecycleState];
  const historical = Boolean(item.historical);
  const frozen = Boolean(item.holdFlag) && !historical;
  const name = itemName(t, item);

  return (
    <li
      className={[
        'card',
        'card--interactive',
        historical ? 'card--historical' : '',
        frozen ? 'card--frozen' : '',
        select ? (select.can ? 'card--selectable' : 'card--unselectable') : '',
        select?.on ? 'card--picked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerMove={slabMove}
      onPointerLeave={slabLeave}
    >
      {select ? (
        <button
          type="button"
          className="card-hit"
          aria-pressed={select.on}
          disabled={!select.can}
          onClick={select.toggle}
        >
          <span className="sr-only">
            {select.can ? t('vault.select.card', { name }) : t('vault.select.cannot', { name })}
          </span>
        </button>
      ) : (
        <button type="button" className="card-hit" onClick={onOpen}>
          <span className="sr-only">{t('vault.openCard', { name })}</span>
        </button>
      )}
      {select?.can && <span className={`card-pick-mark${select.on ? ' is-on' : ''}`} aria-hidden="true" />}

      <div className="card-art">
        <CardPhotoThumb serialNumber={item.serialNumber} title={name} decorative />
        {historical && (
          <span className="card-archive-mark" aria-hidden="true">
            <IconArchive />
          </span>
        )}
      </div>

      <div className="card-id">
        <h3 className="card-title">
          <Serial value={item.serialNumber} lead />
        </h3>
        <p className="card-desc" title={name}>
          {name}
        </p>
      </div>

      <div className="card-state">
        {historical ? (
          <StatusBadge tone="neutral">
            {t('vault.historical.status', { state: stateLabel(t, item.lifecycleState) })}
          </StatusBadge>
        ) : frozen ? (
          <span className="pill pill--frozen">{t('vault.frozen.label')}</span>
        ) : (
          <StatusBadge tone={meta?.tone ?? 'neutral'}>{stateLabel(t, item.lifecycleState)}</StatusBadge>
        )}
        <span className="card-sub">{t('vault.condition', { grade: item.conditionGrade ?? '—' })}</span>
        {item.isLot && !item.lotBroken && (
          <StatusBadge tone="violet">{t('vault.lotOf', { count: item.lotSize })}</StatusBadge>
        )}
        {item.oversized && !historical && (
          <StatusBadge tone="warning">{t('vault.oversized')}</StatusBadge>
        )}
      </div>

      <div className="card-where">
        {historical ? (
          <>
            {item.departedAt && (
              <span>
                {t('vault.historical.onLabel')} <span className="date">{formatDate(item.departedAt, locale)}</span>
              </span>
            )}
            {item.departure && <span className="card-sub">{departureLabel(t, item.departure)}</span>}
          </>
        ) : (
          item.receivedAt && (
            <span>
              {t('vault.sinceLabel')} <span className="date">{formatDate(item.receivedAt, locale)}</span>
            </span>
          )
        )}
      </div>

    </li>
  );
}

function ItemMediaGallery({
  media,
  title,
  t,
}: {
  media: ItemMedia[];
  title: string;
  t: TranslateFn;
}) {
  const ordered = [...media].sort((a, b) => b.version - a.version);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

  return (
    <>
      <h3 className="drawer-heading">{t('vault.media.title')}</h3>
      <ul className="media-strip">
        {ordered.map((m) => (
          <li key={m.id} className="media-item">
            {failed.has(m.id) ? (
              <span className="media-missing">{t('vault.media.unavailable')}</span>
            ) : m.type === 'video' ? (
              <video
                src={m.url}
                controls
                preload="metadata"
                playsInline
                onError={() => setFailed((prev) => new Set(prev).add(m.id))}
              />
            ) : (
              <img
                src={m.url}
                alt={t('vault.media.alt', { title, version: m.version })}
                loading="lazy"
                width={152}
                height={200}
                onError={() => setFailed((prev) => new Set(prev).add(m.id))}
              />
            )}
            <span className="hint">
              {t(`vault.media.type.${m.type}` as MessageKey)} · {t('vault.media.version', { version: m.version })}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function StoragePanel({
  storage,
  locale,
  t,
}: {
  storage: StorageStatus;
  locale: string;
  t: TranslateFn;
}) {
  const included = storage.periodsBilled === 0 && storage.freeUntil
    ? new Date(storage.freeUntil).getTime() > Date.now()
    : false;

  return (
    <>
      <h3 className="drawer-heading">{t('vault.storage.title')}</h3>

      {storage.oversized && (
        <p className="drawer-note drawer-note--hold">
          <IconAlert />
          <span>
            {t('vault.storage.oversizedNote', {
              days: storage.freeDays,
              period: storage.periodDays,
            })}
          </span>
        </p>
      )}

      <dl className="detail-list">
        <div className="detail-row">
          <dt className="detail-label">{t('vault.storage.terms')}</dt>
          <dd className="detail-value">
            {t('vault.storage.termsValue', {
              days: storage.freeDays,
              percent: bpsToPercent(storage.percentOfIntakeBps),
              period: storage.periodDays,
            })}
          </dd>
        </div>

        {included ? (
          <div className="detail-row">
            <dt className="detail-label">{t('vault.storage.included')}</dt>
            <dd className="detail-value">
              <StatusBadge tone="success">{t('vault.storage.freeNow')}</StatusBadge>
              {storage.freeUntil && (
                <span className="detail-value-sub">
                  {t('vault.storage.until', { date: formatDate(storage.freeUntil, locale) })}
                </span>
              )}
            </dd>
          </div>
        ) : (
          <>
            <div className="detail-row">
              <dt className="detail-label">{t('vault.storage.chargedSoFar')}</dt>
              <dd className="detail-value" dir="ltr">
                {formatUsd(storage.totalChargedMinor)}
                <span className="detail-value-sub">
                  {t('vault.storage.periods', { count: storage.periodsBilled })}
                </span>
              </dd>
            </div>
            {storage.nextChargeAt && (
              <div className="detail-row">
                <dt className="detail-label">{t('vault.storage.next')}</dt>
                <dd className="detail-value">
                  {formatDate(storage.nextChargeAt, locale)}
                  <span className="detail-value-sub">
                    {t('vault.storage.nextAmount', {
                      amount: formatUsd(storage.periodChargeMinor),
                    })}
                  </span>
                </dd>
              </div>
            )}
          </>
        )}
      </dl>
    </>
  );
}

function ItemDrawer({
  item,
  locale,
  t,
  onClose,
  onActed,
  onShip,
}: {
  item: VaultItem;
  locale: string;
  t: TranslateFn;
  onClose: () => void;
  onActed: (message: string) => void;
  onShip?: () => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [timelineFailed, setTimelineFailed] = useState(false);
  const [timelineTry, setTimelineTry] = useState(0);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [storageTry, setStorageTry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<ItemMedia[] | null>(null);
  const [openRequests, setOpenRequests] = useState<OpenServiceRequest[]>([]);
  const prices = useServicePrices();
  const viewer = useViewerTier();
  const feeOf = (entry: PriceEntry | undefined) => (entry && priceLabel(entry) ? <EntryPrice entry={entry} /> : null);
  const [confirming, setConfirming] = useState<CardAction | null>(null);
  const [formOpen, setFormOpen] = useState<FormKind | null>(null);
  const returnTo = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = STATE_META[item.lifecycleState];
  const historical = Boolean(item.historical);

  useEffect(() => {
    setEvents(null);
    setTimelineFailed(false);
    void (async () => {
      try {
        setEvents(collectorTimeline(await api.get<TimelineEvent[]>(`/vault/items/${item.id}/timeline`)));
      } catch {
        setTimelineFailed(true);
      }
    })();
  }, [item.id, timelineTry]);

  useEffect(() => {
    setMedia(null);
    if (historical) {
      setMedia([]);
      setOpenRequests([]);
      return;
    }
    void (async () => {
      try {
        const card = await api.get<{ images: ItemMedia[]; openRequests?: OpenServiceRequest[] }>(
          `/vault/items/${item.id}`,
        );
        setMedia(card.images ?? []);
        setOpenRequests(card.openRequests ?? []);
      } catch {
        setMedia([]);
        setOpenRequests([]);
      }
    })();
  }, [item.id, historical]);

  useEffect(() => {
    setStorage(null);
    setStorageFailed(false);
    if (historical) return;
    void (async () => {
      try {
        setStorage(await api.get<StorageStatus>(`/vault/items/${item.id}/storage`));
      } catch {
        setStorageFailed(true);
      }
    })();
  }, [item.id, historical, storageTry]);

  useEffect(() => {
    if (formOpen !== null || returnTo.current === null) return;
    const key = returnTo.current;
    returnTo.current = null;
    document.querySelector<HTMLElement>(`[data-action="${key}"]`)?.focus();
  }, [formOpen]);

  const graded = Boolean(item.conditionGrade && !/^raw$/i.test(item.conditionGrade));
  const actions = historical || item.holdFlag
    ? []
    : CARD_ACTIONS.filter(
        (a) =>
          a.states.includes(item.lifecycleState) &&
          (!a.lotOnly || (item.isLot && !item.lotBroken)) &&
          (!a.gradedOnly || graded),
      );

  async function run(action: CardAction) {
    setBusy(true);
    try {
      await action.run(item);
      setError(null);
      onActed(t(action.ok));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const name = itemName(t, item);
  const frozen = Boolean(item.holdFlag) && !historical;

  return (
    <>
      <DetailDrawer
        title={name}
        lead={
          <span className="identity">
            <Serial value={item.serialNumber} lead className="identity-serial" />
            {historical ? (
              <StatusBadge tone="neutral">
                {t('vault.historical.status', { state: stateLabel(t, item.lifecycleState) })}
              </StatusBadge>
            ) : frozen ? (
              <span className="pill pill--frozen">{t('vault.frozen.label')}</span>
            ) : (
              <StatusBadge tone={meta?.tone ?? 'neutral'}>
                {stateLabel(t, item.lifecycleState)}
              </StatusBadge>
            )}
            <span className="identity-name">{name}</span>
          </span>
        }
        subtitle={undefined}
        wide
        flush
        onClose={onClose}
        footer={
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        }
      >
        <div className={historical ? 'stage stage--departed' : 'stage'}>
          <CardPhotoThumb serialNumber={item.serialNumber} title={name} />
        </div>

        <div className="sheet-cols">
          <div className="sheet-col">
            {frozen && (
              <p className="frozen-reason">
                <IconClock />
                <span>
                  {t('vault.frozen.reason', { reason: '' })}{' '}
                  {t('vault.frozen.actionsNote')}
                </span>
              </p>
            )}
            {frozen && (
              <Button size="sm" variant="ghost" onClick={() => navigate({ section: 'support', tab: 'new' })}>
                {t('vault.frozen.ask')}
              </Button>
            )}

            {historical && (
              <p className="departed-note">
                <IconArchive />
                <span>{t('vault.historical.drawerNote')}</span>
              </p>
            )}

        <dl className="detail-list">
          <div className="detail-row">
            <dt className="detail-label">{t('vault.class')}</dt>
            <dd className="detail-value">{itemClassLabel(t, item.typeClass)}</dd>
          </div>
          <div className="detail-row">
            <dt className="detail-label">{t('vault.item.condition')}</dt>
            <dd className="detail-value">{item.conditionGrade ?? '—'}</dd>
          </div>

          {historical ? (
            <>
              {item.departedAt && (
                <div className="detail-row">
                  <dt className="detail-label">{t('vault.historical.dateLabel')}</dt>
                  <dd className="detail-value">
                    {formatDate(item.departedAt, locale)}
                  </dd>
                </div>
              )}
              {item.departure && (
                <div className="detail-row">
                  <dt className="detail-label">{t('vault.historical.reasonLabel')}</dt>
                  <dd className="detail-value">{departureLabel(t, item.departure)}</dd>
                </div>
              )}
            </>
          ) : (
            item.receivedAt && (
              <div className="detail-row">
                <dt className="detail-label">{t('vault.item.received')}</dt>
                <dd className="detail-value">
                  <span className="date">{formatDate(item.receivedAt, locale)}</span>
                </dd>
              </div>
            )
          )}

          {item.isLot && (
            <div className="detail-row">
              <dt className="detail-label">{t('vault.isLot')}</dt>
              <dd className="detail-value">{t('vault.lotOf', { count: item.lotSize })}</dd>
            </div>
          )}
        </dl>

        {error && <ErrorState message={error} />}

        {storage && <StoragePanel storage={storage} locale={locale} t={t} />}
        {storageFailed && (
          <ErrorState
            title={t('vault.storage.title')}
            message={t('vault.storage.failed')}
            onRetry={() => setStorageTry((n) => n + 1)}
            retryLabel={t('ui.retry')}
          />
        )}

        {media !== null && media.length > 0 && <ItemMediaGallery media={media} title={name} t={t} />}

        {actions.length > 0 && formOpen === null && (
          <>
            <h3 className="drawer-heading">{t('vault.actions.title')}</h3>
            <ul className="service-menu">
              {onShip && (
                <li>
                  <Button
                    className="btn--row"
                    variant="secondary"
                    icon={<IconBox />}
                    data-action="ship"
                    aria-labelledby="svc-ship-name"
                    aria-describedby="svc-ship-desc"
                    onClick={onShip}
                  >
                    <span className="btn-row-line">
                      <span className="btn-row-name" id="svc-ship-name">
                        {t('vault.drawer.ship')}
                      </span>
                      <span className="btn-row-end">
                        <IconChevronRight />
                      </span>
                    </span>
                    <span className="btn-row-desc" id="svc-ship-desc">
                      {t('vault.drawer.shipDesc')}
                    </span>
                  </Button>
                </li>
              )}
              {item.lifecycleState === 'stored' && (
                <li>
                  <Button
                    className="btn--row"
                    variant="secondary"
                    icon={<IconTag />}
                    data-action="sell"
                    aria-labelledby="svc-sell-name"
                    aria-describedby="svc-sell-desc"
                    onClick={() => navigate({ section: 'marketplace', tab: 'sell', params: { item: item.id } })}
                  >
                    <span className="btn-row-line">
                      <span className="btn-row-name" id="svc-sell-name">
                        {t('vault.drawer.sell')}
                      </span>
                      <span className="btn-row-end">
                        <IconChevronRight />
                      </span>
                    </span>
                    <span className="btn-row-desc" id="svc-sell-desc">
                      {t('vault.drawer.sellDesc')}
                    </span>
                  </Button>
                </li>
              )}
              {actions.map((action) => {
                const price = feeOf(prices.get(SERVICE_FEE_ACTION[action.key] ?? ''));
                const pending = action.serviceType
                  ? openRequests.find((r) => r.type === action.serviceType)
                  : undefined;
                const nameId = `svc-${action.key}-name`;
                const descId = `svc-${action.key}-desc`;
                return (
                  <li key={action.key}>
                    <Button
                      className="btn--row"
                      variant={action.confirm ? 'danger' : 'secondary'}
                      icon={action.icon}
                      disabled={busy || Boolean(pending)}
                      data-action={action.key}
                      aria-labelledby={nameId}
                      aria-describedby={descId}
                      onClick={() => {
                        if (action.form) {
                          returnTo.current = action.key;
                          setFormOpen(action.form);
                        } else if (action.confirm) {
                          setConfirming(action);
                        } else {
                          void run(action);
                        }
                      }}
                    >
                      <span className="btn-row-line">
                        <span className="btn-row-name" id={nameId}>
                          {t(action.label)}
                        </span>
                        <span className="btn-row-end">
                          {price && !pending && price}
                          {action.form && !pending && <IconChevronRight />}
                        </span>
                      </span>
                      <span className="btn-row-desc" id={descId}>
                        {pending
                          ? t(
                              pending.status === 'in_progress'
                                ? 'services.pending.underway'
                                : 'services.pending.queued',
                              { code: pending.code },
                            )
                          : t(action.description)}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {formOpen === 'consignment' && (
          <ConsignmentForm
            item={item}
            fee={feeOf(prices.get(SERVICE_FEE_ACTION.consignment ?? ''))}
            onCancel={() => setFormOpen(null)}
            onDone={(message) => {
              setFormOpen(null);
              onActed(message);
              onClose();
            }}
            onError={setError}
          />
        )}

        {formOpen === 'grading' && (
          <GradingForm
            item={item}
            onCancel={() => setFormOpen(null)}
            onDone={(message) => {
              setFormOpen(null);
              onActed(message);
              onClose();
            }}
            onError={setError}
          />
        )}

        {formOpen === 'custom' && (
          <CustomRequestForm
            itemId={item.id}
            onCancel={() => setFormOpen(null)}
            onDone={(message) => {
              setFormOpen(null);
              onActed(message);
              onClose();
            }}
            onError={setError}
          />
        )}

        {formOpen === 'inspection' && (
          <InspectionForm
            item={item}
            fee={feeOf(prices.get(SERVICE_FEE_ACTION.inspection ?? ''))}
            onCancel={() => setFormOpen(null)}
            onDone={(message) => {
              setFormOpen(null);
              onActed(message);
              onClose();
            }}
            onError={setError}
          />
        )}

          </div>

          <div className="sheet-col sheet-col--register">
            <h3 className="drawer-heading">{t('vault.historyTitle')}</h3>

            {timelineFailed ? (
              <ErrorState
                message={t('vault.historyFailed')}
                onRetry={() => setTimelineTry((n) => n + 1)}
                retryLabel={t('ui.retry')}
              />
            ) : events === null ? (
              <p className="hint" role="status">
                {t('vault.historyLoading')}
              </p>
            ) : events.length === 0 ? (
              <EmptyState title={t('vault.historyEmpty')} />
            ) : (
              <ul className="timeline">
                {events.map((event, index) => {
                  const detail = timelineDetail(t, event);
                  return (
                    <li key={`${event.at}-${index}`}>
                      <span className="hint date">{formatDate(event.at, locale)}</span>
                      <div>
                        <span className="register-kind">{timelineKindLabel(t, event.kind)}</span>
                        {detail && <p className="register-entry">{detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </DetailDrawer>

      {confirming && (
        <ConfirmationModal
          title={t(confirming.confirmTitle ?? 'services.donation.confirmTitle')}
          body={
            <>
              <p>
                {t(confirming.confirmBody ?? 'services.donation.confirmBody', {
                  item: isolate(itemName(t, item)),
                })}
              </p>
              {(() => {
                const fee = priceLabel(prices.get(SERVICE_FEE_ACTION[confirming.key] ?? ''), viewer.discountBps);
                return fee ? <p className="hint">{t('services.confirmFee', { amount: fee })}</p> : null;
              })()}
            </>
          }
          confirmLabel={t(confirming.label)}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          busy={busy}
          onConfirm={() => void run(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
