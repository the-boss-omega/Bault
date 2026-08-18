import { pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * SUP — the helpdesk.
 *
 * Bault had no way for a person to ask a question. No contact form, no address
 * published anywhere in the app, no inbox. That was survivable while everything
 * the platform did was self-service, and stopped being survivable the moment two
 * workflows started *depending* on a human conversation:
 *
 *   - cash-in and cash-out are reviewed by a person, so a request sitting in
 *     `pending_review` had no channel to ask about;
 *   - an account suspended for debt cannot sign in, cannot cash in, and so
 *     cannot clear the debt that suspended it. Recovery requires asking somebody.
 *
 * Both of those were recorded as honest limitations in Parts 13 and 15. This
 * closes them.
 */

/**
 * Ticket status answers exactly one question: WHOSE TURN IS IT?
 *
 * That is what a support queue is actually about, and it is why there is no
 * separate "in progress" — a ticket a staff member is thinking about is still
 * one the customer is waiting on, and pretending otherwise lets work sit in a
 * status that looks handled.
 *
 *   open               waiting on staff
 *   awaiting_customer  staff have replied; waiting on the customer
 *   resolved           done. A customer reply reopens it.
 */
export const supportTicketStatus = pgEnum('support_ticket_status', [
  'open',
  'awaiting_customer',
  'resolved',
]);

/**
 * What the ticket is about. Kept short and closed so the queue can be filtered
 * and so a customer is not asked to invent a taxonomy; `other` exists because a
 * forced-choice list with no escape produces miscategorised tickets rather than
 * accurate ones.
 */
export const supportTicketCategory = pgEnum('support_ticket_category', [
  'parcel',
  'shipment',
  'item',
  'billing',
  'account',
  /**
   * Selling a whole collection, rather than one card through a channel.
   *
   * Deliberately a ticket category and not a fourth half-built request type: a
   * private sale IS a conversation with a specialist about pricing, negotiation
   * and logistics, and the helpdesk is already exactly that.
   */
  'private_sale',
  'other',
]);

export const supportTicket = pgTable(
  'support_ticket',
  {
    id: pkId(),
    /** Human-facing Ticket ID, TKT-XXXXXXXX. What a person quotes. */
    code: text('code').notNull(),
    userId: text('user_id').notNull(),
    category: supportTicketCategory('category').notNull(),
    subject: text('subject').notNull(),
    status: supportTicketStatus('status').notNull().default('open'),

    /**
     * Optional link to the thing the ticket is about — a parcel, a shipment, an
     * item, a wallet request. Stored as a loose type+id pair rather than six
     * nullable foreign keys: the point is to carry context to whoever picks the
     * ticket up, not to enforce a relationship, and a ticket about a record that
     * is later corrected should not become unopenable.
     */
    relatedType: text('related_type'),
    relatedId: text('related_id'),

    /** The staff member who picked it up. Null while nobody has. */
    assignedTo: text('assigned_to'),

    /**
     * Denormalised from the newest message so the queue can sort by "who has
     * been waiting longest" without joining and aggregating the thread on every
     * page load. Written in the same transaction as the message it reflects.
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ supportTicketCodeUnique: uniqueIndex('support_ticket_code_unique').on(t.code) }),
);

/**
 * One message in a ticket thread. APPEND-ONLY.
 *
 * Registered with the guards in `0001_append_only.sql`. A support conversation is
 * the record of what a company told a customer — about their money, their
 * property, or why their account was locked. A version of it that can be edited
 * afterwards is not a record of anything.
 *
 * There is deliberately no `internal` flag in this first version. Staff-only
 * notes are a real helpdesk need, but every message here is visible to both
 * sides, which means there is no filter to get wrong and no way for a private
 * note to reach the customer through a missed `where` clause. See the honest
 * limitations in DIVE1 Part 17.
 */
export const supportMessage = pgTable('support_message', {
  id: pkId(),
  ticketId: text('ticket_id').notNull(),
  authorId: text('author_id').notNull(),
  /** 'customer' or 'staff' — who is speaking, for rendering the thread. */
  authorRole: text('author_role').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
});
