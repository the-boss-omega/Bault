import { pgEnum, pgTable, text, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { batch, item } from '../cst/cst.schema';
import { charge } from '../pay/pay.schema';

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
  requesterId: uuid('requester_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  itemId: uuid('item_id').references(() => item.id, { onDelete: 'restrict' }),
  batchId: uuid('batch_id').references(() => batch.id, { onDelete: 'restrict' }),
  status: serviceRequestStatus('status').notNull().default('requested'),
  chargeId: uuid('charge_id').references(() => charge.id, { onDelete: 'restrict' }),
  typeFields: jsonb('type_fields'),
  fulfillment: jsonb('fulfillment'),
  fulfilledBy: uuid('fulfilled_by').references(() => userAccount.id, { onDelete: 'restrict' }),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
