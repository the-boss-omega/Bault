import { pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const supportTicketStatus = pgEnum('support_ticket_status', [
  'open',
  'awaiting_customer',
  'resolved',
]);

export const supportTicketCategory = pgEnum('support_ticket_category', [
  'parcel',
  'shipment',
  'item',
  'billing',
  'account',
  'private_sale',
  'other',
]);

export const supportTicket = pgTable(
  'support_ticket',
  {
    id: pkId(),
    code: text('code').notNull(),
    userId: text('user_id').notNull(),
    category: supportTicketCategory('category').notNull(),
    subject: text('subject').notNull(),
    status: supportTicketStatus('status').notNull().default('open'),

    relatedType: text('related_type'),
    relatedId: text('related_id'),

    assignedTo: text('assigned_to'),

    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ supportTicketCodeUnique: uniqueIndex('support_ticket_code_unique').on(t.code) }),
);

export const supportMessage = pgTable('support_message', {
  id: pkId(),
  ticketId: text('ticket_id').notNull(),
  authorId: text('author_id').notNull(),
  authorRole: text('author_role').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
});
