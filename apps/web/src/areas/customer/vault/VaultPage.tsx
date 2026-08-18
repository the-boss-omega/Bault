import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { BarcodeLabel } from '../../../shared/Barcode';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { formatDate, formatUsd } from '../../../shared/money';
import { useNavigation, useRoute } from '../../../shared/routing';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonBlock,
  StatusBadge,
  SuccessNote,
  type StatusTone,
} from '../../../shared/ui/primitives';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';
import {
  IconAlert,
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
import { RemoveCommonsPanel } from './RemoveCommonsPanel';

interface VaultItem {
  id: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  barcode: string;
  /** Where the item physically sits — every live item has a bin (Req 10.3). */
  binBarcode: string | null;
  binZone: string | null;
  holdFlag?: boolean;
  isLot: boolean;
  lotSize: number;
  lotBroken: boolean;
  /** On the much shorter oversized storage terms — fixed at intake. */
  oversized?: boolean;
  /** When it arrived. The cull window is measured from this. */
  receivedAt?: string | null;
  /** Present only on the history scope. */
  historical?: boolean;
  departedAt?: string | null;
  departureReason?: string | null;
  stillOwned?: boolean;
}

/**
 * One stored image or video for the card, with a signed URL.
 *
 * `intake` is what the warehouse shot on arrival; `professional` is what a photo
 * shoot produced; `video` is the card turned under a light. All three are
 * versions of the same thing and live in the same table, newest version last.
 */
interface ItemMedia {
  id: string;
  type: string;
  version: number;
  url: string;
}

/** One entry of the item's complete history timeline (Requirement 13.2). */
interface TimelineEvent {
  at: string;
  kind: string;
  summary: string;
}

/**
 * `GET /vault/items/:id/storage`.
 *
 * Everything about the past is what was actually charged; only `nextChargeAt`
 * and `periodChargeMinor` are forecasts, and both come from the same rule the
 * billing sweep reads.
 */
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

/** Lifecycle state → badge tone + label key. */
const STATE_META: Record<string, { tone: StatusTone; label: MessageKey }> = {
  stored: { tone: 'success', label: 'vault.state.stored' },
  listed: { tone: 'info', label: 'vault.state.listed' },
  sold: { tone: 'gold', label: 'vault.state.sold' },
  'on-hold': { tone: 'error', label: 'vault.state.onHold' },
  received: { tone: 'info', label: 'vault.state.received' },
  shipped: { tone: 'violet', label: 'vault.state.shipped' },
  donated: { tone: 'success', label: 'vault.state.donated' },
  consigned: { tone: 'info', label: 'vault.state.consigned' },
  /**
   * Physically at a grader, on the other side of the country. It is its own
   * state precisely so the card cannot be listed, sold or shipped while it is
   * gone — which it silently could be before.
   */
  at_grader: { tone: 'violet', label: 'vault.state.atGrader' },
  discarded: { tone: 'neutral', label: 'vault.state.discarded' },
};

function stateLabel(t: TranslateFn, state: string): string {
  const meta = STATE_META[state];
  return meta ? t(meta.label) : state;
}

/**
 * The three states a card can be in from the collector's point of view. These
 * are the vault's primary controls — switching one refetches that scope and
 * nothing else: the shell, the header and the search text all stay put.
 */
const SCOPES = ['active', 'hold', 'history'] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_ICON: Record<Scope, ReactNode> = {
  active: <IconVault />,
  hold: <IconClock />,
  history: <IconArchive />,
};

/* ============================================================
   Card actions — every one backed by a real endpoint
   ============================================================ */

interface CardAction {
  key: string;
  label: MessageKey;
  description: MessageKey;
  icon: ReactNode;
  ok: MessageKey;
  /** Irreversible actions go through a typed confirmation first. */
  confirm?: boolean;
  /** What the confirmation says. Required whenever `confirm` is set. */
  confirmTitle?: MessageKey;
  confirmBody?: MessageKey;
  /** Lifecycle states the action is offered in. */
  states: readonly string[];
  /** Offered only on a lot that has not already been split. */
  lotOnly?: boolean;
  /** Offered only on a card that carries a grade. */
  gradedOnly?: boolean;
  /** Opens a form in the drawer rather than firing the request immediately. */
  form?: FormKind;
  run: (item: VaultItem) => Promise<unknown>;
}

type FormKind = 'consignment' | 'grading' | 'inspection';

/**
 * Card services moved here from the retired Services section: ordering a service
 * is something you do to a specific card, so it belongs on the card.
 *
 * Every entry maps 1:1 onto an endpoint the API actually exposes. Nothing that
 * the backend cannot do is listed — no "sell now", no "insure", no "request
 * appraisal" — and nothing that only staff may do (hold, release, relocate) is
 * offered to a collector, because those endpoints are role-gated and would fail.
 */
const CARD_ACTIONS: readonly CardAction[] = [
  {
    key: 'photography',
    label: 'services.photography',
    description: 'services.photography.desc',
    icon: <IconServices />,
    ok: 'services.photographyRequested',
    states: ['stored'],
    run: (item) => api.post('/services/photography', { itemId: item.id }),
  },
  {
    /**
     * Grading is a form now for the same reason consignment became one: a tier
     * is a declared-value ceiling and a turnaround, and posting `{ itemId }`
     * could express neither.
     */
    key: 'grading',
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
    label: 'services.video',
    description: 'services.video.desc',
    icon: <IconServices />,
    ok: 'services.videoRequested',
    // Also offered while listed: this is exactly the request a buyer's question
    // provokes, and a listing is when questions arrive.
    states: ['stored', 'listed'],
    run: (item) => api.post('/services/video', { itemId: item.id }),
  },
  {
    key: 'inspection',
    label: 'services.inspection',
    description: 'services.inspection.desc',
    icon: <IconSearch />,
    ok: 'services.inspectionRequested',
    states: ['stored', 'listed'],
    form: 'inspection',
    run: async () => undefined,
  },
  {
    /**
     * Splitting a lot is not free and is not instant — each card that comes out
     * is a fresh intake with its own serial, bin and charge — so it is a request
     * in the operator queue rather than a button that fires.
     */
    key: 'lot-split',
    label: 'services.lotSplit',
    description: 'services.lotSplit.desc',
    icon: <IconBox />,
    ok: 'services.lotSplitRequested',
    states: ['stored'],
    lotOnly: true,
    run: (item) => api.post('/services/lot-split', { itemId: item.id }),
  },
  {
    /**
     * Consignment is no longer a one-click action, because it is no longer one
     * thing: the seller chooses a channel, sets a price, and — for a card show —
     * picks the show. The drawer opens a form instead of firing a request.
     */
    key: 'consignment',
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
    label: 'services.buyout',
    description: 'services.buyout.desc',
    icon: <IconReceipt />,
    ok: 'services.buyoutRequested',
    states: ['stored'],
    run: (item) => api.post('/services/buyout', { itemId: item.id }),
  },
  {
    /**
     * Cracking a slab is the one service that destroys the thing it is performed
     * on: the holder is snapped, and the grade and certificate stop describing
     * anything. Two-step confirmed, and the grade is cleared afterwards so the
     * card cannot be listed or insured as graded when it no longer is.
     */
    key: 'deslab',
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
    label: 'services.donation',
    description: 'services.donation.desc',
    icon: <IconAlert />,
    ok: 'services.donated',
    confirm: true,
    confirmTitle: 'services.donation.confirmTitle',
    confirmBody: 'services.donation.confirmBody',
    states: ['stored'],
    run: async (item) => {
      // Irreversible, so the API issues a challenge that must be consumed.
      const challenge = await api.post<{ confirmationToken: string }>('/services/donation', {
        itemId: item.id,
      });
      await api.post('/services/donation/confirm', {
        confirmationToken: challenge.confirmationToken,
      });
    },
  },
];

/**
 * Customer vault — the card-management command centre.
 *
 * One search field and three state controls sit above a grid of cards. Every
 * card opens a drawer carrying its record, its full lifecycle timeline and the
 * actions that are legal for it; historical cards open the same drawer with the
 * actions withheld.
 */
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

  // Incremental search-as-you-type, scoped to the selected state. Both the list
  // and the badge counts follow the same query, so a badge never claims cards a
  // search has filtered away.
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

  // The cull window is a server rule, so it is asked for rather than assumed —
  // the panel prints it in its own subtitle and on every blocked card.
  useEffect(() => {
    void (async () => {
      try {
        const { windowDays } = await api.get<{ windowDays: number }>('/services/remove-commons/window');
        setCullWindowDays(windowDays);
      } catch {
        /* the cull is an extra; the vault works without it */
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
      {/* The search field is the vault's primary control, so it sits centred in
          the content header at a size that matches that role, with the state
          controls immediately beside it. */}
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
                // Both a tooltip and an accessible name: the control is icon-led
                // and the label can wrap out of sight at narrow widths.
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
      </div>

      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} />}

      {/* Culling is bulk, destructive and rare, so it is a mode rather than a
          control sitting permanently over the collection. It is only offered on
          the active scope — there is nothing to cull among held or departed
          cards. */}
      {scope === 'active' && cullWindowDays !== null && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant={culling ? 'secondary' : 'ghost'} onClick={() => setCulling((v) => !v)}>
            {culling ? t('cull.close') : t('cull.open')}
          </Button>
        </div>
      )}

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

      <Panel
        title={t(`vault.scope.${scope}` as MessageKey)}
        subtitle={
          items === null ? undefined : t('vault.assetsCount', { count: items.length })
        }
        flush
      >
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
              ) : undefined
            }
          />
        ) : (
          <ul className="card-grid">
            {items.map((item) => (
              <CardTile
                key={item.id}
                item={item}
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

/**
 * One card in the grid. The whole tile is the control — clicking anywhere on it
 * opens the drawer — so it is a real `<button>` and reachable by Tab, rather
 * than a div with a small "view details" affordance in one corner.
 */
function CardTile({
  item,
  t,
  locale,
  onOpen,
}: {
  item: VaultItem;
  t: TranslateFn;
  locale: string;
  onOpen: () => void;
}) {
  const meta = STATE_META[item.lifecycleState];
  const historical = Boolean(item.historical);

  return (
    <li className={`card card--interactive${historical ? ' card--historical' : ''}`}>
      <button type="button" className="card-hit" onClick={onOpen}>
        <span className="sr-only">{t('vault.openCard', { name: item.description || item.typeClass })}</span>
      </button>

      {/* The artwork pipeline is untouched — historical cards reuse exactly the
          same component and mapping, desaturated by the container's CSS only. */}
      <div className="card-art">
        <CardPhotoThumb serialNumber={item.serialNumber} title={item.description || item.typeClass} />
        {historical && (
          <span className="card-archive-mark" aria-hidden="true">
            <IconArchive />
          </span>
        )}
      </div>

      <h3 className="card-title">{item.typeClass}</h3>
      <p className="card-desc">{item.description || '—'}</p>

      <div className="card-meta">
        {historical ? (
          <StatusBadge tone="neutral">
            {t('vault.historical.status', { state: stateLabel(t, item.lifecycleState) })}
          </StatusBadge>
        ) : (
          <StatusBadge tone={meta?.tone ?? 'neutral'}>{stateLabel(t, item.lifecycleState)}</StatusBadge>
        )}
        <span>{t('vault.condition', { grade: item.conditionGrade ?? '—' })}</span>
        {item.isLot && !item.lotBroken && (
          <StatusBadge tone="violet">{t('vault.lotOf', { count: item.lotSize })}</StatusBadge>
        )}
        {/* Oversized items are on a much shorter included period and a far
            steeper per-period fee, so it is worth seeing without opening the
            card. */}
        {item.oversized && !historical && (
          <StatusBadge tone="warning">{t('vault.oversized')}</StatusBadge>
        )}
      </div>

      <div className="card-meta">
        {historical ? (
          <>
            {item.departedAt && (
              <span dir="ltr">{t('vault.historical.on', { date: formatDate(item.departedAt, locale) })}</span>
            )}
            {item.departureReason && (
              <span className="hint">{t('vault.historical.reason', { reason: item.departureReason })}</span>
            )}
          </>
        ) : (
          /* The bin is mandatory on intake, so it is always shown (Req 10.3). */
          <span dir="ltr">
            {t('vault.bin', {
              bin: item.binBarcode ? `${item.binBarcode} · ${item.binZone ?? ''}`.trim() : t('vault.noBin'),
            })}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * The card's actual photographs, and its video if one was shot.
 *
 * Newest version first, because the reason somebody ordered a photo shoot is
 * that they wanted the new pictures rather than the arrival snapshot. Video is
 * rendered as video rather than being linked out to — the whole point of it is
 * watching the light move across the surface, which a download does not do.
 */
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

  return (
    <>
      <h3 className="drawer-heading">{t('vault.media.title')}</h3>
      <ul className="media-strip">
        {ordered.map((m) => (
          <li key={m.id} className="media-item">
            {m.type === 'video' ? (
              <video src={m.url} controls preload="metadata" playsInline />
            ) : (
              <img src={m.url} alt={t('vault.media.alt', { title, version: m.version })} loading="lazy" />
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

/**
 * What storage costs for this card.
 *
 * Storage is included for a period folded into the intake fee, and after that
 * costs a proportion of that same fee per period — so the answer to "what am I
 * paying to keep this here" is different for a $1 common and a sealed case, and
 * a collector should be able to see which.
 *
 * The wording distinguishes the two states plainly. While the included period is
 * running it says so and names the date it ends; once it has, it names what has
 * already been charged and when the next period falls. Nothing here is a
 * forecast except the next date and the per-period amount.
 */
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
                <span className="detail-value-sub" dir="ltr">
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
                <dd className="detail-value" dir="ltr">
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

/**
 * Everything that ever happened to one card (Requirement 13.2): intake, bin
 * transfers, corrections, offers, sales, shipments and disputes, newest first —
 * alongside the card's own record and the actions it can still take.
 */
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

  /**
   * The card's real media, which nothing has ever shown.
   *
   * `GET /vault/items/:id` has returned signed URLs for every stored image since
   * intake was built, and the drawer rendered the deterministic placeholder
   * artwork instead — so a collector who PAID for a photo shoot got the same
   * generated tile they had before. Allowed to fail quietly for the same reason
   * storage is: it is context, and a card whose photographs would not load
   * should still open.
   */
  useEffect(() => {
    setMedia(null);
    void (async () => {
      try {
        const card = await api.get<{ images: ItemMedia[] }>(`/vault/items/${item.id}`);
        setMedia(card.images ?? []);
      } catch {
        setMedia([]);
      }
    })();
  }, [item.id]);

  // Storage is loaded separately and allowed to fail quietly: it is context, and
  // a card whose storage figures could not be fetched should still open.
  useEffect(() => {
    setStorage(null);
    if (historical) return;
    void (async () => {
      try {
        setStorage(await api.get<StorageStatus>(`/vault/items/${item.id}/storage`));
      } catch {
        /* leave the section out rather than showing an error over a detail */
      }
    })();
  }, [item.id, historical]);

  // A historical card is a record, not an instrument: no action is offered on
  // it at all. A held card is frozen, and releasing a hold is a warehouse
  // operation, so a collector gets no actions there either.
  const graded = Boolean(item.conditionGrade && !/^raw$/i.test(item.conditionGrade));
  const actions = historical || item.holdFlag
    ? []
    : CARD_ACTIONS.filter(
        (a) =>
          a.states.includes(item.lifecycleState) &&
          // Offering "split this lot" on a single card, or "crack the slab" on a
          // raw one, would be offering a request the API refuses.
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

  return (
    <>
      <DetailDrawer
        title={item.description || item.typeClass}
        subtitle={item.typeClass}
        onClose={onClose}
        footer={
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        }
      >
        <div className={historical ? 'card-art card-art--historical' : 'card-art'}>
          <CardPhotoThumb serialNumber={item.serialNumber} title={item.description || item.typeClass} />
        </div>

        {media !== null && media.length > 0 && (
          <ItemMediaGallery media={media} title={item.description || item.typeClass} t={t} />
        )}

        {historical && (
          <p className="drawer-note drawer-note--archive">
            <IconArchive />
            <span>{t('vault.historical.drawerNote')}</span>
          </p>
        )}

        <dl className="detail-list" style={{ marginBlockStart: 'var(--sp-4)' }}>
          <div className="detail-row">
            <dt className="detail-label">{t('vault.item.state')}</dt>
            <dd className="detail-value">
              <StatusBadge tone={historical ? 'neutral' : meta?.tone ?? 'neutral'}>
                {historical
                  ? t('vault.historical.status', { state: stateLabel(t, item.lifecycleState) })
                  : stateLabel(t, item.lifecycleState)}
              </StatusBadge>
            </dd>
          </div>
          <div className="detail-row">
            <dt className="detail-label">{t('vault.item.serial')}</dt>
            <dd className="detail-value">
              <code dir="ltr">{item.serialNumber}</code>
            </dd>
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
                  <dd className="detail-value" dir="ltr">
                    {formatDate(item.departedAt, locale)}
                  </dd>
                </div>
              )}
              {item.departureReason && (
                <div className="detail-row">
                  <dt className="detail-label">{t('vault.historical.reasonLabel')}</dt>
                  <dd className="detail-value">{item.departureReason}</dd>
                </div>
              )}
            </>
          ) : (
            <div className="detail-row">
              <dt className="detail-label">{t('vault.item.bin')}</dt>
              <dd className="detail-value" dir="ltr">
                {item.binBarcode ? `${item.binBarcode} · ${item.binZone ?? ''}`.trim() : t('vault.noBin')}
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

        {actions.length > 0 && (
          <>
            <h3 className="drawer-heading">{t('vault.actions.title')}</h3>
            <ul className="drawer-actions">
              {actions.map((action) => (
                <li key={action.key}>
                  <Button
                    size="sm"
                    variant={action.confirm ? 'secondary' : 'gold'}
                    icon={action.icon}
                    disabled={busy}
                    block
                    onClick={() =>
                      action.form
                        ? setFormOpen(action.form)
                        : action.confirm
                          ? setConfirming(action)
                          : void run(action)
                    }
                  >
                    {t(action.label)}
                  </Button>
                  <p className="hint">{t(action.description)}</p>
                </li>
              ))}
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

        {!historical && item.holdFlag && (
          <p className="drawer-note drawer-note--hold">
            <IconClock />
            <span>{t('vault.actions.heldNote')}</span>
          </p>
        )}

        <div style={{ marginBlockStart: 'var(--sp-5)' }}>
          <BarcodeLabel value={item.barcode} caption={item.description || item.typeClass} />
        </div>

        <h3 className="drawer-heading">{t('vault.historyTitle')}</h3>

        {events === null ? (
          <p className="hint">{t('vault.historyLoading')}</p>
        ) : events.length === 0 ? (
          <EmptyState title={t('vault.historyEmpty')} icon={<IconClock />} />
        ) : (
          <ul className="timeline">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`} className="detail-row" style={{ display: 'block' }}>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <StatusBadge tone="info" plain>
                    {event.kind.replace(/_/g, ' ')}
                  </StatusBadge>
                  <span className="hint" dir="ltr">
                    {formatDate(event.at, locale)}
                  </span>
                </div>
                <p style={{ marginBlockStart: 4, fontSize: 13.5 }}>{event.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </DetailDrawer>

      {confirming && (
        <ConfirmationModal
          title={t(confirming.confirmTitle ?? 'services.donation.confirmTitle')}
          body={
            <p>
              {t(confirming.confirmBody ?? 'services.donation.confirmBody', {
                item: `${item.typeClass} — ${item.description}`,
              })}
            </p>
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
