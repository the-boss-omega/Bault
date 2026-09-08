import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

/**
 * The SPA's vocabulary for the seller side of the marketplace.
 *
 * All of this describes machinery that already existed and had no UI: offers
 * could be accepted, rejected and countered; listings could be repriced and
 * delisted; swaps and gift transfers ran a full dual-approval execution. A
 * seller was notified "you received an offer of $X" and had nowhere to go.
 */

export const LISTING_TONE: Record<string, StatusTone> = {
  active: 'success',
  sold: 'gold',
  removed: 'neutral',
};

const LISTING_STATUS_KEY: Record<string, MessageKey> = {
  active: 'market.listing.active',
  sold: 'market.listing.sold',
  removed: 'market.listing.removed',
};

export function listingStatusLabel(t: TranslateFn, status: string): string {
  const key = LISTING_STATUS_KEY[status];
  return key ? t(key) : status;
}

export const OFFER_TONE: Record<string, StatusTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'error',
  countered: 'info',
};

const OFFER_STATUS_KEY: Record<string, MessageKey> = {
  pending: 'market.offer.pending',
  accepted: 'market.offer.accepted',
  rejected: 'market.offer.rejected',
  countered: 'market.offer.countered',
};

export function offerStatusLabel(t: TranslateFn, status: string): string {
  const key = OFFER_STATUS_KEY[status];
  return key ? t(key) : status;
}

export const SWAP_TONE: Record<string, StatusTone> = {
  pending: 'warning',
  accepted: 'info',
  rejected: 'error',
  executed: 'success',
};

const SWAP_STATUS_KEY: Record<string, MessageKey> = {
  pending: 'market.swap.pending',
  accepted: 'market.swap.accepted',
  rejected: 'market.swap.rejected',
  executed: 'market.swap.executed',
};

export function swapStatusLabel(t: TranslateFn, status: string): string {
  const key = SWAP_STATUS_KEY[status];
  return key ? t(key) : status;
}

/** `GET /marketplace/listings/mine`. */
export interface MyListing {
  id: string;
  itemId: string;
  askingPrice: number;
  currency: string;
  status: string;
  publishedAt: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  pendingOffers: number;
}

/** `GET /marketplace/offers/mine`. */
export interface MyOffer {
  id: string;
  listingId: string;
  amount: number;
  status: string;
  createdAt: string;
  askingPrice: number;
  listingStatus: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  buyerUsername: string | null;
  /** Which side of the LISTING the caller is on — the API computes it. */
  direction: 'incoming' | 'outgoing';
  /** The caller's own side, named rather than inferred from `direction`. */
  side: 'buyer' | 'seller';
  /** Which side named the price currently on the table. */
  proposedBy: 'buyer' | 'seller';
  /**
   * Whether the ball is in the caller's court.
   *
   * This panel used to key its controls off `direction`, which is a different
   * question: it showed a buyer "awaiting seller" and no controls at all, so a
   * buyer who had been sent a counter-offer could not accept it, counter it, or
   * withdraw. Whose move it is depends on who proposed the price, not on who is
   * selling.
   */
  yourTurn: boolean;
}

export interface SwapItemRef {
  id: string;
  serialNumber?: string;
  typeClass?: string;
  description: string;
}

/** `GET /marketplace/swaps`. */
export interface MySwap {
  id: string;
  status: string;
  kind: 'swap' | 'transfer';
  direction: 'incoming' | 'outgoing';
  proposerUsername: string | null;
  responderUsername: string | null;
  offeredItems: SwapItemRef[];
  requestedItems: SwapItemRef[];
  proposerApproved: boolean;
  responderApproved: boolean;
  createdAt: string;
  awaitingMe: boolean;
}

/* ============================================================
   Consignment channels
   ============================================================ */

export interface ConsignmentChannel {
  key: string;
  label: string;
  gradedOnly: boolean;
  minAskingMinor: number;
  requiresEvent: boolean;
  payoutDaysMin: number;
  payoutDaysMax: number;
  partnerFeeNote: string;
}

export interface ConsignmentEvent {
  id: string;
  name: string;
  venue: string;
  city: string | null;
  startsAt: string;
  requestDeadline: string;
  capacity: number;
}

const CHANNEL_KEY: Record<string, MessageKey> = {
  card_show: 'consign.channel.card_show',
  auction_house: 'consign.channel.auction_house',
  ebay_partner: 'consign.channel.ebay_partner',
};

export function channelLabel(t: TranslateFn, key: string): string {
  const messageKey = CHANNEL_KEY[key];
  return messageKey ? t(messageKey) : key;
}
