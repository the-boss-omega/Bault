import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount } from '../acc/acc.schema';
import { supportMessage, supportTicket } from './sup.schema';

export type TicketCategory = 'parcel' | 'shipment' | 'item' | 'billing' | 'account' | 'other';
export type TicketStatus = 'open' | 'awaiting_customer' | 'resolved';

export interface OpenTicketInput {
  category: TicketCategory;
  subject: string;
  body: string;
  relatedType?: string;
  relatedId?: string;
}

/** Who is asking. Staff see every ticket; a collector sees only their own. */
export interface TicketActor {
  id: string;
  role: string;
}

const MAX_SUBJECT = 200;
const MAX_BODY = 5_000;

/**
 * The helpdesk.
 *
 * A ticket is a conversation with exactly one open question at any moment:
 * whose turn is it? `open` means staff, `awaiting_customer` means the customer,
 * `resolved` means nobody — until the customer replies, which reopens it,
 * because a person who answers a closed ticket is telling you it was not
 * actually resolved.
 *
 * Messages are append-only. A support thread is the record of what a company
 * told somebody about their money, their property, or why their account was
 * locked, and a version of it that can be edited afterwards is not a record.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  private staff(actor: TicketActor): boolean {
    return actor.role === 'warehouse_operator' || actor.role === 'admin';
  }

  /**
   * Load a ticket on behalf of a caller.
   *
   * `notFound` rather than `forbidden` when a collector asks for somebody else's:
   * confirming that a ticket id exists is itself a leak, and the ids are
   * guessable enough to matter.
   */
  private async loadFor(ticketId: string, actor: TicketActor) {
    const [row] = await this.db.select().from(supportTicket).where(eq(supportTicket.id, ticketId)).limit(1);
    if (!row) throw AppError.notFound('Ticket not found');
    if (!this.staff(actor) && row.userId !== actor.id) throw AppError.notFound('Ticket not found');
    return row;
  }

  /** Open a ticket. The first message is the body — a ticket is never empty. */
  async open(userId: string, input: OpenTicketInput) {
    const subject = input.subject?.trim() ?? '';
    const body = input.body?.trim() ?? '';
    if (!subject) throw AppError.validation('A subject is required');
    if (!body) throw AppError.validation('Describe what you need help with');
    if (subject.length > MAX_SUBJECT) throw AppError.validation('Subject is too long');
    if (body.length > MAX_BODY) throw AppError.validation('Message is too long');

    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [ticket] = await tx
        .insert(supportTicket)
        .values({
          code: prefixedId(ID_PREFIX.ticket),
          userId,
          category: input.category,
          subject,
          status: 'open',
          relatedType: input.relatedType?.trim() || null,
          relatedId: input.relatedId?.trim() || null,
          lastMessageAt: now,
        })
        .returning();
      if (!ticket) throw AppError.validation('Failed to open the ticket');

      await tx.insert(supportMessage).values({
        ticketId: ticket.id,
        authorId: userId,
        authorRole: 'customer',
        body,
      });

      return ticket;
    });
  }

  /** A collector's own tickets, most recently active first. */
  listMine(userId: string) {
    return this.db
      .select({
        id: supportTicket.id,
        code: supportTicket.code,
        category: supportTicket.category,
        subject: supportTicket.subject,
        status: supportTicket.status,
        relatedType: supportTicket.relatedType,
        relatedId: supportTicket.relatedId,
        lastMessageAt: supportTicket.lastMessageAt,
        createdAt: supportTicket.createdAt,
      })
      .from(supportTicket)
      .where(eq(supportTicket.userId, userId))
      .orderBy(desc(supportTicket.lastMessageAt));
  }

  /**
   * The staff queue: everything that is not resolved.
   *
   * Ordered by `lastMessageAt` ASCENDING — longest-waiting first. A support
   * queue sorted newest-first is a queue in which the person who has been
   * ignored longest keeps being ignored.
   */
  listQueue() {
    return this.db
      .select({
        id: supportTicket.id,
        code: supportTicket.code,
        category: supportTicket.category,
        subject: supportTicket.subject,
        status: supportTicket.status,
        relatedType: supportTicket.relatedType,
        relatedId: supportTicket.relatedId,
        assignedTo: supportTicket.assignedTo,
        lastMessageAt: supportTicket.lastMessageAt,
        createdAt: supportTicket.createdAt,
        customerUsername: userAccount.username,
        /** Surfaced so staff can see at a glance who is locked out and asking. */
        customerStatus: userAccount.status,
      })
      .from(supportTicket)
      .leftJoin(userAccount, eq(userAccount.id, supportTicket.userId))
      .where(inArray(supportTicket.status, ['open', 'awaiting_customer']))
      .orderBy(asc(supportTicket.lastMessageAt));
  }

  /** One ticket with its whole thread, oldest message first. */
  async thread(ticketId: string, actor: TicketActor) {
    const ticket = await this.loadFor(ticketId, actor);
    const messages = await this.db
      .select({
        id: supportMessage.id,
        authorRole: supportMessage.authorRole,
        body: supportMessage.body,
        createdAt: supportMessage.createdAt,
        authorUsername: userAccount.username,
      })
      .from(supportMessage)
      .leftJoin(userAccount, eq(userAccount.id, supportMessage.authorId))
      .where(eq(supportMessage.ticketId, ticketId))
      .orderBy(asc(supportMessage.createdAt));
    return { ticket, messages };
  }

  /**
   * Reply to a ticket.
   *
   * The status flip is automatic and follows from who spoke: a customer reply
   * puts the ball back with staff, a staff reply puts it back with the customer.
   * Nobody has to remember to set it, which is the only way a status like this
   * stays true.
   */
  async reply(ticketId: string, actor: TicketActor, rawBody: string) {
    const body = rawBody?.trim() ?? '';
    if (!body) throw AppError.validation('A reply cannot be empty');
    if (body.length > MAX_BODY) throw AppError.validation('Message is too long');

    const ticket = await this.loadFor(ticketId, actor);
    const fromStaff = this.staff(actor);

    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.insert(supportMessage).values({
        ticketId,
        authorId: actor.id,
        authorRole: fromStaff ? 'staff' : 'customer',
        body,
      });

      const nextStatus: TicketStatus = fromStaff ? 'awaiting_customer' : 'open';
      await tx
        .update(supportTicket)
        .set({
          status: nextStatus,
          lastMessageAt: now,
          // A reply on a resolved ticket reopens it, and clears the resolution
          // rather than leaving a resolved-at timestamp on a live conversation.
          resolvedAt: null,
          resolvedBy: null,
          // A staff reply claims the ticket if nobody had.
          assignedTo: fromStaff ? (ticket.assignedTo ?? actor.id) : ticket.assignedTo,
          updatedAt: now,
        })
        .where(eq(supportTicket.id, ticketId));

      // Only the customer is notified. Staff work from the queue, and an in-app
      // notification to a shared role is a notification nobody owns.
      if (fromStaff) {
        await this.outbox.emit(tx, {
          aggregateType: 'support_ticket',
          aggregateId: ticketId,
          eventType: 'support_ticket_replied',
          payload: { userId: ticket.userId, ticketCode: ticket.code, subject: ticket.subject },
        });
      }

      return { status: nextStatus };
    });
  }

  /** Staff mark a ticket done. A later customer reply reopens it. */
  async resolve(ticketId: string, actor: TicketActor) {
    if (!this.staff(actor)) throw AppError.forbidden('Only staff can resolve a ticket');
    const ticket = await this.loadFor(ticketId, actor);
    if (ticket.status === 'resolved') {
      throw new AppError(ErrorCode.CONFLICT, 'Ticket is already resolved', 409);
    }

    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(supportTicket)
        .set({ status: 'resolved', resolvedAt: now, resolvedBy: actor.id, updatedAt: now })
        .where(eq(supportTicket.id, ticketId));
      await this.outbox.emit(tx, {
        aggregateType: 'support_ticket',
        aggregateId: ticketId,
        eventType: 'support_ticket_resolved',
        payload: { userId: ticket.userId, ticketCode: ticket.code, subject: ticket.subject },
      });
      return { status: 'resolved' as const };
    });
  }

  /** Staff claim a ticket, so two people do not answer the same one. */
  async assign(ticketId: string, actor: TicketActor) {
    if (!this.staff(actor)) throw AppError.forbidden('Only staff can take a ticket');
    await this.loadFor(ticketId, actor);
    await this.db
      .update(supportTicket)
      .set({ assignedTo: actor.id, updatedAt: new Date() })
      .where(eq(supportTicket.id, ticketId));
    return { assignedTo: actor.id };
  }

  /** How many tickets are waiting on staff — for the console's queue badge. */
  async openCount() {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTicket)
      .where(eq(supportTicket.status, 'open'));
    return { open: row?.count ?? 0 };
  }

  /** Unread-ish signal for the customer: tickets currently awaiting them. */
  async awaitingMe(userId: string) {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTicket)
      .where(and(eq(supportTicket.userId, userId), eq(supportTicket.status, 'awaiting_customer')));
    return { awaiting: row?.count ?? 0 };
  }
}
