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
    private readonly memberships: MembershipService,
  ) {}

  async charge(tx: Database, action: BillableAction): Promise<void> {
    /**
     * INCLUDED IN A MEMBERSHIP? Then there is no charge, and nothing to record.
     *
     * This is the only place the entitlement is checked, and that is deliberate.
     * Every fixed-price billable action in the product — intake, the flat and
     * per-service fees, both parcel fees — arrives here, so one check covers all
     * of them and no caller has to remember. A tier that starts covering a new
     * action needs a line in `tiers.ts` and nothing else.
     *
     * `consume` runs inside this transaction, so the allowance is spent if and
     * only if the action it covered actually commits. It fails closed: a
     * non-member, a lapsed cycle, or an action no tier names all answer "not
     * covered", and the code below charges the ordinary price.
     *
     * Note the ORDER — the allowance is checked BEFORE the price is resolved.
     * An included action does not need a price, and resolving one would make an
     * unpriced-but-included action throw.
     */
    const billedAs = action.feeActionType ?? action.actionType;
    const entitlement = await this.memberships.consume(tx, action.userId, allowanceFor(billedAs));
    if (entitlement.covered) return;

    /**
     * A caller may name a narrower rule than its action type. It is TRIED, not
     * required: an unconfigured variant falls back to the action's own rule
     * rather than costing nothing, so adding a grading tier without adding its
     * price makes it expensive-by-default instead of free-by-default.
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
