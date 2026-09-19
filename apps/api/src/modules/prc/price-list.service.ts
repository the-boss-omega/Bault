import { Inject, Injectable } from '@nestjs/common';
import { and, desc, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { pricingRule } from './prc.schema';

/**
 * The price list, written for a collector rather than for an administrator.
 *
 * `GET /pricing/rules` existed and returned every rule ever created — including
 * superseded ones — in the shape the admin console edits. Nothing in the
 * customer-facing product called it, which meant a collector could not find out
 * what anything cost until it had been charged to them. For a platform whose
 * entire economics are per-item fees, that is a straightforward omission.
 *
 * Three things make this different from the admin list, and each one is the
 * reason it could not simply be exposed as it stood:
 *
 *  - **Only what is in force.** A superseded rule is history, and showing it
 *    beside the current one turns a price list into a puzzle.
 *  - **Grouped by what a person is doing**, not by `action_type`. Somebody
 *    wants to know what it costs to send a card home, and "shipping",
 *    "shipping_rush" and "shipping_addon:gps_tracker" are three answers to that
 *    one question.
 *  - **The prefixed families collapsed.** `grading_fee:psa_express` and
 *    `consignment_fee:card_show` are variants of one thing, and a flat list of
 *    thirty action types reads as a database dump because it is one.
 */

/** The groups a reader actually thinks in. */
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

/**
 * Which group an action type belongs to.
 *
 * Prefix-first, so a whole family lands together and a new member of one needs
 * no change here — adding `grading_fee:bgs_black_label` groups itself.
 */
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

  /**
   * Every rule in force right now, grouped and ordered.
   *
   * "In force" is the same test `PricingService.price` applies when it charges
   * somebody — effective now, not yet superseded — so the list cannot quote a
   * figure the billing engine would not use.
   */
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

    /**
     * One rule per (action, class) — the newest effective one.
     *
     * A rule superseded by a later effective date is still "in force" by the
     * clause above until its predecessor is closed off, and the billing engine
     * takes the most recent. Quoting the older one would quote a price nobody
     * would be charged.
     */
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
          /** Cents for a fixed rule, basis points for a percentage one. */
          value: r.value,
          currency: r.currency,
          billingTrigger: r.billingTrigger,
          /** Storage terms and the like — read by the SPA to phrase a period. */
          parameters: r.parameters,
          effectiveFrom: r.effectiveFrom,
        })),
    })).filter((g) => g.entries.length > 0);

    return {
      groups,
      /**
       * Said plainly on the page, because it is the promise that makes a price
       * list worth reading at all.
       */
      note: 'The rule in force at the moment of a charge is recorded with that charge, so a later price change never alters what you were already billed.',
      generatedAt: now,
    };
  }
}
