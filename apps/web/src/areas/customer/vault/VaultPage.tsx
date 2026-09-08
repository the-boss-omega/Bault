import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { SERVICE_FEE_ACTION, priceLabel, useServicePrices } from '../../../shared/servicePrices';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { BarcodeLabel } from '../../../shared/Barcode';
import { hasMessage, useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { formatDate, formatUsd } from '../../../shared/money';
import { navigate, useNavigation, useRoute } from '../../../shared/routing';
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
import { Serial } from '../../../shared/ui/Serial';
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

/**
 * One card's position in the Break-Even Watch, as `GET /vault/break-even`
 * returns it.
 *
 * `estimatedValueMinor` is deliberately nullable and `valueBasis` says where the
 * figure came from, because the service refuses to invent one: it uses the
 * median of real sales of the same class, or the owner's own asking price, or
 * nothing. The UI has to carry that honesty through rather than rendering a bar
 * against a number nobody can source.
 */
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

/** A service already asked for on this card and not yet finished. */
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
  /**
   * The `service_request.type` this action creates, so an already-open request
   * of the same kind can be recognised and the action shown as done rather than
   * offered a second time.
   */
  serviceType?: string;
  run: (item: VaultItem) => Promise<unknown>;
}

type FormKind = 'consignment' | 'grading' | 'inspection' | 'custom';

/**
 * A timeline entry's kind, in words.
 *
 * Falls back to the raw value with its underscores removed, so an event type
 * added on the server before a translation exists still renders as something
 * rather than as a blank badge — the same rule the notification catalogue uses.
 */
