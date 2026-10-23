import { pgEnum, pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const serviceRequestType = pgEnum('service_request_type', [
  'batch_split',
  'professional_photography',
  'third_party_grading',
  'donation',
  'consignment',
  'warehouse_transfer',
  'buyout',
  'video_review',
  'condition_inspection',
  'deslab',
  'remove_commons',
  'custom',
]);

export const serviceRequestStatus = pgEnum('service_request_status', [
  'requested',
  'in_progress',
  'completed',
  'cancelled',
]);

export const serviceRequest = pgTable('service_request', {
  id: pkId(),
  code: text('code'),
  type: serviceRequestType('type').notNull(),
  requesterId: text('requester_id').notNull(),
  itemId: text('item_id'),
  batchId: text('batch_id'),
  status: serviceRequestStatus('status').notNull().default('requested'),
  chargeId: text('charge_id'),
  typeFields: jsonb('type_fields'),
  fulfillment: jsonb('fulfillment'),
  fulfilledBy: text('fulfilled_by'),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
