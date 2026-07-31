import { pgEnum, pgTable, text, boolean, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * SHP — outbound shipments. `destination_address` is PII exposed to admins only
 * (Principle IX). Dispatch is scan-verified and moves items to `shipped` with
 * custody events (Principle III). Shipping + rush are billable (Principle VI).
 */
export const shipmentStatus = pgEnum('shipment_status', [
  'requested',
  'rates_selected',
  'picking',
  'packed',
  'labeled',
  'shipped',
  'in_transit',
  'delivered',
  'exception',
]);

export const shipment = pgTable('shipment', {
  id: pkId(),
  code: text('code'), // human-facing Shipment ID, SHP-XXXXXXXX (Requirement 9.4)
  userId: text('user_id').notNull(),
  itemIds: jsonb('item_ids').notNull(), // string[] — one request can cover many items
  destinationAddress: text('destination_address').notNull(),
  carrier: text('carrier'),
  serviceLevel: text('service_level'),
  rushFlag: boolean('rush_flag').notNull().default(false),
  cost: amountMinor('cost'),
  currency: currency(),
  status: shipmentStatus('status').notNull().default('requested'),
  trackingNumber: text('tracking_number'),
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
