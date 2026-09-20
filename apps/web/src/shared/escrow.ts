import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

/**
 * The SPA's vocabulary for escrow and for fulfilment that is a person.
 *
 * Shapes mirrored by value from `apps/api/src/modules/esc/` and
 * `apps/api/src/modules/shp/fulfilment.ts`, because the SPA cannot import from
 * the API tree. The figures are fetched (`GET /escrow/terms`,
 * `GET /shipping/white-glove/terms`) rather than duplicated — only the labels
 * live here, because a label has to be translatable and a server string is not.
 */

export interface EscrowDeal {
  id: string;
  code: string;
  raisedBy: string;
  raiserRole: 'buyer' | 'seller';
  counterpartyUserId: string | null;
  counterpartyName: string | null;
  counterpartyEmail: string | null;
  description: string;
  valueMinor: number;
  feeMinor: number;
  currency: string;
  status: string;
  settlement: string;
  fundingSource: string | null;
  fundedAt: string | null;
  fundingReference: string | null;
  itemId: string | null;
  inspectedAt: string | null;
  /** `'yes'` or `'no'` — the question both parties are paying to have answered. */
  inspectionMatches: string | null;
  inspectionNotes: string | null;
  buyerReleasedAt: string | null;
  buyerReleaseAttestedBy: string | null;
  sellerReleasedAt: string | null;
  sellerReleaseAttestedBy: string | null;
  closeReason: string | null;
  createdAt: string;
  /** Both parties by username, where they have an account. */
  raiserUsername?: string | null;
  counterpartyUsername?: string | null;
}

export interface EscrowEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string | null;
  onBehalfOf: string | null;
  notes: string | null;
  occurredAt: string;
}

/**
 * Status → tone.
 *
 * `inspecting` and `awaiting_release` are warnings rather than info on purpose:
 * both mean somebody is waiting on somebody, and a deal that sits in either for
 * a week is a deal that has gone quiet.
 */
export const ESCROW_TONE: Record<string, StatusTone> = {
  proposed: 'neutral',
  agreed: 'info',
  funded: 'violet',
  inspecting: 'warning',
  awaiting_release: 'warning',
  settled: 'success',
  returned: 'neutral',
  cancelled: 'neutral',
};

const ESCROW_STATUS_KEY: Record<string, MessageKey> = {
  proposed: 'esc.status.proposed',
  agreed: 'esc.status.agreed',
  funded: 'esc.status.funded',
  inspecting: 'esc.status.inspecting',
  awaiting_release: 'esc.status.awaiting_release',
  settled: 'esc.status.settled',
  returned: 'esc.status.returned',
  cancelled: 'esc.status.cancelled',
};

export function escrowStatusLabel(t: TranslateFn, status: string): string {
  const key = ESCROW_STATUS_KEY[status];
  return key ? t(key) : status;
}

const ESCROW_EVENT_KEY: Record<string, MessageKey> = {
  raised: 'esc.event.raised',
  agreed: 'esc.event.agreed',
  funded: 'esc.event.funded',
  item_received: 'esc.event.item_received',
  inspected: 'esc.event.inspected',
  released_by_buyer: 'esc.event.released_by_buyer',
  released_by_seller: 'esc.event.released_by_seller',
  settled: 'esc.event.settled',
  returned: 'esc.event.returned',
  cancelled: 'esc.event.cancelled',
};

/** A trail entry in words — it rendered the raw event name, underscores removed. */
export function escrowEventLabel(t: TranslateFn, eventType: string): string {
  const key = ESCROW_EVENT_KEY[eventType];
  return key ? t(key) : eventType.replace(/_/g, ' ');
}

/** Which side each party is on, by username, from the viewer's point of view. */
export function dealParties(deal: EscrowDeal): { buyer: string | null; seller: string | null } {
  const raiser = deal.raiserUsername ? `@${deal.raiserUsername}` : null;
  const other = deal.counterpartyUsername
    ? `@${deal.counterpartyUsername}`
    : deal.counterpartyName
      ? deal.counterpartyName
      : null;
  return deal.raiserRole === 'buyer' ? { buyer: raiser, seller: other } : { buyer: other, seller: raiser };
}

/**
 * The step a deal is waiting on, phrased as what happens NEXT.
 *
 * A status tells you where a deal is; this tells you whose move it is, which is
 * the only thing either party actually wants to know from a list.
 */
export function nextStep(t: TranslateFn, deal: EscrowDeal, viewerIsBuyer: boolean): string {
  switch (deal.status) {
    case 'proposed':
      return t('esc.next.proposed');
    case 'agreed':
      return viewerIsBuyer ? t('esc.next.agreedBuyer') : t('esc.next.agreedSeller');
    case 'funded':
      return viewerIsBuyer ? t('esc.next.fundedBuyer') : t('esc.next.fundedSeller');
    case 'inspecting':
      return t('esc.next.inspecting');
    case 'awaiting_release': {
      const mine = viewerIsBuyer ? deal.buyerReleasedAt : deal.sellerReleasedAt;
      return mine ? t('esc.next.waitingOther') : t('esc.next.yourTurn');
    }
    default:
      return '';
  }
}

/* ============================================================
   Fulfilment methods
   ============================================================ */

export const FULFILMENT_METHODS = ['carrier', 'hand_delivery', 'show_pickup'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

const METHOD_KEY: Record<string, MessageKey> = {
  carrier: 'ff.method.carrier',
  hand_delivery: 'ff.method.hand_delivery',
  show_pickup: 'ff.method.show_pickup',
};

export function fulfilmentLabel(t: TranslateFn, method: string): string {
  const key = METHOD_KEY[method];
  return key ? t(key) : method;
}

export interface PickupShow {
  id: string;
  name: string;
  venue: string;
  city: string | null;
  startsAt: string;
  endsAt: string | null;
  requestDeadline: string;
  feeMinor: number;
  capacity: number;
  booked: number;
  /** Null means uncapped. */
  remaining: number | null;
  open: boolean;
  notes: string | null;
}

export interface WhiteGloveTerms {
  baseDomesticMinor: number;
  baseInternationalMinor: number;
  quoteWithinHours: number;
  travelQuotedSeparately: boolean;
}
