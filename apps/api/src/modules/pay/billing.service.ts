import { Injectable } from '@nestjs/common';
import type { Database } from '../../db/client';
import type { BillableAction, BillingPort } from '../../shared/billing/billing.port';
import { AppError } from '../../shared/errors/app-error';
import { PricingService } from '../prc/pricing.service';
import { LedgerService } from './ledger.service';
import { charge } from './pay.schema';

/**
 * Billing engine (T065, Principle VI) — the REAL BillingPort that replaces the
 * Phase-4 no-op. For any billable action it:
 *   1. resolves the in-force price from PRC (with snapshot),
 *   2. inserts a settled Charge (with that snapshot),
 *   3. appends a ledger DEBIT — all inside the caller's transaction.
 *
 * A negative resulting balance is allowed here; it BLOCKS defined services and
 * accrues interest elsewhere (Principle: negative balance). Storage/service/
 * shipping/intake use fixed prices; the marketplace fee (percentage) is charged
 * directly by the purchase flow, not here.
 */
@Injectable()
export class BillingService implements BillingPort {
  constructor(
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
  ) {}

  async charge(tx: Database, action: BillableAction): Promise<void> {
    const { amount, snapshot } = await this.pricing.price(action.actionType, {}, tx);
    if (amount.amount === 0) return; // free action; nothing to record

    const [row] = await tx
      .insert(charge)
      .values({
        userId: action.userId,
        actionType: action.actionType,
        pricingRuleSnapshot: snapshot,
        amount: amount.amount,
        currency: amount.currency,
        paymentMeans: 'wallet',
        status: 'settled',
        referenceId: action.itemId,
      })
      .returning({ id: charge.id });
    if (!row) throw AppError.validation('Failed to create charge');

    await this.ledger.record(
      {
        userId: action.userId,
        type: action.actionType === 'marketplace_fee' ? 'fee' : 'service_charge',
        amount: amount.amount,
        direction: 'debit',
        currency: amount.currency,
        referenceType: 'charge',
        referenceId: row.id,
      },
      tx,
    );
  }
}
