import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const shipmentGroupStatus = pgEnum('shipment_group_status', [
  'forming',
  'locked',
  'dispatched',
  'cancelled',
]);

export const shipmentGroup = pgTable(
  'shipment_group',
  {
    id: pkId(),
    code: text('code').notNull(),
    payerUserId: text('payer_user_id').notNull(),
    destinationAddress: text('destination_address').notNull(),
    recipientName: text('recipient_name').notNull(),
    destinationCountry: text('destination_country').notNull().default('US'),
    destinationPostalCode: text('destination_postal_code').notNull(),
    destinationDetail: jsonb('destination_detail'),
    status: shipmentGroupStatus('status').notNull().default('forming'),
    notes: text('notes'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ shipmentGroupCodeUnique: uniqueIndex('shipment_group_code_unique').on(t.code) }),
);
