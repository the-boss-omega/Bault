import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { SERVICE_FEE_ACTION, priceLabel, useServicePrices } from '../../../shared/servicePrices';
import { CardPhoto, CardPhotoThumb } from '../../../shared/CardPhoto';
import { useCardTilt } from '../../../shared/hooks';
import { BarcodeLabel } from '../../../shared/Barcode';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { itemClassLabel } from '../../../shared/itemClasses';
import { displayName, setCode, timelineKindLabel, timelineLine, type TimelineEvent } from '../../../shared/timeline';
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
  IconCase,
  IconChart,
  IconClock,
  IconRows,
  IconReceipt,
  IconSearch,
  IconServices,
  IconShipping,
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
  /** A house-store copy's catalogue photo stem, when its own serial has none. */
  photoRef?: string | null;
  /** What the card is already promised to, if anything. See `Commitment`. */
  commitment?: Commitment | null;
}

/**
 * Something the card is already promised to — an open shipment, a pending
 * trade, a funded escrow deal, a service in the queue.
 *
 * Every picker used to ask only "is it stored?", so a card on a shipment was
 * still offered for sale, for a trade and for paid services, and only the last
 * step failed. The vault says what it is promised to instead.
 */
interface Commitment {
  kind: 'shipment' | 'swap' | 'service' | 'escrow';
  code: string | null;
  serviceType?: string;
}

/**
 * Services that leave the card where it is. A card with one of these open can
 * still have another; one with anything else open — a buyout, a donation, a
 * shipment — is spoken for.
 */
const IN_PLACE_SERVICES = new Set(['professional_photography', 'video_review', 'condition_inspection', 'custom']);

