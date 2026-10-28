import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { SERVICE_FEE_ACTION, priceLabel, useServicePrices } from '../../../shared/servicePrices';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { slabLeave, slabMove } from '../../../shared/ui/slabTilt';
import { BarcodeLabel } from '../../../shared/Barcode';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { itemClassLabel, itemName } from '../../../shared/itemClasses';
import {
  STATE_META,
  departureLabel,
  stateLabel,
  timelineDetail,
  timelineKindLabel,
  type Departure,
  type TimelineEvent,
} from '../../../shared/itemTimeline';
import { formatDate, formatUsd, isolate } from '../../../shared/money';
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
import { Code, Serial } from '../../../shared/ui/Serial';
import {
  IconAlert,
  IconAsk,
  IconArchive,
  IconBox,
  IconChart,
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

interface BreakEvenRow {
  itemId: string;
  storageSpentMinor: number;
  totalSpentMinor: number;
  projectedYearMinor: number;
  estimatedValueMinor: number | null;
  valueBasis: 'sold_comparable' | 'own_asking_price' | 'unknown';
  comparableCount: number;
  pastBreakEven: boolean;
  monthsToBreakEven: number | null;
}

interface VaultItem {
  id: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  barcode: string;
  binBarcode: string | null;
  binZone: string | null;
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
  const { openRecord, closeRecord, goTab } = useNavigation(route);

  const scope: Scope = (SCOPES as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as Scope)
    : 'active';

  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [counts, setCounts] = useState<VaultCounts | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [culling, setCulling] = useState(false);
  const [cullWindowDays, setCullWindowDays] = useState<number | null>(null);
  const [watch, setWatch] = useState<Map<string, BreakEvenRow>>(() => new Map());

  const load = useCallback(async () => {
    const query = new URLSearchParams({ scope });
    if (q) query.set('q', q);
    try {
      const [list, totals] = await Promise.all([
        api.get<VaultItem[]>(`/vault/items?${query.toString()}`),
        api.get<VaultCounts>(`/vault/counts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      ]);
      setItems(list);
      setCounts(totals);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, [q, scope]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const summary = await api.get<{ items: BreakEvenRow[] }>('/vault/break-even');
        setWatch(new Map(summary.items.map((row) => [row.itemId, row])));
      } catch {
      }
    })();
  }, []);

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

  const countFor = (s: Scope) => (counts ? counts[s] : undefined);

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
                onClick={() => goTab(s)}
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

        <span className="spacer" />

        {items !== null && (
          <span className="vault-count">{t('vault.assetsCount', { count: items.length })}</span>
        )}
        {scope === 'active' && cullWindowDays !== null && (
          <Button size="sm" onClick={() => setCulling((v) => !v)}>
            {culling ? t('cull.close') : t('cull.open')}
          </Button>
        )}
      </div>

      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} />}

      {culling && cullWindowDays !== null && (
        <RemoveCommonsPanel
          items={items ?? []}
          windowDays={cullWindowDays}
          onDone={(message) => {
            setStatus(message);
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

        {items === null ? (
          <ul className="card-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <SkeletonBlock className="skel-metric" />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
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
            {items.map((item) => (
              <CardTile
                key={item.id}
                item={item}
                watch={watch.get(item.id)}
                t={t}
                locale={locale}
                onOpen={() => openRecord('item', item.id)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {selected && (
        <ItemDrawer
          item={selected}
          locale={locale}
          t={t}
          onClose={() => closeRecord('item')}
          onActed={(message) => {
            setStatus(message);
            void load();
          }}
        />
      )}
    </>
  );
}

function CardTile({
  item,
  watch,
  t,
  locale,
  onOpen,
}: {
  item: VaultItem;
  watch?: BreakEvenRow;
  t: TranslateFn;
  locale: string;
  onOpen: () => void;
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
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerMove={slabMove}
      onPointerLeave={slabLeave}
    >
      <button type="button" className="card-hit" onClick={onOpen}>
        <span className="sr-only">{t('vault.openCard', { name })}</span>
      </button>

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
              <span className="date">
                {t('vault.historical.on', { date: formatDate(item.departedAt, locale) })}
              </span>
            )}
            {item.departure && <span className="card-sub">{departureLabel(t, item.departure)}</span>}
          </>
        ) : (
          item.binBarcode ? (
            <Code value={`${item.binBarcode} · ${item.binZone ?? ''}`.trim()} />
          ) : (
            <span>{t('vault.noBin')}</span>
          )
        )}
      </div>

      {watch && !historical ? <Watch row={watch} t={t} /> : <div className="watch" />}
    </li>
  );
}

function Watch({ row, t }: { row: BreakEvenRow; t: TranslateFn }) {
  const value = row.estimatedValueMinor;
  const known = value !== null && value > 0;
  const ratio = known ? Math.min(row.totalSpentMinor / value, 1) : 0;
  const tone = row.pastBreakEven ? 'proportion--over' : ratio >= 0.66 ? 'proportion--watch' : '';

  return (
    <div className="watch">
      <div className="watch-line">
        <span className="money-label">{t('vault.col.cost')}</span>
        <span className="watch-amount">{formatUsd(row.totalSpentMinor)}</span>
      </div>
      {known ? (
        <>
          <span
            className={`proportion ${tone}`.trim()}
            role="img"
            aria-label={
              row.pastBreakEven
                ? t('vault.watch.past')
                : row.monthsToBreakEven !== null
                  ? t('vault.watch.months', { count: row.monthsToBreakEven })
                  : t('vault.watch.spent')
            }
          >
            <span style={{ inlineSize: `${Math.round(ratio * 100)}%` }} />
          </span>
          <span className="watch-line">
            {row.pastBreakEven
              ? t('vault.watch.past')
              : row.valueBasis === 'sold_comparable' && row.comparableCount === 1
                ? t('vault.watch.basis.sold_comparable_one')
                : t(`vault.watch.basis.${row.valueBasis}` as MessageKey, {
                    count: row.comparableCount,
                  })}
          </span>
        </>
      ) : (
        <span className="watch-line">{t('vault.watch.basis.unknown')}</span>
      )}
    </div>
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
              percent: (storage.percentOfIntakeBps / 100).toFixed(0),
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
}: {
  item: VaultItem;
  locale: string;
  t: TranslateFn;
  onClose: () => void;
  onActed: (message: string) => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<ItemMedia[] | null>(null);
  const [openRequests, setOpenRequests] = useState<OpenServiceRequest[]>([]);
  const prices = useServicePrices();
  const [confirming, setConfirming] = useState<CardAction | null>(null);
  const [formOpen, setFormOpen] = useState<FormKind | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = STATE_META[item.lifecycleState];
  const historical = Boolean(item.historical);

  useEffect(() => {
    void (async () => {
      try {
        setEvents(await api.get<TimelineEvent[]>(`/vault/items/${item.id}/timeline`));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
        setEvents([]);
      }
    })();
  }, [item.id]);

  useEffect(() => {
    setMedia(null);
    // A card that has left the vault has no card page to ask for (the server answers 404): there are no
    // photographs of it to load and nothing open on it.
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
    if (historical) return;
    void (async () => {
      try {
        setStorage(await api.get<StorageStatus>(`/vault/items/${item.id}/storage`));
      } catch {
      }
    })();
  }, [item.id, historical]);

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
            <div className="detail-row">
              <dt className="detail-label">{t('vault.item.bin')}</dt>
              <dd className="detail-value">
                {item.binBarcode ? <Code value={`${item.binBarcode} · ${item.binZone ?? ''}`.trim()} /> : t('vault.noBin')}
              </dd>
            </div>
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

        {media !== null && media.length > 0 && <ItemMediaGallery media={media} title={name} t={t} />}

        {actions.length > 0 && (
          <>
            <h3 className="drawer-heading">{t('vault.actions.title')}</h3>
            <ul className="drawer-actions">
              {actions.map((action) => {
                const price = priceLabel(prices.get(SERVICE_FEE_ACTION[action.key] ?? ''));
                const pending = action.serviceType
                  ? openRequests.find((r) => r.type === action.serviceType)
                  : undefined;
                return (
                  <li key={action.key}>
                    <Button
                      size="sm"
                      variant={action.confirm ? 'danger' : 'secondary'}
                      icon={action.icon}
                      disabled={busy || Boolean(pending)}
                      block
                      onClick={() =>
                        action.form
                          ? setFormOpen(action.form)
                          : action.confirm
                            ? setConfirming(action)
                            : void run(action)
                      }
                    >
                      <span className="action-line">
                        <span>{t(action.label)}</span>
                        {price && !pending && (
                          <span className="action-price" dir="ltr">
                            {price}
                          </span>
                        )}
                      </span>
                    </Button>
                    <p className="hint">
                      {pending
                        ? t(
                            pending.status === 'in_progress'
                              ? 'services.pending.underway'
                              : 'services.pending.queued',
                            { code: pending.code },
                          )
                        : t(action.description)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {formOpen === 'consignment' && (
          <ConsignmentForm
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
            onCancel={() => setFormOpen(null)}
            onDone={(message) => {
              setFormOpen(null);
              onActed(message);
              onClose();
            }}
            onError={setError}
          />
        )}

            <div className="stack-top-lg">
              <BarcodeLabel value={item.barcode} caption={name} />
            </div>
          </div>

          <div className="sheet-col sheet-col--register">
            <h3 className="drawer-heading">{t('vault.historyTitle')}</h3>

            {events === null ? (
              <p className="hint">{t('vault.historyLoading')}</p>
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
                const fee = priceLabel(prices.get(SERVICE_FEE_ACTION[confirming.key] ?? ''));
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
