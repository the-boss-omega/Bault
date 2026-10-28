import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

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
  inspectionMatches: string | null;
  inspectionNotes: string | null;
  buyerReleasedAt: string | null;
  buyerReleaseAttestedBy: string | null;
  sellerReleasedAt: string | null;
  sellerReleaseAttestedBy: string | null;
  closeReason: string | null;
  createdAt: string;
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

/**
 * What an entry in a deal's history says, in the words the product already uses for the states and the steps.
 * An event the product does not know is shown as it was recorded, so a new one is never hidden.
 */
export function escrowEventLabel(t: TranslateFn, event: { eventType: string }, deal: Pick<EscrowDeal, 'inspectionMatches'>): string {
  switch (event.eventType) {
    case 'raised':
      return t('esc.status.proposed');
    case 'agreed':
      return t('esc.status.agreed');
    case 'funded':
      return t('esc.status.funded');
    case 'item_received':
      return t('esc.next.inspecting');
    case 'inspected':
      return deal.inspectionMatches === 'no' ? t('esc.inspectFailed') : t('esc.inspectPassed');
    case 'settled':
      return t('esc.status.settled');
    case 'returned':
      return t('esc.status.returned');
    case 'cancelled':
      return t('esc.status.cancelled');
    default:
      return event.eventType.replace(/_/g, ' ');
  }
}
