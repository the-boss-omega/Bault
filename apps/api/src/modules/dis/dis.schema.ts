import { pgEnum, pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * DIS — unified Service Request framework (Principle VI).
 *
 * One table covers every non-trade action on an item: batch split, professional
 * photography, third-party grading, donation, consignment, warehouse transfer.
 * `type_fields` holds the type-specific data (received grade, external channel,
 * sale amount, …). Each request is billable and moves through a status workflow.
 */
export const serviceRequestType = pgEnum('service_request_type', [
  'batch_split',
  'professional_photography',
  'third_party_grading',
  'donation',
  'consignment',
  'warehouse_transfer',
]);

export const serviceRequestStatus = pgEnum('service_request_status', [
  'requested',
  'in_progress',
  'completed',
  'cancelled',
]);

export const serviceRequest = pgTable('service_request', {
  id: pkId(),
  code: text('code'), // human-facing Service Request ID, SR-XXXXXXXX (Requirement 9.4)
  type: serviceRequestType('type').notNull(),
  requesterId: text('requester_id').notNull(),
  itemId: text('item_id'),
  batchId: text('batch_id'),
  status: serviceRequestStatus('status').notNull().default('requested'),
  chargeId: text('charge_id'),
  typeFields: jsonb('type_fields'), // { receivedGrade, channel, saleAmount, objectKey, ... }
  /**
   * Structured warehouse fulfillment (Requirement 5.4) — the same pattern the
   * shipment flow uses: a customer REQUEST is only closed once the operator has
   * filled the type-specific form with every required field. Set together, in the
   * same transaction that flips the status to `completed`.
   */
  fulfillment: jsonb('fulfillment'),
  fulfilledBy: text('fulfilled_by'),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
