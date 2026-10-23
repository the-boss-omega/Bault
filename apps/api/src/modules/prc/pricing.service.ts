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
  snapshot: Record<string, unknown>;
}

@Injectable()
export class PricingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async createRule(adminId: string, input: CreateRuleInput) {
    if (!input.description?.trim()) throw AppError.validation('A rule description is required');
    if (input.model === 'percentage' && input.value > 10_000) {
      throw AppError.validation('A percentage rule is at most 10000 basis points (100%)', { field: 'value' });
    }
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

  async tryPrice(
    actionType: string,
    opts: { itemClass?: string; base?: Money } = {},
    tx?: Database,
  ): Promise<PriceResult | null> {
    try {
      return await this.price(actionType, opts, tx);
    } catch {
      return null;
    }
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
