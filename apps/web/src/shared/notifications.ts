import type { MessageKey, TranslateFn } from './i18n';

export const EVENT_LABEL_KEY: Record<string, MessageKey> = {
  item_received: 'notifications.event.item_received',
  item_sold: 'notifications.event.item_sold',
  offer_received: 'notifications.event.offer_received',
  shipment_out: 'notifications.event.shipment_out',
  hold_placed: 'notifications.event.hold_placed',
  arrival_not_accepted: 'notifications.event.arrival_not_accepted',
  parcel_received: 'notifications.event.parcel_received',
  parcel_forwarded: 'notifications.event.parcel_forwarded',
  parcel_damaged: 'notifications.event.parcel_damaged',
  parcel_processed: 'notifications.event.parcel_processed',
  parcel_disposed: 'notifications.event.parcel_disposed',
  support_ticket_replied: 'notifications.event.support_ticket_replied',
  support_ticket_resolved: 'notifications.event.support_ticket_resolved',
  buyout_quoted: 'notifications.event.buyout_quoted',

  item_donated: 'notifications.event.item_donated',
  commons_removed: 'notifications.event.commons_removed',
  grading_shipped: 'notifications.event.grading_shipped',
  offer_countered: 'notifications.event.offer_countered',
  swap_proposed: 'notifications.event.swap_proposed',
  swap_completed: 'notifications.event.swap_completed',
  transfer_completed: 'notifications.event.transfer_completed',
  shipment_cancelled: 'notifications.event.shipment_cancelled',
  shipment_delivered: 'notifications.event.shipment_delivered',
  shipment_exception: 'notifications.event.shipment_exception',
  shipment_expired: 'notifications.event.shipment_expired',
  custom_request_raised: 'notifications.event.custom_request_raised',
  custom_request_quoted: 'notifications.event.custom_request_quoted',
  custom_request_declined: 'notifications.event.custom_request_declined',
  group_shipment_locked: 'notifications.event.group_shipment_locked',
  direct_ship_booked: 'notifications.event.direct_ship_booked',
  escrow_proposed: 'notifications.event.escrow_proposed',
  escrow_agreed: 'notifications.event.escrow_agreed',
  escrow_funded: 'notifications.event.escrow_funded',
  escrow_inspected: 'notifications.event.escrow_inspected',
  escrow_settled: 'notifications.event.escrow_settled',
  escrow_returned: 'notifications.event.escrow_returned',
  white_glove_requested: 'notifications.event.white_glove_requested',
  white_glove_quoted: 'notifications.event.white_glove_quoted',
  show_pickup_booked: 'notifications.event.show_pickup_booked',
  handed_over: 'notifications.event.handed_over',
  wallet_request_submitted: 'notifications.event.wallet_request_submitted',
  wallet_request_completed: 'notifications.event.wallet_request_completed',
  wallet_request_payout_failed: 'notifications.event.wallet_request_payout_failed',
  topup_settled: 'notifications.event.topup_settled',
  payment_reversed: 'notifications.event.payment_reversed',
};

export const EVENT_TYPES = Object.keys(EVENT_LABEL_KEY);

const CHANNEL_LABEL_KEY: Record<string, MessageKey> = {
  in_app: 'notifications.channel.in_app',
  email: 'notifications.channel.email',
};

export function channelLabel(t: TranslateFn, channel: string): string {
  const key = CHANNEL_LABEL_KEY[channel];
  return key ? t(key) : channel;
}

export function eventLabel(t: TranslateFn, eventType: string): string {
  const key = EVENT_LABEL_KEY[eventType];
  return key ? t(key) : eventType;
}

export function renderContent(content: unknown, label: string): string {
  if (content == null) return label;
  if (typeof content === 'string') return content;
  if (typeof content !== 'object') return String(content);

  const record = content as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim() !== '') return record.message;

  const skip = new Set([
    'recipientIds',
    'ownerId',
    'userId',
    'sellerId',
    'buyerId',
    'donorId',
    'responderId',
  ]);
  const parts = Object.entries(record)
    .filter(([key, value]) => !skip.has(key) && value != null && typeof value !== 'object')
    .map(([key, value]) => {
      const readable = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      return `${readable}: ${String(value)}`;
    });
  return parts.length > 0 ? `${label} — ${parts.join(', ')}` : label;
}
