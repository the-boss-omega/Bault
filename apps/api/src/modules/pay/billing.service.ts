import { Injectable } from '@nestjs/common';
import type { Database } from '../../db/client';
import type { BillableAction, BillingPort } from '../../shared/billing/billing.port';
import { AppError } from '../../shared/errors/app-error';
import { PricingService } from '../prc/pricing.service';
import { MembershipService } from '../mem/membership.service';
import { allowanceFor } from '../mem/tiers';
import { LedgerService } from './ledger.service';
import { charge } from './pay.schema';

@Injectable()
export class BillingService implements BillingPort {
  constructor(
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly memberships: MembershipService,
  ) {}

  async charge(tx: Database, action: BillableAction): Promise<void> {
    const billedAs = action.feeActionType ?? action.actionType;
    const entitlement = await this.memberships.consume(tx, action.userId, allowanceFor(billedAs));
    if (entitlement.covered) return;

    const opts = { itemClass: action.itemClass };
    const { amount, snapshot } =
      (action.feeActionType ? await this.pricing.tryPrice(action.feeActionType, opts, tx) : null) ??
      (await this.pricing.price(action.actionType, opts, tx));
    if (amount.amount === 0) return;

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
