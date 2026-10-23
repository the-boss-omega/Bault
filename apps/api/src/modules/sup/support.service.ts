import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
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

export interface TicketActor {
  id: string;
  role: string;
  status: string;
}

const MAX_SUBJECT = 200;
const MAX_BODY = 5_000;

@Injectable()
export class SupportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  private hasStaffRole(actor: TicketActor): boolean {
    return actor.role === 'warehouse_operator' || actor.role === 'admin';
  }

  private staff(actor: TicketActor): boolean {
    return this.hasStaffRole(actor) && actor.status === 'active';
  }

  private async loadFor(ticketId: string, actor: TicketActor) {
    const [row] = await this.db.select().from(supportTicket).where(eq(supportTicket.id, ticketId)).limit(1);
    if (!row) throw AppError.notFound('Ticket not found');
    if (!this.staff(actor) && row.userId !== actor.id) {
      if (this.hasStaffRole(actor)) {
        throw AppError.forbidden('Staff access to the helpdesk needs an active account.');
      }
      throw AppError.notFound('Ticket not found');
    }
    return row;
  }

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
        customerStatus: userAccount.status,
      })
      .from(supportTicket)
      .leftJoin(userAccount, eq(userAccount.id, supportTicket.userId))
      .where(inArray(supportTicket.status, ['open', 'awaiting_customer']))
      .orderBy(asc(supportTicket.lastMessageAt));
  }

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
          resolvedAt: null,
          resolvedBy: null,
          assignedTo: fromStaff ? (ticket.assignedTo ?? actor.id) : ticket.assignedTo,
          updatedAt: now,
        })
        .where(eq(supportTicket.id, ticketId));

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

  async resolve(ticketId: string, actor: TicketActor) {
    if (!this.staff(actor)) throw AppError.forbidden('Only staff can resolve a ticket');
    const ticket = await this.loadFor(ticketId, actor);

    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [resolved] = await tx
        .update(supportTicket)
        .set({ status: 'resolved', resolvedAt: now, resolvedBy: actor.id, updatedAt: now })
        .where(and(eq(supportTicket.id, ticketId), ne(supportTicket.status, 'resolved')))
        .returning({ id: supportTicket.id });
      if (!resolved) throw new AppError(ErrorCode.CONFLICT, 'Ticket is already resolved', 409);
      await this.outbox.emit(tx, {
        aggregateType: 'support_ticket',
        aggregateId: ticketId,
        eventType: 'support_ticket_resolved',
        payload: { userId: ticket.userId, ticketCode: ticket.code, subject: ticket.subject },
      });
      return { status: 'resolved' as const };
    });
  }

  async assign(ticketId: string, actor: TicketActor) {
    if (!this.staff(actor)) throw AppError.forbidden('Only staff can take a ticket');
    await this.loadFor(ticketId, actor);
    const [taken] = await this.db
      .update(supportTicket)
      .set({ assignedTo: actor.id, updatedAt: new Date() })
      .where(
        and(
          eq(supportTicket.id, ticketId),
          or(isNull(supportTicket.assignedTo), eq(supportTicket.assignedTo, actor.id)),
        ),
      )
      .returning({ id: supportTicket.id });
    if (!taken) throw new AppError(ErrorCode.CONFLICT, 'Someone else has already taken this ticket.', 409);
    return { assignedTo: actor.id };
  }

  async openCount() {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTicket)
      .where(eq(supportTicket.status, 'open'));
    return { open: row?.count ?? 0 };
  }

  async awaitingMe(userId: string) {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTicket)
      .where(and(eq(supportTicket.userId, userId), eq(supportTicket.status, 'awaiting_customer')));
    return { awaiting: row?.count ?? 0 };
  }
}
