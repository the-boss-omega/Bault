import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ConfirmationService } from '../../shared/confirmation/confirmation.service';
import { CustodyService } from '../cst/custody.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { item } from '../cst/cst.schema';
import { transaction } from '../mkt/mkt.schema';
import { DEFAULT_CURRENCY } from '../pay/ledger.service';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { ServiceRequestService } from './service.service';

/**
 * Donation (T098, Principles I & VII) — Opus-tier, irreversible.
 *
 * Two-step confirmed. On confirm, in ONE transaction: the item's ownership moves
 * to the platform custodian (so it leaves the donor's vault WITHOUT the record
 * ever being deleted and while keeping exactly one owner), its lifecycle becomes
 * the terminal `donated`, a billable service request is recorded, and an outbox
 * event is emitted. The custody event + completed request are the final record.
 */
@Injectable()
export class DonationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly confirmation: ConfirmationService,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly outbox: OutboxService,
  ) {}

  /** Step 1: validate and return a confirmation challenge. */
  async request(ownerId: string, itemId: string) {
    const [it] = await this.db.select().from(item).where(eq(item.id, itemId)).limit(1);
    if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
    if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);
    if (it.lifecycleState !== 'stored') throw new AppError(ErrorCode.CONFLICT, 'Item must be stored', 409);
    return this.confirmation.issue(ownerId, 'donation', { itemId });
  }

  /** Step 2: consume the confirmation and execute the donation atomically. */
  async confirm(ownerId: string, confirmationToken: string) {
    const { itemId } = await this.confirmation.consume<{ itemId: string }>(ownerId, 'donation', confirmationToken);

    return this.custody.run(async (tx) => {
      const platformId = await this.requests.platformAccountId(tx);
      const req = await this.requests.create(tx, { type: 'donation', requesterId: ownerId, itemId });
      if (!req) throw AppError.validation('Failed to create donation request');

      await this.custody.transferOwnership(tx, itemId, platformId, ownerId, 'donation');
      await this.custody.changeState(tx, itemId, 'donated', ownerId, 'donated');

      // A donation is an ownership-changing transaction, so it is recorded like
      // any other (Requirement 13.1) — price null, since no money changes hands.
      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction),
          type: 'transfer',
          itemIds: [itemId],
          buyerId: platformId,
          sellerId: ownerId,
          price: null,
          fee: 0,
          frozenPricing: { reason: 'donation' },
          currency: DEFAULT_CURRENCY,
        })
        .returning({ id: transaction.id });

      await this.requests.setStatus(tx, req.id, 'completed', { transactionId: txn?.id });

      await this.outbox.emit(tx, {
        aggregateType: 'item',
        aggregateId: itemId,
        eventType: 'item_donated',
        payload: { itemId, donorId: ownerId },
      });
      return { status: 'donated', itemId };
    });
  }
}
