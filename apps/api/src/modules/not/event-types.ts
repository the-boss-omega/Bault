export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export function isKnownChannel(value: string): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

export const EVENT_CATEGORIES = ['custody', 'marketplace', 'shipping', 'money', 'support'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface NotificationEventType {
  key: string;
  category: EventCategory;
  label: string;
  emailByDefault: boolean;
  mandatoryInApp?: boolean;
}

export const NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = [
  { key: 'item_received', category: 'custody', label: 'An item is received into your vault', emailByDefault: true },
  { key: 'parcel_received', category: 'custody', label: 'A parcel arrives at a facility', emailByDefault: true },
  { key: 'parcel_forwarded', category: 'custody', label: 'A parcel is forwarded to the vault', emailByDefault: false },
  { key: 'parcel_processed', category: 'custody', label: 'A parcel is unpacked into your vault', emailByDefault: true },
  {
    key: 'parcel_damaged',
    category: 'custody',
    label: 'A parcel arrives damaged',
    emailByDefault: true,
    mandatoryInApp: true,
  },
  { key: 'parcel_disposed', category: 'custody', label: 'A parcel is disposed of', emailByDefault: true },
  {
    key: 'arrival_not_accepted',
    category: 'custody',
    label: 'Something arrived for you and could not be accepted',
    emailByDefault: true,
    mandatoryInApp: true,
  },
  { key: 'hold_placed', category: 'custody', label: 'A hold is placed on an item', emailByDefault: true },
  { key: 'item_donated', category: 'custody', label: 'An item is donated', emailByDefault: false },
  { key: 'commons_removed', category: 'custody', label: 'Cards are removed in a bulk cull', emailByDefault: false },
  { key: 'grading_shipped', category: 'custody', label: 'A card is sent away to a grader', emailByDefault: true },

  { key: 'offer_received', category: 'marketplace', label: 'You receive an offer', emailByDefault: true },
  { key: 'offer_countered', category: 'marketplace', label: 'Your offer is countered', emailByDefault: true },
  { key: 'item_sold', category: 'marketplace', label: 'One of your items sells', emailByDefault: true },
  { key: 'swap_proposed', category: 'marketplace', label: 'Somebody proposes a swap', emailByDefault: true },
  { key: 'swap_completed', category: 'marketplace', label: 'A swap completes', emailByDefault: true },
  { key: 'transfer_completed', category: 'marketplace', label: 'A gift transfer completes', emailByDefault: true },
  { key: 'buyout_quoted', category: 'marketplace', label: 'Bault quotes you for a buyout', emailByDefault: true },
  { key: 'custom_request_raised', category: 'custody', label: 'We have your custom request', emailByDefault: false },
  { key: 'custom_request_quoted', category: 'custody', label: 'Your custom request is priced', emailByDefault: true },
  { key: 'custom_request_declined', category: 'custody', label: 'A custom request cannot be done', emailByDefault: true },

  { key: 'shipment_out', category: 'shipping', label: 'A shipment is dispatched', emailByDefault: true },
  {
    key: 'shipment_expired',
    category: 'shipping',
    label: 'An unpaid shipment is released',
    emailByDefault: true,
  },
  { key: 'shipment_delivered', category: 'shipping', label: 'A shipment is delivered', emailByDefault: true },
  {
    key: 'shipment_exception',
    category: 'shipping',
    label: 'The carrier reports a problem with a shipment',
    emailByDefault: true,
  },
  { key: 'shipment_cancelled', category: 'shipping', label: 'A shipment is cancelled', emailByDefault: true },
  { key: 'group_shipment_locked', category: 'shipping', label: 'A shared parcel is closed to new members', emailByDefault: false },
  { key: 'direct_ship_booked', category: 'shipping', label: 'A parcel ships direct from the tax-free site', emailByDefault: true },

  { key: 'escrow_proposed', category: 'marketplace', label: 'Somebody proposes a private deal with you', emailByDefault: true },
  { key: 'escrow_agreed', category: 'marketplace', label: 'Both sides agree the terms of a deal', emailByDefault: true },
  { key: 'escrow_funded', category: 'marketplace', label: 'The money on a deal is held', emailByDefault: true },
  { key: 'escrow_inspected', category: 'marketplace', label: 'A deal card has been inspected', emailByDefault: true },
  { key: 'escrow_settled', category: 'marketplace', label: 'A deal settles', emailByDefault: true },
  { key: 'escrow_returned', category: 'marketplace', label: 'A deal is returned', emailByDefault: true },

  { key: 'white_glove_requested', category: 'shipping', label: 'We have your hand-delivery request', emailByDefault: false },
  { key: 'white_glove_quoted', category: 'shipping', label: 'Your hand delivery is quoted', emailByDefault: true },
  { key: 'show_pickup_booked', category: 'shipping', label: 'Your show pickup is booked', emailByDefault: true },
  { key: 'handed_over', category: 'shipping', label: 'Your cards were handed over in person', emailByDefault: true },

  { key: 'wallet_request_submitted', category: 'money', label: 'Your wallet request is received', emailByDefault: false },
  { key: 'wallet_request_completed', category: 'money', label: 'Your wallet request is settled', emailByDefault: true },
  { key: 'wallet_request_payout_failed', category: 'money', label: 'A cash-out could not be paid and is back in your wallet', emailByDefault: true },
  { key: 'topup_settled', category: 'money', label: 'A cash-in settles', emailByDefault: true },
  { key: 'payment_reversed', category: 'money', label: 'A payment into your wallet is reversed', emailByDefault: true },

  { key: 'support_ticket_replied', category: 'support', label: 'Support replies to your ticket', emailByDefault: true },
  { key: 'support_ticket_resolved', category: 'support', label: 'Your ticket is marked resolved', emailByDefault: false },
];

const BY_KEY = new Map(NOTIFICATION_EVENT_TYPES.map((e) => [e.key, e]));

export function notificationEventType(key: string): NotificationEventType | undefined {
  return BY_KEY.get(key);
}

export function isKnownEventType(key: string): boolean {
  return BY_KEY.has(key);
}

export function defaultEnabled(eventKey: string, channel: NotificationChannel): boolean {
  const event = notificationEventType(eventKey);
  if (channel === 'in_app') return true;
  return event?.emailByDefault ?? false;
}

export function isMandatory(eventKey: string, channel: NotificationChannel): boolean {
  if (channel !== 'in_app') return false;
  return notificationEventType(eventKey)?.mandatoryInApp === true;
}
