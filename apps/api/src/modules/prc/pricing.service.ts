import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { applyBasisPoints, money, type Money } from '../../shared/money';
import { pricingRule } from './prc.schema';

export type BillingTrigger = 'per_event' | 'daily' | 'weekly' | 'monthly';

export interface CreateRuleInput {
  actionType: string;
  itemClass?: string | null;
  description: string;
  model: 'fixed' | 'percentage';
  value: number;
  billingTrigger: BillingTrigger;
  parameters?: Record<string, unknown> | null;
}

export interface PriceResult {
  amount: Money;
  /** The exact rule applied — snapshotted onto charges/transactions (price freeze). */
  snapshot: Record<string, unknown>;
}

/**
 * Pricing resolution (T064, Principles VI & V).
 *
 * `resolve` finds the rule IN FORCE right now for an action (+ optional item class),
 * preferring a class-specific rule over the catch-all, newest effective_from first.
 * `price` computes the amount: fixed → the value; percentage → basis points of a
 * base amount (e.g. the marketplace fee on a sale price). The returned snapshot is
 * stored with the charge/transaction so future rule changes never alter it.
 */
@Injectable()
export class PricingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Admin creates a new effective-dated rule (PRC-02/ADM-02). Inserts a fresh row
   * effective NOW; `resolve` always picks the newest in-force rule, so the new row
   * supersedes older ones without editing them (price freeze preserved, PRC-04).
   */
  async createRule(adminId: string, input: CreateRuleInput) {
    // A rule must explicitly define what it is (description), how much (value),
    // its scope (actionType + itemClass), and how/when it is billed (Req 14.1).
    if (!input.description?.trim()) throw AppError.validation('A rule description is required');
    const [row] = await this.db
      .insert(pricingRule)
      .values({
        actionType: input.actionType,
        itemClass: input.itemClass ?? null,
        description: input.description.trim(),
        model: input.model,
        value: input.value,
        billingTrigger: input.billingTrigger,
        parameters: input.parameters ?? null,
        currency: 'USD',
        effectiveFrom: new Date(),
        updatedBy: adminId,
      })
      .returning();
    if (!row) throw AppError.validation('Failed to create pricing rule');
    return row;
  }

  async price(
    actionType: string,
    opts: { itemClass?: string; base?: Money } = {},
    tx?: Database,
  ): Promise<PriceResult> {
    const exec = tx ?? this.db;
    const rows = await exec
      .select()
      .from(pricingRule)
      .where(
        and(
          eq(pricingRule.actionType, actionType),
          or(isNull(pricingRule.itemClass), eq(pricingRule.itemClass, opts.itemClass ?? '')),
          sql`${pricingRule.effectiveFrom} <= now()`,
          or(isNull(pricingRule.effectiveTo), sql`${pricingRule.effectiveTo} > now()`),
        ),
      )
      // class-specific rule (itemClass not null) wins over the catch-all; then newest.
      .orderBy(sql`${pricingRule.itemClass} nulls last`, sql`${pricingRule.effectiveFrom} desc`)
      .limit(1);

    const rule = rows[0];
    if (!rule) throw AppError.validation(`No pricing rule for action "${actionType}"`);

    const amount =
      rule.model === 'fixed'
        ? money(rule.value, rule.currency)
        : applyBasisPoints(opts.base ?? money(0, rule.currency), rule.value);

    return {
      amount,
      snapshot: {
        ruleId: rule.id,
        actionType: rule.actionType,
        itemClass: rule.itemClass,
        model: rule.model,
        value: rule.value,
        currency: rule.currency,
        effectiveFrom: rule.effectiveFrom,
      },
    };
  }
}