function timelineKindLabel(t: TranslateFn, kind: string): string {
  const key = `timeline.${kind}` as MessageKey;
  return hasMessage(key) ? t(key) : kind.replace(/_/g, ' ');
}

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
    serviceType: 'professional_photography',
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
    // Also offered while listed: this is exactly the request a buyer's question
    // provokes, and a listing is when questions arrive.
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
    /**
     * Splitting a lot is not free and is not instant — each card that comes out
     * is a fresh intake with its own serial, bin and charge — so it is a request
     * in the operator queue rather than a button that fires.
     */
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
    /**
     * Consignment is no longer a one-click action, because it is no longer one
     * thing: the seller chooses a channel, sets a price, and — for a card show —
     * picks the show. The drawer opens a form instead of firing a request.
     */
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
    /**
     * The one action that is not a thing Bault sells.
     *
     * Nine fixed services and no way to ask for anything else: a collector who
     * wanted these sleeved before shipping, or the box weighed, had only a
     * support ticket — a conversation with no price, no operator queue, no
     * completion and no link to the collectible it is about. Priced by a person
     * after they read it, which is why it carries no figure here.
     */
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
    /**
     * Cracking a slab is the one service that destroys the thing it is performed
     * on: the holder is snapped, and the grade and certificate stop describing
     * anything. Two-step confirmed, and the grade is cleared afterwards so the
     * card cannot be listed or insured as graded when it no longer is.
     */
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
  /**
   * The Break-Even Watch for the whole vault, in ONE request.
   *
   * Not per row: a vault of two hundred cards would otherwise fire two hundred
   * of these, and the service already computes the comparable medians once for
   * the whole set. Keyed by item id at render time.
   */
  const [watch, setWatch] = useState<Map<string, BreakEvenRow>>(() => new Map());

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

  // The break-even figures move only when money moves, so they are fetched once
  // per mount rather than with every keystroke of the search box. A failure is
  // silent: the watch is an addition to the register, and a vault that cannot
  // price its cards is still a vault.
  useEffect(() => {
    void (async () => {
      try {
        const summary = await api.get<{ items: BreakEvenRow[] }>('/vault/break-even');
        setWatch(new Map(summary.items.map((row) => [row.itemId, row])));
      } catch {
        /* no watch this time; the register renders without it */
      }
    })();
  }, []);

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
      {/* A filter row, at the start edge. The search field used to be a 720px
          centred pill, 58px tall, over a list that fits on one screen — the
          largest and loudest control in the product, searching four holdings.
          The scope is in the URL and the segmented control shows which of the
          three views of one collection you are in. */}
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

        <span className="spacer" />

        {/* The count of what is on screen, and the one bulk action that acts on
            it — beside the control that chose them, not in a band of their own. */}
        {items !== null && (
          <span className="vault-count">{t('vault.assetsCount', { count: items.length })}</span>
        )}
        {scope === 'active' && cullWindowDays !== null && (
          <Button size="sm" variant={culling ? 'secondary' : 'ghost'} onClick={() => setCulling((v) => !v)}>
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

      {/*
        No section header above the register.

        The page already says "My vault", the scope control already says which of
        the three views you are in, and a third band repeating "Active / 3 items"
        between them was one heading too many — it also sat 74px below the filter
        row and 28px above the register, so it attached itself to the wrong
        thing. The count moves beside the scope control, where the number belongs;
        the cull mode moves beside it, where the action belongs.
      */}
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
            /*
              The vault is where a new account lands, and an empty one used to
              say only "Cards appear here once the warehouse books them in." —
              a description of something that will never happen unless the
              reader does something first, with no hint as to what. The whole
              product begins with sending cards in, and the address to send them
              to is one section away, so the empty state says so and goes there.
            */
            action={
              q ? (
                <Button size="sm" onClick={() => setQ('')}>
                  {t('vault.clearSearch')}
                </Button>
              ) : scope === 'active' ? (
                <Button
                  size="sm"
                  variant="gold"
                  onClick={() => navigate({ section: 'inbound', tab: 'addresses' })}
                >
                  {t('vault.empty.getStarted')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="card-grid card-grid--register">
            <RegisterHead t={t} scope={scope} />
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

/**
 * One holding, as a register row.
 *
 * The order is the direction's first rule: PHOTOGRAPH → SERIAL → STATUS, then
 * what the card is, then what it is costing. The whole row is the control —
 * clicking anywhere on it opens the sheet — so it is a real `<button>` stretched
 * over the row and reachable by Tab, rather than a div with a small "view
 * details" affordance in one corner.
 *
 * The title is the CARD, not its class. It used to be `item.typeClass`, so every
 * holding in every vault was called `trading_card` in bold at title size while
 * its actual identity sat underneath in grey, truncated mid-word. The class is a
 * classification and now reads as one.
 */
function CardTile({
  item,
  watch,
  t,
  locale,
  onOpen,
}: {
  item: VaultItem;
  /** The card's break-even position, when the watch has one for it. */
  watch?: BreakEvenRow;
  t: TranslateFn;
  locale: string;
  onOpen: () => void;
}) {
  const meta = STATE_META[item.lifecycleState];
  const historical = Boolean(item.historical);
  const frozen = Boolean(item.holdFlag) && !historical;
  const name = item.description || item.typeClass;

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
    >
      <button type="button" className="card-hit" onClick={onOpen}>
        <span className="sr-only">{t('vault.openCard', { name })}</span>
      </button>

      {/* The artwork pipeline is untouched — a departed card reuses exactly the
          same component and mapping, desaturated by the container's CSS only. */}
      <div className="card-art">
        <CardPhotoThumb serialNumber={item.serialNumber} title={name} />
        {historical && (
          <span className="card-archive-mark" aria-hidden="true">
            <IconArchive />
          </span>
        )}
      </div>

      {/* IDENTITY. The serial leads — isolated LTR so a Hebrew row cannot
          reorder it, and selectable, because somebody is going to paste it into
          an email — with the catalogue name under it. */}
      <div className="card-id">
        <h3 className="card-title">
          <Serial value={item.serialNumber} lead />
        </h3>
        <p className="card-desc" title={name}>
          {name}
        </p>
      </div>

      {/* STATE. Its own column, so a reader can run their eye down it. */}
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
        {/* Oversized items are on a much shorter included period and a far
            steeper per-period fee, so it is worth seeing without opening the
            card. */}
        {item.oversized && !historical && (
          <StatusBadge tone="warning">{t('vault.oversized')}</StatusBadge>
        )}
      </div>

      {/* WHERE IT IS — or, for a departed item, where it went. */}
      <div className="card-where">
        {historical ? (
          <>
            {item.departedAt && (
              <span className="date">
                {t('vault.historical.on', { date: formatDate(item.departedAt, locale) })}
              </span>
            )}
            {item.departureReason && (
              <span className="card-sub ltr-run">{item.departureReason}</span>
            )}
          </>
        ) : (
          /* The bin is mandatory on intake, so it is always shown (Req 10.3). */
          <span className="code-inline">
            {item.binBarcode ? `${item.binBarcode} · ${item.binZone ?? ''}`.trim() : t('vault.noBin')}
          </span>
        )}
      </div>

      {/*
        WHAT IT IS COSTING, on the row rather than three clicks away.

        The API has computed this all along and nothing has ever shown it: a
        `GET /vault/break-even` that counts what has actually been billed against
        each item and compares it to what cards of the same class have really
        sold for here. Never a forecast, never an invented valuation — where
        there is no honest value signal the bar is absent and the figure stands
        alone, which is a true and useful sentence rather than a gap.
      */}
      {watch && !historical ? <Watch row={watch} t={t} /> : <div className="watch" />}
    </li>
  );
}

/**
 * The register's column header.
 *
 * The single change that turns a list of rows into a register you can read down.
 * Before this, state, condition and location each began at whatever x the text
 * before them happened to end at, so nothing lined up between one row and the
 * next and the eye had to re-find every field on every line — while a 400px void
 * sat in the middle of every row because all the content was packed into one
 * flexible column.
 */
function RegisterHead({ t, scope }: { t: TranslateFn; scope: Scope }) {
  return (
    <li className="register-head" aria-hidden="true">
      <span />
      <span>{t('vault.col.item')}</span>
      <span>{t('vault.col.state')}</span>
      <span>{scope === 'history' ? t('vault.historical.dateLabel') : t('vault.col.where')}</span>
      <span className="register-head-end">{scope === 'history' ? '' : t('vault.col.cost')}</span>
    </li>
  );
}

/**
 * Break-Even Watch, one row of it.
 *
 * A proportion, not a score: how much of what a card is worth has already been
 * eaten by what it costs to keep. It goes AMBER at two thirds — before it says
 * anything — because a watch that only warns once the number is bad is a report.
 */
function Watch({ row, t }: { row: BreakEvenRow; t: TranslateFn }) {
  const value = row.estimatedValueMinor;
  const known = value !== null && value > 0;
  const ratio = known ? Math.min(row.totalSpentMinor / value, 1) : 0;
  const tone = row.pastBreakEven ? 'proportion--over' : ratio >= 0.66 ? 'proportion--watch' : '';

  return (
    <div className="watch">
      <div className="watch-line">
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
  /**
   * Which of these the browser could not fetch.
   *
   * Item media are presigned object-storage URLs, and in this environment they
   * answer 403 — the signature parameters are absent from the URL (reported in
   * docs/design/01-audit.md; the fix is in the storage adapter, not here). An
   * <img> that fails renders its alt text sprawled across a grey box, which for
   * a catalogue description is six lines of it. A photograph that did not load
   * should say that it did not load.
   */
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

  const name = item.description || item.typeClass;
  const frozen = Boolean(item.holdFlag) && !historical;
  /**
   * The reason the card is frozen, taken from the custody log rather than
   * invented here. `hold_placed` carries it, and it is the whole difference
   * between a frozen card and a broken one.
   */
  const holdReason = frozen
    ? ((events ?? [])
        .find((e) => e.kind === 'hold_placed')
        ?.summary // The API prefixes the operator's reason with the event's own
        // name — "hold placed — Dispute opened on the sale: …". The sentence
        // above already says the item is frozen, so the prefix is the same fact
        // twice and the reader has to read past it to reach the reason.
        .replace(/^\s*hold placed\s*[—–-]\s*/i, '') ?? null)
    : null;

  return (
    <>
      <DetailDrawer
        title={name}
        /* The identity, in the direction's order: SERIAL, then status. The
           title used to be the whole four-line catalogue string with
           `trading_card` under it, which is a description reading as a name. */
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
        {/*
          The photography stage. The one local dark moment in a light product,
          and the first thing in the sheet: a collector cannot hold this object,
          so the least the screen can do is light it like one.
        */}
        <div className={historical ? 'stage stage--departed' : 'stage'}>
          <CardPhotoThumb serialNumber={item.serialNumber} title={name} />
        </div>

        <div className="sheet-cols">
          <div className="sheet-col">
            {frozen && (
              <p className="frozen-reason">
                <IconClock />
                <span>
                  {holdReason ? (
                    <>
                      {t('vault.frozen.reason', { reason: '' })}{' '}
                      <span className="ltr-run">{holdReason}</span>{' '}
                    </>
                  ) : (
                    <>{t('vault.frozen.reason', { reason: '' })} </>
                  )}
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
            <dd className="detail-value">{item.typeClass}</dd>
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
                    {/*
                      Every one of these buttons used to be `gold`. Nine primary
                      actions in one list is the same as none: the eye has
                      nothing to land on, and "donate this card forever" carried
                      the identical weight as "take a photo of it".
                    */}
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
                        {/* The charge lands the moment this is pressed, so it is
                            stated on the control rather than in a price list in
                            another section of the app. */}
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

            {/* The barcode is an operational control on a collector's screen, so
                it goes last in its column rather than sitting mid-sheet above
                the record. */}
            <div className="stack-top-lg">
              <BarcodeLabel value={item.barcode} caption={name} />
            </div>
          </div>

          {/*
            The custody register, on the end side.

            It is append-only and it looks it: a continuous rule, a date column,
            an entry beside it, and nothing that suggests any of it can be
            changed. This is the most trust-critical thing Bault renders — it is
            the answer to "prove you have had this the whole time" — so it sits
            beside the card's details rather than three screens below them.
          */}
          <div className="sheet-col sheet-col--register">
            <h3 className="drawer-heading">{t('vault.historyTitle')}</h3>

            {events === null ? (
              <p className="hint">{t('vault.historyLoading')}</p>
            ) : events.length === 0 ? (
              <EmptyState title={t('vault.historyEmpty')} />
            ) : (
              <ul className="timeline">
                {events.map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    <span className="hint date">{formatDate(event.at, locale)}</span>
                    <div>
                      {/*
                        The kind was rendered as `event.kind.replace(/_/g, ' ')` —
                        the database enum with its underscores taken out. A vault's
                        chain of custody is the most trust-critical thing it shows,
                        and it read "ownership transfer" / "state change" in English
                        to a Hebrew reader, in the machine's vocabulary to everyone.
                      */}
                      <span className="register-kind">{timelineKindLabel(t, event.kind)}</span>
                      {/*
                        The summary comes back from the API in English whatever
                        the reader's locale — an operator's own words on a custody
                        event. Isolated, so a Hebrew page lays it out as the Latin
                        run it is instead of reordering it.
                      */}
                      <p className="register-entry ltr-run">{event.summary}</p>
                    </div>
                  </li>
                ))}
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
                  item: `${item.typeClass} — ${item.description}`,
                })}
              </p>
              {/* Donating a card charges $20, and the dialog asking somebody to
                  do something irreversible said nothing about money at all. */}
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
