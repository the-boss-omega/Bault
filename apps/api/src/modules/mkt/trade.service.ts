import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { ConfirmationService } from '../../shared/confirmation/confirmation.service';
import { CustodyService } from '../cst/custody.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { item } from '../cst/cst.schema';
import { swapProposal, transaction } from './mkt.schema';
import { DEFAULT_CURRENCY } from '../pay/ledger.service';

/**
 * Swaps & gift transfers (T089/T090, Principles V, VII, VIII).
 *
 * Both are modeled as a `swap_proposal` with DUAL approval. A swap exchanges two
 * item sets; a gift transfer is the degenerate case with an empty requested set.
 * Execution is atomic: mutual ownership transfers (custody events), a billable
 * service charge, an irreversible Transaction, and an outbox event — all in one
 * transaction, and only once BOTH parties have approved.
 */
@Injectable()
export class TradeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly confirmation: ConfirmationService,
    private readonly outbox: OutboxService,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
  ) {}

  async proposeSwap(
    proposerId: string,
    responderId: string,
    offeredItemIds: string[],
    requestedItemIds: string[],
  ) {
    if (proposerId === responderId) {
      throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'Cannot swap with yourself', 403);
    }
    await this.assertOwnedStoredUnheld(proposerId, offeredItemIds);
    await this.assertOwnedStoredUnheld(responderId, requestedItemIds);

    return this.db.transaction(async (tx) => {
      const [s] = await tx
        .insert(swapProposal)
        .values({ proposerId, responderId, offeredItemIds, requestedItemIds, proposerApproved: true, responderApproved: false })
        .returning();
      if (!s) throw AppError.validation('Failed to create swap proposal');
      await this.outbox.emit(tx, {
        aggregateType: 'swap',
        aggregateId: s.id,
        eventType: 'swap_proposed',
        payload: { responderId },
      });
      return s;
    });
  }

  /** Gift transfer, step 1: two-step confirmation on the sender's side. */
  async initiateTransfer(fromUserId: string, itemId: string, toUserId: string) {
    if (fromUserId === toUserId) {
      throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'Cannot transfer to yourself', 403);
    }
    await this.assertOwnedStoredUnheld(fromUserId, [itemId]);
    return this.confirmation.issue(fromUserId, 'transfer', { itemId, toUserId });
  }

  /** Gift transfer, step 2: sender confirms → a pending transfer awaits recipient approval. */
  async confirmTransfer(fromUserId: string, confirmationToken: string) {
    const { itemId, toUserId } = await this.confirmation.consume<{ itemId: string; toUserId: string }>(
      fromUserId,
      'transfer',
      confirmationToken,
    );
    const [s] = await this.db
      .insert(swapProposal)
      .values({ proposerId: fromUserId, responderId: toUserId, offeredItemIds: [itemId], requestedItemIds: [], proposerApproved: true, responderApproved: false })
      .returning();
    if (!s) throw AppError.validation('Failed to create transfer proposal');
    return { status: 'awaiting_recipient_approval', swapId: s.id };
  }

  /** Approve (responder consents). Executes atomically once BOTH sides approve. */
  async approve(actorId: string, swapId: string) {
    return this.custody.run(async (tx) => {
      const [s] = await tx.select().from(swapProposal).where(eq(swapProposal.id, swapId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Proposal not found');
      if (s.status !== 'pending') throw new AppError(ErrorCode.CONFLICT, 'Proposal not pending', 409);

      let responderApproved = s.responderApproved;
      if (actorId === s.responderId) responderApproved = true;
      else if (actorId !== s.proposerId) throw AppError.forbidden('Not a participant');

      if (!(s.proposerApproved && responderApproved)) {
        await tx.update(swapProposal).set({ responderApproved, updatedAt: new Date() }).where(eq(swapProposal.id, swapId));
        throw new AppError(ErrorCode.DUAL_CONSENT_REQUIRED, 'Awaiting both approvals', 409);
      }

      const offered = s.offeredItemIds as string[];
      const requested = s.requestedItemIds as string[];
      const isTransfer = requested.length === 0;

      // Mutual ownership transfers (each writes a custody event in this tx).
      for (const id of offered) {
        await this.custody.transferOwnership(tx, id, s.responderId, actorId, isTransfer ? 'gift transfer' : 'swap');
      }
      for (const id of requested) {
        await this.custody.transferOwnership(tx, id, s.proposerId, actorId, 'swap');
      }

      // Billable (Principle VI): a service charge to the proposer (+ responder for a swap).
      await this.billing.charge(tx, { userId: s.proposerId, actionType: 'service' });
      if (!isTransfer) await this.billing.charge(tx, { userId: s.responderId, actionType: 'service' });

      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction), // TXN-XXXXXXXX (Requirement 9.4)
          type: isTransfer ? 'transfer' : 'swap',
          itemIds: [...offered, ...requested],
          fee: 0,
          currency: DEFAULT_CURRENCY,
        })
        .returning({ id: transaction.id });
      if (!txn) throw AppError.validation('Failed to create swap transaction');

      await tx.update(swapProposal).set({ status: 'executed', responderApproved: true, updatedAt: new Date() }).where(eq(swapProposal.id, swapId));
      await this.outbox.emit(tx, {
        aggregateType: 'swap',
        aggregateId: swapId,
        eventType: isTransfer ? 'transfer_completed' : 'swap_completed',
        // Both sides are notified (Requirement 6.1) — the dispatcher fans a
        // `recipientIds` array out to one notification per participant.
        payload: { transactionId: txn.id, recipientIds: [s.proposerId, s.responderId] },
      });
      return { status: 'executed', transactionId: txn.id };
    });
  }

  async reject(actorId: string, swapId: string) {
    const [s] = await this.db.select().from(swapProposal).where(eq(swapProposal.id, swapId)).limit(1);
    if (!s) throw AppError.notFound('Proposal not found');
    if (actorId !== s.proposerId && actorId !== s.responderId) throw AppError.forbidden('Not a participant');
    await this.db.update(swapProposal).set({ status: 'rejected', updatedAt: new Date() }).where(eq(swapProposal.id, swapId));
    return { status: 'rejected' };
  }

  private async assertOwnedStoredUnheld(ownerId: string, itemIds: string[]): Promise<void> {
    for (const id of itemIds) {
      const [it] = await this.db.select().from(item).where(eq(item.id, id)).limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden(`Item ${id} is not yours`);
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, `Item ${id} is on hold`, 409);
      if (it.lifecycleState !== 'stored') {
        throw new AppError(ErrorCode.CONFLICT, `Item ${id} must be stored`, 409);
      }
    }
  }
}