function commitmentLabel(t: TranslateFn, c: Commitment): string {
  switch (c.kind) {
    case 'shipment':
      return t('vault.commit.shipment', { code: c.code ?? '' });
    case 'escrow':
      return t('vault.commit.escrow', { code: c.code ?? '' });
    case 'swap':
      return t('vault.commit.swap');
    default:
      return t('vault.commit.service', { code: c.code ?? '' });
  }
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

/**
 * Two ways to look at one collection.
 *
 * The REGISTER is the working shape: a 56px stamp and four columns you can run
 * your eye down — state, where it is, what it is costing — which is what somebody
 * managing a vault needs and what this screen has always been.
 *
 * The DISPLAY CASE is the other thing a collection is for. Nobody frames a
 * spreadsheet: these cards were bought to be looked at, and a register answers
 * "where is it and what does it cost" while answering nothing about the object.
 * Same data, same click, same sheet — the photograph is simply allowed to be the
 * size of the thing itself.
 *
 * It is a VIEW, not a scope: `?view=case` on top of whichever scope is open, so
 * the case works on Active, Hold and History alike and a linked vault arrives
 * looking the way the person who sent it meant.
 */
const VIEWS = ['register', 'case'] as const;
type View = (typeof VIEWS)[number];

const VIEW_ICON: Record<View, ReactNode> = {
  register: <IconRows />,
  case: <IconCase />,
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
   * Leaves the drawer for another screen (listing a card, shipping it) instead
   * of calling an endpoint. These are not services and carry no fee here.
   */
  goTo?: (item: VaultItem) => void;
  /** Allowed while an in-place service (a photo shoot, a video) is open on the card. */
  inPlace?: boolean;
  /**
   * Changes nothing about the card — it only opens another screen that is about
   * it. A commitment is a reason to withhold what would move or promise the
   * card, not a reason to hide the way to the listing it is already on.
   */
  navigational?: boolean;
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
    /**
     * The two things a collector most often wants to do with a card were not in
     * its drawer at all: selling it and sending it home. Both live on their own
     * screens, so these open those screens with the card already chosen.
     */
    key: 'sell',
    label: 'vault.action.sell',
    description: 'vault.action.sell.desc',
    icon: <IconTag />,
    ok: 'vault.action.sell',
    states: ['stored'],
    goTo: (item) => navigate({ section: 'marketplace', tab: 'sell', params: { item: item.id } }),
    run: async () => undefined,
  },
  {
    /**
     * A card that is already listed: the drawer said so and then offered no way
     * to do anything about it. Repricing and delisting live on the listings
     * screen, which is where this goes.
     */
    key: 'manage-listing',
    navigational: true,
    label: 'vault.action.manageListing',
    description: 'vault.action.manageListing.desc',
    icon: <IconTag />,
    ok: 'vault.action.manageListing',
    states: ['listed'],
    goTo: () => navigate({ section: 'marketplace', tab: 'listings' }),
    run: async () => undefined,
  },
  {
    key: 'ship',
    label: 'vault.action.ship',
    description: 'vault.action.ship.desc',
    icon: <IconShipping />,
    ok: 'vault.action.ship',
    states: ['stored'],
    goTo: (item) => navigate({ section: 'shipping-services', tab: 'shipping', params: { item: item.id } }),
    run: async () => undefined,
  },
  {
    key: 'photography',
    inPlace: true,
    // Allowed while listed, like the other services that photograph or examine
    // the card where it sits (`video`, `inspection`). The API asks only that the
    // card is yours (`photography.service.ts:/async request/`); this list was the
    // only thing refusing it, and better photographs are most wanted on a card
    // somebody is trying to sell.
    serviceType: 'professional_photography',
    label: 'services.photography',
    description: 'services.photography.desc',
    icon: <IconServices />,
    ok: 'services.photographyRequested',
    states: ['stored', 'listed'],
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
    inPlace: true,
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
    inPlace: true,
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
    inPlace: true,
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
  const { openRecord, closeRecord, goTab, setParams } = useNavigation(route);

  const scope: Scope = (SCOPES as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as Scope)
    : 'active';

  const view: View = (VIEWS as readonly string[]).includes(route.params.view ?? '')
    ? (route.params.view as View)
    : 'register';

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

        {/* Register or display case. Beside the scope control because it is the
            same kind of decision — which view of one collection — and small,
            icon-led and never louder than the scope it sits next to. */}
        <div className="view-controls" role="group" aria-label={t('vault.viewGroup')}>
          {VIEWS.map((v) => {
            const label = t(`vault.view.${v}` as MessageKey);
            return (
              <button
                key={v}
                type="button"
                className={`view-control${view === v ? ' is-on' : ''}`}
                aria-pressed={view === v}
                title={label}
                aria-label={label}
                /* `register` is the default, so it clears the parameter rather
                   than writing `?view=register` — an unfiltered vault has a
                   clean URL, the same rule the marketplace filters follow. */
                onClick={() => setParams({ view: v === 'register' ? null : v })}
              >
                <span className="state-icon" aria-hidden="true">
                  {VIEW_ICON[v]}
                </span>
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
          values={new Map([...watch].map(([id, row]) => [id, row.estimatedValueMinor]))}
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
            title={q ? t('vault.empty.noMatch') : t(`vault.empty.${scope}` as MessageKey)}
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
        ) : view === 'case' ? (
          <ul className="case-grid">
            {items.map((item, i) => (
              <CaseTile
                key={item.id}
                item={item}
                t={t}
                /* The tiles arrive in sequence rather than all at once. Capped,
                   because a vault of two hundred cards must not make the last
                   one wait four seconds to exist. */
                index={Math.min(i, 11)}
                onOpen={() => openRecord('item', item.id)}
              />
            ))}
          </ul>
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

/** "from $25.00" — the cheapest grading tier, from the same price list. */
function fromPrice(t: TranslateFn, prices: ReturnType<typeof useServicePrices>): string | null {
  const tiers = [...prices.values()].filter((p) => p.actionType.startsWith('grading_fee:') && p.model === 'fixed');
  if (tiers.length === 0) return null;
  return t('services.fromPrice', { amount: formatUsd(Math.min(...tiers.map((p) => p.value))) });
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
  const name = displayName(item.description) || itemClassLabel(t, item.typeClass);

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
        <CardPhotoThumb serialNumber={item.photoRef ?? item.serialNumber} title={name} />
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
        {item.commitment && !historical && (
          <StatusBadge tone="info">{commitmentLabel(t, item.commitment)}</StatusBadge>
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
 * One card in the display case.
 *
 * Everything the register row says is still here, but ranked the other way up:
 * the photograph is the tile and the text is a caption under it. Only what
 * identifies the object and what would change how you feel about it — the serial,
 * the name, the grade, and a state badge ONLY when the state is not the ordinary
 * one — because a wall of forty cards each shouting "Stored" is a wall of noise,
 * and the point of this view is the cards.
 *
 * The whole tile is one button, so there is nothing to hunt for: `CardPhoto`
 * rather than `CardPhotoThumb` precisely because the latter is itself a button
 * and would swallow the click into a lightbox.
 */
function CaseTile({
  item,
  t,
  index,
  onOpen,
}: {
  item: VaultItem;
  t: TranslateFn;
  /** Position in the wall, so the tiles arrive in sequence rather than at once. */
  index: number;
  onOpen: () => void;
}) {
  const tilt = useCardTilt();
  const meta = STATE_META[item.lifecycleState];
  const historical = Boolean(item.historical);
  const frozen = Boolean(item.holdFlag) && !historical;
  const name = displayName(item.description) || itemClassLabel(t, item.typeClass);
  const ordinary = !historical && !frozen && item.lifecycleState === 'stored';

  return (
    <li
      className={[
        'case-card',
        historical ? 'case-card--historical' : '',
        frozen ? 'case-card--frozen' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--i': index } as CSSProperties}
    >
      {/* The accessible name is the same short sentence the register row gives —
          "Open <name>". Without it the name is every string in the tile run
          together, so a screen reader announced the catalogue line twice and the
          grade before the reader knew what the control did. */}
      <button
        type="button"
        className="case-hit"
        aria-label={t('vault.openCard', { name })}
        onClick={onOpen}
        {...tilt}
      >
        <span className="case-stage">
          <CardPhoto serialNumber={item.photoRef ?? item.serialNumber} title={name} />
          {/* The light that moves across the sleeve. Decorative, pointer-driven,
              and absent entirely under reduced motion — the hook returns no
              handlers, so `--shine-o` never leaves 0. */}
          <span className="case-shine" aria-hidden="true" />
          {historical && (
            <span className="case-mark" aria-hidden="true">
              <IconArchive />
            </span>
          )}
        </span>

        <span className="case-caption">
          <span className="case-serial">
            <Serial value={item.serialNumber} lead />
          </span>
          <span className="case-name" title={name}>
            {name}
          </span>
          <span className="case-meta">
            <span className="case-grade">
              {t('vault.condition', { grade: item.conditionGrade ?? '—' })}
            </span>
            {historical ? (
              <StatusBadge tone="neutral">{stateLabel(t, item.lifecycleState)}</StatusBadge>
            ) : frozen ? (
              <span className="pill pill--frozen">{t('vault.frozen.label')}</span>
            ) : ordinary ? null : (
              <StatusBadge tone={meta?.tone ?? 'neutral'}>
                {stateLabel(t, item.lifecycleState)}
              </StatusBadge>
            )}
          </span>
        </span>
      </button>
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
   * Item media are signed URLs. Where the store is one a browser can reach they
   * are presigned by the store itself; where it is not — MinIO on a loopback
   * address, which no phone on a tunnel can open — the API signs a URL to its
   * own `/media/object` instead (§2). Either way a URL can still expire or a
   * key can be missing, and an <img> that fails renders its alt text sprawled
   * across a grey box: for a catalogue description, six lines of it. A
   * photograph that did not load should say that it did not load.
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
  /**
   * A form opens UNDER the button that asked for it and is scrolled to. It used
   * to render below all the action buttons, which on a phone is off-screen — the
   * tap looked like it had done nothing.
   */
  const formRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);
  const [busy, setBusy] = useState(false);
  /**
   * What the last action did, said INSIDE the sheet.
   *
   * Ordering a service used to shut the sheet: one tap on "Photography" and the
   * card you were reading was gone, its confirmation on a banner behind it, and
   * anything else you meant to do to the same card — grade it, ask about it,
   * read the timeline that had just changed — started again from finding the row
   * and opening it. The sheet stays open now, so this is where the confirmation
   * has to be: beside the button that was pressed, not behind the sheet.
   */
  const [status, setStatus] = useState<string | null>(null);
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

  /**
   * Re-read the card after an action, WITHOUT blanking what is on screen.
   *
   * The effects above null their state first, which is right when the sheet
   * opens on a different card and wrong when the same card has just changed:
   * the reader would watch the photographs and the timeline they are looking at
   * flash away and come back. This only overwrites, so the request that was just
   * raised appears in the timeline and on the button — which becomes "queued as
   * #CODE" rather than offering the same service a second time.
   */
  const reloadCard = useCallback(async () => {
    try {
      const [card, timeline] = await Promise.all([
        api.get<{ images: ItemMedia[]; openRequests?: OpenServiceRequest[] }>(`/vault/items/${item.id}`),
        api.get<TimelineEvent[]>(`/vault/items/${item.id}/timeline`),
      ]);
      setMedia(card.images ?? []);
      setOpenRequests(card.openRequests ?? []);
      setEvents(timeline);
    } catch {
      /* the sheet keeps what it already has rather than emptying itself */
    }
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
  // A card promised to a shipment, a trade or a deal takes no new actions. One
  // with an in-place service open (a photo shoot) can still have another of
  // those, but cannot be sold, shipped, graded or given away until it is done.
  const commitment = historical ? null : (item.commitment ?? null);
  const spokenFor =
    commitment !== null &&
    !(commitment.kind === 'service' && IN_PLACE_SERVICES.has(commitment.serviceType ?? ''));
  const actions = historical || item.holdFlag || spokenFor
    ? []
    : CARD_ACTIONS.filter(
        (a) =>
          a.states.includes(item.lifecycleState) &&
          (commitment === null || a.inPlace === true || a.navigational === true) &&
          // Offering "split this lot" on a single card, or "crack the slab" on a
          // raw one, would be offering a request the API refuses.
          (!a.lotOnly || (item.isLot && !item.lotBroken)) &&
          (!a.gradedOnly || graded),
      );

  function renderForm(kind: FormKind) {
    const done = (message: string) => {
      setFormOpen(null);
      setError(null);
      setStatus(message);
      // The list behind the sheet still reloads — the card's commitment and its
      // row have changed — but the sheet it was opened from stays put.
      onActed(message);
      void reloadCard();
    };
    const cancel = () => setFormOpen(null);
    switch (kind) {
      case 'consignment':
        return <ConsignmentForm item={item} onCancel={cancel} onDone={done} onError={setError} />;
      case 'grading':
        return <GradingForm item={item} onCancel={cancel} onDone={done} onError={setError} />;
      case 'custom':
        return <CustomRequestForm itemId={item.id} onCancel={cancel} onDone={done} onError={setError} />;
      case 'inspection':
        return <InspectionForm item={item} onCancel={cancel} onDone={done} onError={setError} />;
    }
  }

  async function run(action: CardAction) {
    setBusy(true);
    try {
      await action.run(item);
      setError(null);
      setStatus(t(action.ok));
      onActed(t(action.ok));
      await reloadCard();
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const name = displayName(item.description) || itemClassLabel(t, item.typeClass);
  const set = setCode(item.description);
  const frozen = Boolean(item.holdFlag) && !historical;
  /**
   * The reason the card is frozen, taken from the custody log rather than
   * invented here. `hold_placed` carries it, and it is the whole difference
   * between a frozen card and a broken one.
   */
  const holdReason = frozen
    ? (((events ?? []).find((e) => e.kind === 'hold_placed')?.data?.reason as string | undefined) ?? null)
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
          <>
            {/* A question about THIS card, with the card attached — a ticket
                about a collectible used to start from a blank form. */}
            <Button
              variant="ghost"
              icon={<IconAsk />}
              onClick={() =>
                navigate({
                  section: 'support',
                  tab: 'new',
                  params: { relatedType: 'item', relatedId: item.id, subject: item.serialNumber },
                })
              }
            >
              {t('vault.askAbout')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('ui.close')}
            </Button>
          </>
        }
      >
        {/*
          The photography stage. The one local dark moment in a light product,
          and the first thing in the sheet: a collector cannot hold this object,
          so the least the screen can do is light it like one.
        */}
        <div className={historical ? 'stage stage--departed' : 'stage'}>
          <CardPhotoThumb serialNumber={item.photoRef ?? item.serialNumber} title={name} />
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

            {commitment && (
              <p className="drawer-note drawer-note--archive">
                <IconClock />
                <span>
                  <strong>{commitmentLabel(t, commitment)}</strong>{' '}
                  {spokenFor ? t('vault.commit.note') : t('vault.commit.inPlaceNote')}
                </span>
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
          {set && (
            <div className="detail-row">
              <dt className="detail-label">{t('vault.item.set')}</dt>
              <dd className="detail-value">
                <code dir="ltr">{set}</code>
              </dd>
            </div>
          )}

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
            {/* Beside the buttons, not at the top of a sheet the reader has
                already scrolled past. */}
            {status && <SuccessNote>{status}</SuccessNote>}
            <ul className="drawer-actions">
              {actions.map((action) => {
                // Grading is priced per tier, so it shows the cheapest one — it
                // had no figure at all beside the other priced services.
                const price =
                  action.key === 'grading'
                    ? fromPrice(t, prices)
                    : priceLabel(prices.get(SERVICE_FEE_ACTION[action.key] ?? ''));
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
                        action.goTo
                          ? action.goTo(item)
                          : action.form
                            ? setFormOpen(formOpen === action.form ? null : action.form)
                            : // Every priced action is confirmed with its fee first:
                              // a photo shoot, a video and a buyout quote used to
                              // charge on one tap.
                              action.confirm || price
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
                    {action.form && formOpen === action.form && (
                      <div ref={formRef} className="drawer-form">
                        {renderForm(action.form)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
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
                        Built here from the event's facts, in the reader's
                        language. The API's own summary was English for everyone
                        and read "Moved intake → <bin id>". Operator reasons are
                        quoted as written, isolated so Hebrew doesn't reorder them.
                      */}
                      <p className="register-entry">
                        <bdi>{timelineLine(t, event)}</bdi>
                      </p>
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
          title={
            confirming.confirmTitle
              ? t(confirming.confirmTitle)
              : t('services.confirmPaidTitle', { service: t(confirming.label) })
          }
          body={
            <>
              <p>
                {confirming.confirmBody
                  ? t(confirming.confirmBody, { item: `${itemClassLabel(t, item.typeClass)} — ${name}` })
                  : t(confirming.description)}
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
          tone={confirming.confirm ? 'danger' : 'gold'}
          busy={busy}
          onConfirm={() => void run(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
