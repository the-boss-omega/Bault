import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

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

export function storefrontHref(username: string): string {
  return `#/marketplace/store?seller=${encodeURIComponent(username)}`;
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
  direction: 'incoming' | 'outgoing';
  side: 'buyer' | 'seller';
  proposedBy: 'buyer' | 'seller';
  yourTurn: boolean;
}

export interface SwapItemRef {
  id: string;
  serialNumber?: string;
  typeClass?: string;
  description: string;
}

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
