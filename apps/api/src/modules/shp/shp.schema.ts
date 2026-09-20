import { pgEnum, pgTable, text, boolean, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * SHP — outbound shipments. `destination_address` is PII exposed to admins only
 * (Principle IX). Dispatch is scan-verified and moves items to `shipped` with
 * custody events (Principle III). Shipping + rush are billable (Principle VI).
 */
export const shipmentStatus = pgEnum('shipment_status', [
  'requested',
  /**
   * A rate was chosen but the wallet could not cover it.
   *
   * Previously impossible to represent: a shipment either had a settled charge
   * or had no rate at all, so a collector who could not pay simply left items
   * stranded in an open request forever. The parcel is held for
   * `PAYMENT_WINDOW_DAYS` and then the worker returns the items to the shelf.
   */
  'awaiting_payment',
  'rates_selected',
  'picking',
  'packed',
  'labeled',
  'shipped',
  'in_transit',
  'delivered',
  'exception',
  /**
   * Called off before it left. Terminal, and the only status that RELEASES its
   * items — every other terminal state means the parcel went somewhere.
   */
  'cancelled',
]);

export const shipment = pgTable('shipment', {
  id: pkId(),
  code: text('code'), // human-facing Shipment ID, SHP-XXXXXXXX (Requirement 9.4)
  userId: text('user_id').notNull(),
  itemIds: jsonb('item_ids').notNull(), // string[] — one request can cover many items
  destinationAddress: text('destination_address').notNull(),
  // The recipient exactly as the customer entered it, captured at creation.
  // Kept as its own column rather than re-derived from `destinationAddress`,
  // whose formatted single line cannot be split back into name/street without
  // guessing. NULL on rows created before 0005 — never invented.
  recipientName: text('recipient_name'),
  /**
   * Where it is actually going, as the carrier needs it.
   *
   * `destination_address` is a formatted single line for humans, and every rate
   * request hard-coded country `IL` and postal code `00000` because there was
   * nothing else to send. These two are what make a quote depend on the
   * destination at all.
   */
  destinationCountry: text('destination_country').notNull().default('US'),
  destinationPostalCode: text('destination_postal_code').notNull().default(''),
  /**
   * The whole address, as a carrier needs it, frozen at the moment of the quote.
   *
   * Only the formatted line and the country/postcode pair used to be stored, so
   * re-rating a shipment that already existed asked the carrier for a price to a
   * postcode with no street — which EasyPost refuses. It is a SNAPSHOT rather
   * than a reference to `shipping_address`: the collector may edit that address
   * later, and a parcel goes where it was quoted to go.
   */
  destinationDetail: jsonb('destination_detail'),
  carrier: text('carrier'),
  serviceLevel: text('service_level'),
  /** The catalogue key of the chosen service, which carries its constraints. */
  serviceKey: text('service_key'),
  /**
   * How this shipment ends: `carrier`, `hand_delivery` or `show_pickup`.
   *
   * Every route out of the vault used to be a parcel — a shipment had to
   * resolve to a carrier rate and dispatch bought a label. Two of the reference
   * service's outbound routes are a person rather than a package, and neither
   * had anywhere to exist. See `fulfilment.ts` for what each method skips.
   */
  fulfilmentMethod: text('fulfilment_method').notNull().default('carrier'),

  /* ---- white glove: a person drives it there ---- */

  /** Where it is collected from, and the window in which somebody can be there. */
  pickupAddress: text('pickup_address'),
  pickupFrom: timestamp('pickup_from', { withTimezone: true }),
  pickupTo: timestamp('pickup_to', { withTimezone: true }),
  /** The window at the other end. The destination itself is the address above. */
  deliverFrom: timestamp('deliver_from', { withTimezone: true }),
  deliverTo: timestamp('deliver_to', { withTimezone: true }),
  /**
   * The quote, once a person has worked out the journey.
   *
   * Null while a request is outstanding — which is a real state, not a missing
   * value. A white-glove request is a question, and Bault has to go and find
   * out the answer before there is a price to accept or decline.
   */
  quoteMinor: integer('quote_minor'),
  quoteNotes: text('quote_notes'),
  quotedBy: text('quoted_by'),
  quotedAt: timestamp('quoted_at', { withTimezone: true }),

  /* ---- show pickup: it goes to the show, you turn up ---- */

  /** The show the cards travel to. References `consignment_event`. */
  pickupEventId: text('pickup_event_id'),

  /* ---- either way: who physically took it ---- */

  /**
   * The hand-over. Whoever received the cards, named, at a recorded time.
   *
   * This is what closes a shipment that has no tracking number. A parcel is
   * closed by a carrier scan; a hand delivery and a show pickup are closed by a
   * person putting their name to having taken the thing.
   */
  handedToName: text('handed_to_name'),
  handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
  handedOverBy: text('handed_over_by'),
  /**
   * How the carrier was chosen. `simple` means Bault picked; `personalised`
   * means the collector did. Recorded because it changes who is answerable for
   * the choice when a parcel arrives late.
   */
  serviceMode: text('service_mode').notNull().default('personalised'),
  rushFlag: boolean('rush_flag').notNull().default(false),

  /* ---- what it is worth, and who covers it ---- */

  /** Customs value the COLLECTOR declared. Bault never invents or reduces one. */
  declaredValueMinor: integer('declared_value_minor').notNull().default(0),
  /** What they asked to have covered. Zero means uninsured. */
  insuredValueMinor: integer('insured_value_minor').notNull().default(0),
  /** The premium charged for that cover, frozen at selection (Principle V). */
  insurancePremiumMinor: integer('insurance_premium_minor').notNull().default(0),
  signatureRequired: boolean('signature_required').notNull().default(false),
  /** Extras riding along — `[{ key, priceMinor }]`. Priced when selected. */
  addOns: jsonb('add_ons'),
  /** Per-item customs lines, frozen at creation for the commercial invoice. */
  customsLines: jsonb('customs_lines'),
  /** What the CUSTOMER wants the warehouse to know. Not the operator's notes. */
  customerNotes: text('customer_notes'),

  /* ---- being changed, merged, cancelled or left unpaid ---- */

  /**
   * The unopened parcel a direct-ship shipment IS. Such a shipment has no items
   * — its contents never entered the vault — so the packing bench verifies it by
   * scanning this parcel's label, and the label is bought from its facility.
   */
  sourceParcelId: text('source_parcel_id'),
  /** Set when this request was absorbed into another by a merge. */
  mergedIntoShipmentId: text('merged_into_shipment_id'),
  /** The shared parcel this belongs to, if any. */
  groupId: text('group_id'),
  /** When an unpaid shipment's items go back on the shelf. */
  paymentDueAt: timestamp('payment_due_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  /** What cancelling actually cost. Zero when nothing had been done yet. */
  restockingFeeMinor: integer('restocking_fee_minor').notNull().default(0),
  /**
   * The box the collector chose to have it sent in — a key from `SHIPPING_BOXES`.
   * Null: priced on weight alone, and the warehouse picks the box.
   */
  boxSize: text('box_size'),
  /**
   * The carrier's own handles for the rate that was charged.
   *
   * A real carrier does not sell "FedEx 2Day at $18.50"; it sells THE RATE IT
   * QUOTED, by id, against the shipment it quoted it for. These were returned by
   * the adapter and dropped on the floor, so dispatch had nothing it could buy.
   * Null on the sandbox, which has nothing to refer to.
   */
  /**
   * What the member's tier paid towards this parcel, as quoted and agreed:
   * `{ tier, insuredShipment, insuranceMinor, postageMinor, rushMinor, addOns }`.
   * Spent from the allowance when the parcel is paid for — which, for a held
   * shipment, is later than when it was quoted.
   */
  membershipCover: jsonb('membership_cover'),
  providerShipmentId: text('provider_shipment_id'),
  providerRateId: text('provider_rate_id'),
  cost: amountMinor('cost'),
  currency: currency(),
  status: shipmentStatus('status').notNull().default('requested'),
  trackingNumber: text('tracking_number'),
  // Carrier-quoted ETA, stamped when a rate is selected (the rate carries
  // `estimatedDays`). Null until then — the tracking list shows "—", never a
  // date the carrier never promised.
  estimatedDeliveryAt: timestamp('estimated_delivery_at', { withTimezone: true }),
  labelObjectKey: text('label_object_key'),
  // Structured warehouse fulfillment (Requirement 5.3): filled when the operator
  // closes the request. `fulfillment` holds the per-item verification payload.
  packageWeightGrams: integer('package_weight_grams'),
  fulfillmentNotes: text('fulfillment_notes'),
  fulfillment: jsonb('fulfillment'),
  fulfilledBy: text('fulfilled_by'),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
