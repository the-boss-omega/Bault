import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { applyBasisPoints, formatMinor, money, type Money } from '../../shared/money';
import { userAccount } from '../acc/acc.schema';
import { discountedMinor, tierRule, type TierKey } from '../mem/tiers';
import { pricingRule } from './prc.schema';
import { billableActions } from './billable-actions';

export const MAX_ACTION_TYPE_LENGTH = 80;
export const MAX_ITEM_CLASS_LENGTH = 80;
export const MAX_RULE_DESCRIPTION_LENGTH = 300;
export const MAX_FIXED_PRICE_MINOR = 1_000_000;

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

export interface TierQuote {
  tier: TierKey;
  discountBps: number;
  listMinor: number;
  chargedMinor: number;
}

export interface PriceOptions {
  itemClass?: string;
  base?: Money;
  userId?: string;
}

@Injectable()
export class PricingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async createRule(adminId: string, input: CreateRuleInput) {
    if (!input.description?.trim()) throw AppError.validation('A rule description is required');
    if (input.model === 'percentage' && !billableActions().some((a) => a.actionType === input.actionType && a.percentOf)) {
      throw AppError.validation(`"${input.actionType}" has no amount to take a percentage of, so give it a fixed price`, {
        field: 'model',
      });
    }
    if (input.model === 'percentage' && input.value > 10_000) {
      throw AppError.validation('A percentage rule is at most 10000 basis points (100%)', { field: 'value' });
    }
    if (input.model === 'fixed' && input.value > MAX_FIXED_PRICE_MINOR) {
      throw AppError.validation(
        `A fixed price is at most ${formatMinor(MAX_FIXED_PRICE_MINOR)}. Check for an extra zero; the value is in cents.`,
        { field: 'value' },
      );
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
    if (!row) throw new Error('Failed to create pricing rule');
    return row;
  }

  async ruleInForce(actionType: string, itemClass?: string, tx?: Database) {
    const exec = tx ?? this.db;
    const rows = await exec
      .select()
      .from(pricingRule)
      .where(
        and(
          eq(pricingRule.actionType, actionType),
          or(isNull(pricingRule.itemClass), eq(pricingRule.itemClass, itemClass ?? '')),
          sql`${pricingRule.effectiveFrom} <= now()`,
          or(isNull(pricingRule.effectiveTo), sql`${pricingRule.effectiveTo} > now()`),
        ),
      )
      .orderBy(sql`${pricingRule.itemClass} nulls last`, sql`${pricingRule.effectiveFrom} desc`)
      .limit(1);
    return rows[0] ?? null;
  }

  async tierOf(userId: string, tx?: Database): Promise<TierKey> {
    const exec = tx ?? this.db;
    const [row] = await exec
      .select({ tier: userAccount.usageTier })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    return tierRule(row?.tier).key;
  }

  async quoteFor(userId: string, listMinor: number, tx?: Database): Promise<TierQuote> {
    return PricingService.atTier(await this.tierOf(userId, tx), listMinor);
  }

  static atTier(tier: TierKey, listMinor: number): TierQuote {
    const discountBps = tierRule(tier).discountBps;
    return { tier, discountBps, listMinor, chargedMinor: discountedMinor(listMinor, discountBps) };
  }

  async tryPrice(actionType: string, opts: PriceOptions = {}, tx?: Database): Promise<PriceResult | null> {
    const rule = await this.ruleInForce(actionType, opts.itemClass, tx);
    if (!rule) return null;

    let amount: Money;
    if (rule.model === 'fixed') amount = money(rule.value, rule.currency);
    else if (opts.base) amount = applyBasisPoints(opts.base, rule.value);
    else {
      throw AppError.validation(`"${actionType}" is priced as a percentage, and nothing was given to take it of`, {
        actionType,
        ruleId: rule.id,
      });
    }

    const snapshot: Record<string, unknown> = {
      ruleId: rule.id,
      actionType: rule.actionType,
      itemClass: rule.itemClass,
      model: rule.model,
      value: rule.value,
      currency: rule.currency,
      effectiveFrom: rule.effectiveFrom,
    };
    if (!opts.userId) return { amount, snapshot };

    const quote = await this.quoteFor(opts.userId, amount.amount, tx);
    return {
      amount: money(quote.chargedMinor, amount.currency),
      snapshot: { ...snapshot, ...quote },
    };
  }

  async price(actionType: string, opts: PriceOptions = {}, tx?: Database): Promise<PriceResult> {
    const result = await this.tryPrice(actionType, opts, tx);
    if (!result) throw AppError.validation(`No pricing rule for action "${actionType}"`);
    return result;
  }
}
