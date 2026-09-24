import type { MessageKey, TranslateFn } from './i18n';

/** Message key per known notification event type. */
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

  /**
   * The twenty-four that were missing.
   *
   * `eventLabel` falls back to the raw event type, so the feed badged these as
   * `wallet_request_completed` and `escrow_funded` — the database enum, in both
   * languages — and the preferences matrix fell through to the server's English
   * `label`, leaving a Hebrew reader with two-thirds of their notification
   * settings in English. The server emits all thirty-six; the client knew twelve.
   */
  item_donated: 'notifications.event.item_donated',
  commons_removed: 'notifications.event.commons_removed',
  grading_shipped: 'notifications.event.grading_shipped',
  offer_countered: 'notifications.event.offer_countered',
  swap_proposed: 'notifications.event.swap_proposed',
  swap_completed: 'notifications.event.swap_completed',
  transfer_completed: 'notifications.event.transfer_completed',
  shipment_cancelled: 'notifications.event.shipment_cancelled',
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
  topup_settled: 'notifications.event.topup_settled',
  payment_reversed: 'notifications.event.payment_reversed',
};

export const EVENT_TYPES = Object.keys(EVENT_LABEL_KEY);

/**
 * Delivery channels.
 *
 * The list itself comes from the server with the preference matrix — this is
 * only the translation, and it falls back to the raw value so a channel added
 * on the server renders as something rather than as nothing.
 */
const CHANNEL_LABEL_KEY: Record<string, MessageKey> = {
  in_app: 'notifications.channel.in_app',
  email: 'notifications.channel.email',
};

export function channelLabel(t: TranslateFn, channel: string): string {
  const key = CHANNEL_LABEL_KEY[channel];
  return key ? t(key) : channel;
}

/** Human label for an event type, falling back to the raw type. */
export function eventLabel(t: TranslateFn, eventType: string): string {
  const key = EVENT_LABEL_KEY[eventType];
  return key ? t(key) : eventType;
}

/**
 * Render a notification as a proper sentence (Requirement 6.1).
 *
 * The dispatcher writes a rendered `message` into every notification's content, so
 * that is what is displayed. Older rows (or an unexpected shape) fall back to a
 * readable "Key: value" summary of the payload — never a raw JSON dump.
 */
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

/**
 * Where a notification leads: the screen on which the thing it reports can be
 * seen or acted on. Matched by the event's family, so a new event in a known
 * family already goes somewhere sensible; an unknown one leads nowhere.
 */
export function eventRoute(eventType: string): { section: string; tab?: string } | null {
  const rules: [RegExp, { section: string; tab?: string }][] = [
    [/^(offer_|item_sold|swap_|listing_)/, { section: 'marketplace', tab: 'offers' }],
    [/^escrow_/, { section: 'escrow' }],
    [/^(parcel_|arrival_not_accepted)/, { section: 'inbound', tab: 'parcels' }],
    [/^(shipment_|direct_ship|handed_over|white_glove|show_pickup|group_shipment)/, { section: 'shipping-services', tab: 'tracking' }],
    [/^(custom_request|buyout_|service_|grading_|inspection_|video_|photography_|consignment_)/, { section: 'shipping-services', tab: 'requests' }],
    [/^support_/, { section: 'support', tab: 'tickets' }],
    [/^(wallet_|topup_|payment_)/, { section: 'wallet', tab: 'requests' }],
    [/^membership_/, { section: 'membership' }],
    [/^(item_|hold_|commons_|storage_)/, { section: 'vault', tab: 'active' }],
  ];
  for (const [pattern, route] of rules) if (pattern.test(eventType)) return route;
  return null;
}
