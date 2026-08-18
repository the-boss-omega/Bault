/**
 * Every event a collector can be told about, and where it is sent.
 *
 * There was no such list. Events were emitted by name from twenty different
 * services, rendered by a `switch` in the worker, and filtered by preference
 * rows keyed on a free-text `event_type` — so the preferences screen could only
 * show event types a user had ALREADY changed, and there was no way to answer
 * "what can I turn off?" without reading the source.
 *
 * The list is also what makes email possible. Turning every notification into an
 * email would be indefensible: a collector with forty cards would get an email
 * every time a parcel moved a shelf. What matters when you are NOT looking at
 * the app is a small, specific subset — money, custody, and anything with a
 * deadline attached — and that judgement has to live somewhere it can be read
 * and argued with rather than being implicit in a job.
 *
 * A user can override any of it in either direction. These are the defaults for
 * somebody who has never opened the preferences screen, which is most people.
 */

/** The channels a notification can be delivered on. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export function isKnownChannel(value: string): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

/** Broad groupings, so the preferences screen is not one list of thirty rows. */
export const EVENT_CATEGORIES = ['custody', 'marketplace', 'shipping', 'money', 'support'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface NotificationEventType {
  key: string;
  category: EventCategory;
  /** English label. The SPA renders its own localised label from the key. */
  label: string;
  /**
   * Whether email is ON by default for this event.
   *
   * True only where the event is either about MONEY, about CUSTODY of somebody's
   * property changing hands, or carries a deadline the collector will miss if
   * they are not looking. Everything else is in-app only until they ask for it.
   */
  emailByDefault: boolean;
  /**
   * Whether this event can be turned off at all.
   *
   * Two cannot. A parcel that arrived damaged and an item that was refused at
   * the door are both statements that somebody's property did not survive
   * contact with the warehouse, and a preference toggle that suppresses those is
   * a preference toggle that hides bad news. They are in-app-only and permanent;
   * the email side is still a choice.
   */
  mandatoryInApp?: boolean;
}

export const NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = [
  /* ---- custody: somebody's property moving ---- */
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

  /* ---- marketplace ---- */
  { key: 'offer_received', category: 'marketplace', label: 'You receive an offer', emailByDefault: true },
  { key: 'offer_countered', category: 'marketplace', label: 'Your offer is countered', emailByDefault: true },
  { key: 'item_sold', category: 'marketplace', label: 'One of your items sells', emailByDefault: true },
  { key: 'swap_proposed', category: 'marketplace', label: 'Somebody proposes a swap', emailByDefault: true },
  { key: 'swap_completed', category: 'marketplace', label: 'A swap completes', emailByDefault: true },
  { key: 'transfer_completed', category: 'marketplace', label: 'A gift transfer completes', emailByDefault: true },
  { key: 'buyout_quoted', category: 'marketplace', label: 'Bault quotes you for a buyout', emailByDefault: true },

  /* ---- shipping ---- */
  { key: 'shipment_out', category: 'shipping', label: 'A shipment is dispatched', emailByDefault: true },
  {
    // Deadline attached: seven days, after which the items are released.
    key: 'shipment_expired',
    category: 'shipping',
    label: 'An unpaid shipment is released',
    emailByDefault: true,
  },
  { key: 'shipment_cancelled', category: 'shipping', label: 'A shipment is cancelled', emailByDefault: true },
  { key: 'group_shipment_locked', category: 'shipping', label: 'A shared parcel is closed to new members', emailByDefault: false },
  { key: 'direct_ship_booked', category: 'shipping', label: 'A parcel ships direct from the tax-free site', emailByDefault: true },

  /* ---- escrow: somebody else's money and somebody else's card ---- */
  { key: 'escrow_proposed', category: 'marketplace', label: 'Somebody proposes a private deal with you', emailByDefault: true },
  { key: 'escrow_agreed', category: 'marketplace', label: 'Both sides agree the terms of a deal', emailByDefault: true },
  { key: 'escrow_funded', category: 'marketplace', label: 'The money on a deal is held', emailByDefault: true },
  { key: 'escrow_inspected', category: 'marketplace', label: 'A deal card has been inspected', emailByDefault: true },
  { key: 'escrow_settled', category: 'marketplace', label: 'A deal settles', emailByDefault: true },
  { key: 'escrow_returned', category: 'marketplace', label: 'A deal is returned', emailByDefault: true },

  /* ---- fulfilment by a person ---- */
  { key: 'white_glove_requested', category: 'shipping', label: 'We have your hand-delivery request', emailByDefault: false },
  { key: 'white_glove_quoted', category: 'shipping', label: 'Your hand delivery is quoted', emailByDefault: true },
  { key: 'show_pickup_booked', category: 'shipping', label: 'Your show pickup is booked', emailByDefault: true },
  { key: 'handed_over', category: 'shipping', label: 'Your cards were handed over in person', emailByDefault: true },

  /* ---- money ---- */
  { key: 'wallet_request_submitted', category: 'money', label: 'Your wallet request is received', emailByDefault: false },
  { key: 'wallet_request_completed', category: 'money', label: 'Your wallet request is settled', emailByDefault: true },
  { key: 'topup_settled', category: 'money', label: 'A top-up settles', emailByDefault: true },
  { key: 'payment_reversed', category: 'money', label: 'A payment into your wallet is reversed', emailByDefault: true },

  /* ---- support ---- */
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

/**
 * Whether this channel is on for this event when nobody has said otherwise.
 *
 * An event type not in the catalogue defaults to in-app ON and email OFF: a new
 * emitter that somebody forgot to register still reaches the collector, and
 * still cannot start sending mail without a deliberate entry here.
 */
export function defaultEnabled(eventKey: string, channel: NotificationChannel): boolean {
  const event = notificationEventType(eventKey);
  if (channel === 'in_app') return true;
  return event?.emailByDefault ?? false;
}

/** Whether this channel may be switched off at all for this event. */
export function isMandatory(eventKey: string, channel: NotificationChannel): boolean {
  if (channel !== 'in_app') return false;
  return notificationEventType(eventKey)?.mandatoryInApp === true;
}
