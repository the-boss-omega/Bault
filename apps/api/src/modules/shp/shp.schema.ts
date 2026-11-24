import { pgEnum, pgTable, text, boolean, integer, jsonb, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { consignmentEvent } from '../dis/consignment-event.schema';
import { shipmentGroup } from './shipment-group.schema';

export const shipmentStatus = pgEnum('shipment_status', [
  'requested',
  'awaiting_payment',
  'rates_selected',
  'picking',
  'packed',
  'labeled',
  'shipped',
  'in_transit',
  'delivered',
  'exception',
  'cancelled',
]);

export const OPEN_SHIPMENT_STATUSES = [
  'requested',
  'awaiting_payment',
  'rates_selected',
  'picking',
  'packed',
  'labeled',
] as const;

export const shipment = pgTable('shipment', {
  id: pkId(),
  code: text('code'),
  userId: uuid('user_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  itemIds: jsonb('item_ids').notNull(),
  destinationAddress: text('destination_address').notNull(),
  recipientName: text('recipient_name'),
  destinationCountry: text('destination_country').notNull().default('US'),
  destinationPostalCode: text('destination_postal_code').notNull().default(''),
  destinationDetail: jsonb('destination_detail'),
  carrier: text('carrier'),
  serviceLevel: text('service_level'),
  serviceKey: text('service_key'),
  fulfilmentMethod: text('fulfilment_method').notNull().default('carrier'),

  pickupAddress: text('pickup_address'),
  pickupFrom: timestamp('pickup_from', { withTimezone: true }),
  pickupTo: timestamp('pickup_to', { withTimezone: true }),
  deliverFrom: timestamp('deliver_from', { withTimezone: true }),
  deliverTo: timestamp('deliver_to', { withTimezone: true }),
  quoteMinor: integer('quote_minor'),
  quoteNotes: text('quote_notes'),
  quotedBy: uuid('quoted_by').references(() => userAccount.id, { onDelete: 'restrict' }),
  quotedAt: timestamp('quoted_at', { withTimezone: true }),

  pickupEventId: uuid('pickup_event_id').references(() => consignmentEvent.id, { onDelete: 'restrict' }),

  handedToName: text('handed_to_name'),
  handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
  handedOverBy: uuid('handed_over_by').references(() => userAccount.id, { onDelete: 'restrict' }),
  serviceMode: text('service_mode').notNull().default('personalised'),
  rushFlag: boolean('rush_flag').notNull().default(false),

  declaredValueMinor: integer('declared_value_minor').notNull().default(0),
  insuredValueMinor: integer('insured_value_minor').notNull().default(0),
  insurancePremiumMinor: integer('insurance_premium_minor').notNull().default(0),
  signatureRequired: boolean('signature_required').notNull().default(false),
  addOns: jsonb('add_ons'),
  customsLines: jsonb('customs_lines'),
  customerNotes: text('customer_notes'),

  mergedIntoShipmentId: uuid('merged_into_shipment_id').references((): AnyPgColumn => shipment.id, { onDelete: 'restrict' }),
  groupId: uuid('group_id').references(() => shipmentGroup.id, { onDelete: 'restrict' }),
  paymentDueAt: timestamp('payment_due_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  restockingFeeMinor: integer('restocking_fee_minor').notNull().default(0),
  boxSize: text('box_size'),
  membershipCover: jsonb('membership_cover'),
  providerShipmentId: text('provider_shipment_id'),
  providerRateId: text('provider_rate_id'),
  cost: amountMinor('cost'),
  currency: currency(),
  status: shipmentStatus('status').notNull().default('requested'),
  trackingNumber: text('tracking_number'),
  estimatedDeliveryAt: timestamp('estimated_delivery_at', { withTimezone: true }),
  labelObjectKey: text('label_object_key'),
  packageWeightGrams: integer('package_weight_grams'),
  fulfillmentNotes: text('fulfillment_notes'),
  fulfillment: jsonb('fulfillment'),
  fulfilledBy: uuid('fulfilled_by').references(() => userAccount.id, { onDelete: 'restrict' }),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
