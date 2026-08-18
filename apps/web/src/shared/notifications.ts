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
