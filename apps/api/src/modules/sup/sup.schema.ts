import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';

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
    userId: uuid('user_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
    category: supportTicketCategory('category').notNull(),
    subject: text('subject').notNull(),
    status: supportTicketStatus('status').notNull().default('open'),

    relatedType: text('related_type'),
    relatedId: text('related_id'),

    assignedTo: uuid('assigned_to').references(() => userAccount.id, { onDelete: 'restrict' }),

    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => userAccount.id, { onDelete: 'restrict' }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ supportTicketCodeUnique: uniqueIndex('support_ticket_code_unique').on(t.code) }),
);

export const supportMessage = pgTable('support_message', {
  id: pkId(),
  ticketId: uuid('ticket_id').notNull().references(() => supportTicket.id, { onDelete: 'restrict' }),
  authorId: uuid('author_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  authorRole: text('author_role').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
});
