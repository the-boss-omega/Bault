import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BILLING_PORT, type BillingPort, type ChargeOutcome } from '../../shared/billing/billing.port';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { ConfirmationService } from '../../shared/confirmation/confirmation.service';
import { assertItemUncommitted } from '../../shared/item-commitment';
import { formatMinor } from '../../shared/money';
import { CustodyService } from '../cst/custody.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { item } from '../cst/cst.schema';
import { charge } from '../pay/pay.schema';
import { swapProposal, transaction } from './mkt.schema';
import { DEFAULT_CURRENCY, LedgerService } from '../pay/ledger.service';

type Kind = 'swap' | 'gift';

const COMMITTED_REFUSAL = 'so it cannot be swapped or given away';

@Injectable()
export class TradeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly confirmation: ConfirmationService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
  ) {}

  async proposeSwap(
    proposerId: string,
    responder: { id: string; username: string },
    offeredItemIds: string[],
    requestedItemIds: string[],
  ) {
    if (proposerId === responder.id) {
      throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'You cannot swap with yourself.', 403);
    }
    await this.assertTradable(proposerId, offeredItemIds, 'swap', null);
    await this.assertTradable(responder.id, requestedItemIds, 'swap', responder.username);

    return this.db.transaction(async (tx) => {
      const [s] = await tx
        .insert(swapProposal)
        .values({ proposerId, responderId: responder.id, offeredItemIds, requestedItemIds, proposerApproved: true, responderApproved: false })
        .returning({ id: swapProposal.id });
      if (!s) throw AppError.validation('The swap could not be saved. Try again.');
      await this.outbox.emit(tx, {
        aggregateType: 'swap',
        aggregateId: s.id,
        eventType: 'swap_proposed',
        payload: { responderId: responder.id },
      });
      return s;
    });
  }

  async initiateTransfer(fromUserId: string, itemId: string, toUserId: string) {
    if (fromUserId === toUserId) {
      throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'You cannot give a card to yourself.', 403);
    }
    await this.assertTradable(fromUserId, [itemId], 'gift', null);
    return this.confirmation.issue(fromUserId, 'transfer', { itemId, toUserId });
  }

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
    if (!s) throw AppError.validation('The gift could not be saved. Try again.');
    return { status: 'awaiting_recipient_approval', swapId: s.id };
  }

  async approve(actorId: string, swapId: string) {
    return this.custody.run(async (tx) => {
      const [s] = await tx.select().from(swapProposal).where(eq(swapProposal.id, swapId)).for('update').limit(1);
      if (!s) throw AppError.notFound('That swap or gift is not there any more.');
      const offered = s.offeredItemIds as string[];
      const requested = s.requestedItemIds as string[];
      const isTransfer = requested.length === 0;
      const kind: Kind = isTransfer ? 'gift' : 'swap';
      if (s.status !== 'pending') throw TradeService.notPending(kind, s.status);
      if (actorId !== s.proposerId && actorId !== s.responderId) {
        throw AppError.forbidden(`Only the two collectors in this ${kind} can approve it.`);
      }
      if (actorId === s.proposerId) {
        throw new AppError(
          ErrorCode.DUAL_CONSENT_REQUIRED,
          isTransfer
            ? 'You offered this gift, so it is waiting for the recipient to accept it.'
            : 'You proposed this swap, so it is waiting for the other collector to approve it.',
          409,
        );
      }

      await this.custody.lockItems(tx, [...offered, ...requested]);
      for (const id of [...offered, ...requested]) await assertItemUncommitted(tx as Database, id, COMMITTED_REFUSAL);
      for (const id of offered) {
        await this.custody.transferOwnership(tx, id, s.responderId, actorId, isTransfer ? 'gift transfer' : 'swap', {
          ownerId: s.proposerId,
        });
      }
      for (const id of requested) {
        await this.custody.transferOwnership(tx, id, s.proposerId, actorId, 'swap', { ownerId: s.responderId });
      }

      const payers: Array<{ side: 'proposer' | 'responder'; userId: string }> = [{ side: 'proposer', userId: s.proposerId }];
      if (!isTransfer) payers.push({ side: 'responder', userId: s.responderId });
      for (const userId of payers.map((p) => p.userId).sort()) await this.ledger.lockWallet(userId, tx as Database);

      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction),
          type: isTransfer ? 'transfer' : 'swap',
          itemIds: [...offered, ...requested],
          fee: 0,
          currency: DEFAULT_CURRENCY,
        })
        .returning({ id: transaction.id });
      if (!txn) throw AppError.validation(`The ${kind} could not be recorded. Try again.`);

      const charges: Array<Record<string, unknown>> = [];
      let feeTotal = 0;
      for (const payer of payers) {
        const outcome = await this.billing.charge(tx as Database, { userId: payer.userId, actionType: 'service' });
        charges.push({ side: payer.side, ...(await this.linkCharge(tx as Database, outcome, txn.id)) });
        const charged = outcome.kind === 'charged' ? outcome.amountMinor : 0;
        feeTotal += charged;
        const balance = await this.ledger.balanceOf(payer.userId, tx as Database);
        if (balance.amount < 0) {
          throw new AppError(
            ErrorCode.INSUFFICIENT_BALANCE,
            payer.userId !== actorId
              ? `The other collector cannot cover their fee for this ${kind} right now, so it stays open. Try again later.`
              : charged > 0
                ? `Your balance does not cover the ${formatMinor(charged)} fee for this ${kind}. Add money first, then approve it again.`
                : `Your balance is negative, so this ${kind} cannot go through yet. Add money first, then approve it again.`,
            409,
          );
        }
      }

      await tx.update(transaction).set({ fee: feeTotal, frozenPricing: { charges } }).where(eq(transaction.id, txn.id));
      await tx.update(swapProposal).set({ status: 'executed', responderApproved: true, updatedAt: new Date() }).where(eq(swapProposal.id, swapId));
      await this.outbox.emit(tx, {
        aggregateType: 'swap',
        aggregateId: swapId,
        eventType: isTransfer ? 'transfer_completed' : 'swap_completed',
        payload: { transactionId: txn.id, recipientIds: [s.proposerId, s.responderId] },
      });
      return { status: 'executed', transactionId: txn.id };
    });
  }

  private async linkCharge(tx: Database, outcome: ChargeOutcome, transactionId: string): Promise<Record<string, unknown>> {
    if (outcome.kind === 'covered') return { outcome: 'covered', periodId: outcome.periodId, allowance: outcome.allowance };
    if (outcome.kind === 'free') return { outcome: 'free' };
    const [row] = await tx
      .update(charge)
      .set({ referenceId: transactionId, updatedAt: new Date() })
      .where(eq(charge.id, outcome.chargeId))
      .returning({ snapshot: charge.pricingRuleSnapshot });
    return { outcome: 'charged', chargeId: outcome.chargeId, amountMinor: outcome.amountMinor, snapshot: row?.snapshot ?? null };
  }

  async reject(actorId: string, swapId: string) {
    const [s] = await this.db.select().from(swapProposal).where(eq(swapProposal.id, swapId)).limit(1);
    if (!s) throw AppError.notFound('That swap or gift is not there any more.');
    const kind: Kind = (s.requestedItemIds as string[]).length === 0 ? 'gift' : 'swap';
    if (actorId !== s.proposerId && actorId !== s.responderId) {
      throw AppError.forbidden(`Only the two collectors in this ${kind} can turn it down.`);
    }
    return this.db.transaction(async (tx) => {
      const [rejected] = await tx
        .update(swapProposal)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(and(eq(swapProposal.id, swapId), eq(swapProposal.status, 'pending')))
        .returning({ id: swapProposal.id });
      if (!rejected) throw TradeService.notPending(kind, s.status === 'pending' ? 'closed' : s.status);
      const rejectedBy = actorId === s.proposerId ? ('proposer' as const) : ('responder' as const);
      await this.outbox.emit(tx, {
        aggregateType: 'swap',
        aggregateId: swapId,
        eventType: 'swap_rejected',
        payload: { recipientIds: [rejectedBy === 'proposer' ? s.responderId : s.proposerId], kind, rejectedBy },
      });
      return { status: 'rejected' };
    });
  }

  private static notPending(kind: Kind, status: string): AppError {
    const what = kind === 'gift' ? 'This gift' : 'This swap';
    const done =
      status === 'executed' ? 'has already gone through' : status === 'rejected' ? 'has already been turned down' : 'is no longer open';
    return new AppError(ErrorCode.CONFLICT, `${what} ${done}.`, 409);
  }

  private async assertTradable(ownerId: string, itemIds: string[], kind: Kind, ownerUsername: string | null): Promise<void> {
    const verb = kind === 'gift' ? 'given away' : 'swapped';
    for (const id of itemIds) {
      const [it] = await this.db.select().from(item).where(eq(item.id, id)).limit(1);
      if (!it || it.ownerId !== ownerId) {
        throw AppError.forbidden(
          ownerUsername === null
            ? `You can only ${kind === 'gift' ? 'give away' : 'offer'} cards in your own vault.`
            : `That card is not ${ownerUsername}'s to swap.`,
        );
      }
      const card = it.description.trim() || it.serialNumber;
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, `${card} is on hold, so it cannot be ${verb} right now.`, 409);
      if (it.lifecycleState !== 'stored') {
        throw new AppError(
          ErrorCode.CONFLICT,
          `${card} is ${it.lifecycleState.replace(/_/g, ' ')}, and only a card stored in the vault can be ${verb}.`,
          409,
        );
      }
      await assertItemUncommitted(this.db, id, COMMITTED_REFUSAL);
    }
  }
}
