/**
 * Which events go out by email, and what their subject line says.
 *
 * Mirrored BY VALUE from `apps/api/src/modules/not/event-types.ts`, because the
 * worker is independent of the Nest container and cannot import the API's
 * catalogue. Only the email default and the subject are needed here; category,
 * label and in-app settings are the API's business.
 *
 * Email is on by default only for money, custody of somebody's property
 * changing hands, and anything with a deadline attached.
 */
const EMAIL_BY_DEFAULT = new Set([
  'item_received',
  'parcel_received',
  'parcel_processed',
  'parcel_damaged',
  'parcel_disposed',
  'arrival_not_accepted',
  'hold_placed',
  'grading_shipped',
  'offer_received',
  'offer_countered',
  'item_sold',
  'swap_proposed',
  'swap_completed',
  'transfer_completed',
  'buyout_quoted',
  'custom_request_quoted',
  'custom_request_declined',
  'shipment_out',
  'shipment_delivered',
  'shipment_exception',
  'shipment_expired',
  'shipment_cancelled',
  'direct_ship_booked',
  'wallet_request_completed',
  'wallet_request_payout_failed',
  'support_ticket_replied',
  'escrow_proposed',
  'escrow_agreed',
  'escrow_funded',
  'escrow_inspected',
  'escrow_settled',
  'escrow_returned',
  'white_glove_quoted',
  'show_pickup_booked',
  'handed_over',
  'topup_settled',
  'payment_reversed',
]);

/**
 * An event not in the list defaults to email OFF, so a new emitter still
 * reaches the collector in-app and cannot start sending mail without an entry here.
 */
export function defaultEmailEnabled(eventType: string): boolean {
  return EMAIL_BY_DEFAULT.has(eventType);
}

/**
 * The subject line, written to be readable in a notification bar with the rest
 * cut off: the subject of the sentence comes first and there are no pleasantries.
 */
const SUBJECTS: Record<string, string> = {
  item_received: 'An item has been received into your vault',
  parcel_received: 'Your parcel has arrived',
  parcel_forwarded: 'Your parcel is on its way to the vault',
  parcel_processed: 'Your parcel has been unpacked',
  parcel_damaged: 'Your parcel arrived damaged',
  parcel_disposed: 'Your parcel was disposed of',
  arrival_not_accepted: 'Something arrived for you and could not be accepted',
  hold_placed: 'A hold has been placed on one of your items',
  item_donated: 'Your item has been donated',
  commons_removed: 'Cards have been removed from your vault',
  grading_shipped: 'Your card is on its way to the grader',
  offer_received: 'You have an offer',
  offer_countered: 'Your offer was countered',
  item_sold: 'Your item sold',
  swap_proposed: 'Somebody proposed a swap',
  swap_completed: 'Your swap is complete',
  transfer_completed: 'Your transfer is complete',
  buyout_quoted: 'Bault has quoted you for your collectible',
  custom_request_raised: 'We have your custom request',
  custom_request_quoted: 'Your custom request has been priced',
  custom_request_declined: 'We cannot do that one',
  shipment_out: 'Your shipment is on its way',
  shipment_delivered: 'Your shipment was delivered',
  shipment_exception: 'There is a problem with your shipment',
  shipment_expired: 'An unpaid shipment was released',
  shipment_cancelled: 'Your shipment was cancelled',
  group_shipment_locked: 'Your shared parcel is closed to new members',
  direct_ship_booked: 'Your parcel is shipping direct, overnight',
  wallet_request_submitted: 'We have your wallet request',
  wallet_request_completed: 'Your wallet request has been settled',
  wallet_request_payout_failed: 'Your cash-out could not be paid, and the money is back in your wallet',
  support_ticket_replied: 'Support has replied to you',
  support_ticket_resolved: 'Your support ticket was resolved',
  escrow_proposed: 'Somebody has proposed a private deal with you',
  escrow_agreed: 'Your deal terms are agreed',
  escrow_funded: 'The money on your deal is held',
  escrow_inspected: 'We have looked at the item on your deal',
  escrow_settled: 'Your deal has settled',
  escrow_returned: 'Your deal was returned',
  white_glove_requested: 'We have your hand-delivery request',
  white_glove_quoted: 'Your hand delivery has been quoted',
  show_pickup_booked: 'Your show pickup is booked',
  handed_over: 'Your collectibles were handed over',
  topup_settled: 'Your cash-in has landed',
  payment_reversed: 'A payment into your wallet was reversed',
};

export function eventSubject(eventType: string): string {
  return SUBJECTS[eventType] ?? 'An update on your Bault vault';
}
