import { Injectable } from '@nestjs/common';
import type { Database } from '../../db/client';
import type { BillableAction, BillingPort } from '../../shared/billing/billing.port';
import { AppError } from '../../shared/errors/app-error';
import { PricingService } from '../prc/pricing.service';
import { MembershipService } from '../mem/membership.service';
import { allowanceFor } from '../mem/tiers';
import { LedgerService } from './ledger.service';
import { charge } from './pay.schema';

/**
 * Billing engine (Principle VI): the BillingPort implementation. For any
 * billable action a membership does not cover, it does this inside the
 * caller's transaction:
 *   1. resolves the in-force price from PRC (with snapshot),
 *   2. inserts a settled Charge (with that snapshot),
 *   3. appends a ledger DEBIT.
 *
 * A negative resulting balance is allowed here; it BLOCKS defined services and
 * accrues interest elsewhere. Storage/service/shipping/intake use fixed prices;
 * the marketplace fee (percentage) is charged directly by the purchase flow.
 */
@Injectable()
export class BillingService implements BillingPort {
  constructor(
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly memberships: MembershipService,
  ) {}

  async charge(tx: Database, action: BillableAction): Promise<void> {
    /**
     * Included in a membership? Then there is no charge, and nothing to record.
     *
     * Every fixed-price billable action (intake, the flat and per-service fees,
     * both parcel fees) arrives here, so this one check covers all of them; a
     * tier that covers a new action needs only a line in `tiers.ts`.
     *
     * `consume` runs inside this transaction, so the allowance is spent if and
     * only if the action commits, and it fails closed to the ordinary price.
     * It runs BEFORE the price is resolved, so an unpriced-but-included action
     * does not throw.
     */
    const billedAs = action.feeActionType ?? action.actionType;
    const entitlement = await this.memberships.consume(tx, action.userId, allowanceFor(billedAs));
    if (entitlement.covered) return;

    /**
     * A caller may name a narrower rule than its action type. It is TRIED, not
     * required: an unconfigured variant falls back to the action's own rule
     * rather than costing nothing.
     */
    const opts = { itemClass: action.itemClass };
    const { amount, snapshot } =
      (action.feeActionType ? await this.pricing.tryPrice(action.feeActionType, opts, tx) : null) ??
      (await this.pricing.price(action.actionType, opts, tx));
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
