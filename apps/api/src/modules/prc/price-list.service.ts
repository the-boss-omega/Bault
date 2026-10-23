import { Inject, Injectable } from '@nestjs/common';
import { and, desc, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { pricingRule } from './prc.schema';

export const PRICE_GROUPS = [
  'intake',
  'storage',
  'services',
  'grading',
  'shipping',
  'selling',
  'money',
] as const;
export type PriceGroup = (typeof PRICE_GROUPS)[number];

export function groupFor(actionType: string): PriceGroup {
  if (actionType.startsWith('grading_fee:')) return 'grading';
  if (actionType.startsWith('consignment_fee:')) return 'selling';
  if (actionType.startsWith('shipping_addon:')) return 'shipping';
  if (actionType.startsWith('white_glove:')) return 'shipping';
  if (actionType.startsWith('service_fee:')) return 'services';
  if (actionType.startsWith('storage')) return 'storage';
  if (actionType.startsWith('parcel_')) return 'intake';
  switch (actionType) {
    case 'intake':
    case 'intake_lot':
      return 'intake';
    case 'shipping':
    case 'shipping_rush':
    case 'show_pickup':
      return 'shipping';
    case 'marketplace_fee':
    case 'escrow_fee':
      return 'selling';
    case 'cash_out_fee':
    case 'chargeback_fee':
      return 'money';
    default:
      return 'services';
  }
}

@Injectable()
export class PriceListService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async publicList() {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(pricingRule)
      .where(
        and(
          lte(pricingRule.effectiveFrom, now),
          or(isNull(pricingRule.effectiveTo), sql`${pricingRule.effectiveTo} > now()`),
        ),
      )
      .orderBy(pricingRule.actionType, desc(pricingRule.effectiveFrom));

    const seen = new Set<string>();
    const current = rows.filter((r) => {
      const key = `${r.actionType}::${r.itemClass ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const groups = PRICE_GROUPS.map((group) => ({
      group,
      entries: current
        .filter((r) => groupFor(r.actionType) === group)
        .map((r) => ({
          actionType: r.actionType,
          itemClass: r.itemClass,
          description: r.description,
          model: r.model,
          value: r.value,
          currency: r.currency,
          billingTrigger: r.billingTrigger,
          parameters: r.parameters,
          effectiveFrom: r.effectiveFrom,
        })),
    })).filter((g) => g.entries.length > 0);

    return {
      groups,
      note: 'The rule in force at the moment of a charge is recorded with that charge, so a later price change never alters what you were already billed.',
      generatedAt: now,
    };
  }
}
