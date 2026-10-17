import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { Roles } from '../sec/roles.decorator';
import { pricingRule } from './prc.schema';
import { billableActions, coverage } from './billable-actions';

/**
 * Is every price loaded? Admin only.
 *
 * No migration inserts a pricing rule, so a database built for production by
 * migration alone cannot price an intake, and a handful of actions quietly
 * fall back to another price, to a figure in the code, or to nothing. This is
 * the one place the launch procedure reads to confirm, action by action, that
 * none of that will happen to the first customer. See `billable-actions.ts`.
 */
@ApiTags('PRC')
@Roles('admin')
@Controller('admin/pricing')
export class PricingCoverageController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get('coverage')
  async coverage() {
    // "In force" is the test `PricingService.price` applies when it charges:
    // effective now and not yet superseded.
    const now = new Date();
    const rules = await this.db
      .select({
        id: pricingRule.id,
        actionType: pricingRule.actionType,
        itemClass: pricingRule.itemClass,
        model: pricingRule.model,
        value: pricingRule.value,
        currency: pricingRule.currency,
        effectiveFrom: pricingRule.effectiveFrom,
      })
      .from(pricingRule)
      .where(
        and(
          lte(pricingRule.effectiveFrom, now),
          or(isNull(pricingRule.effectiveTo), sql`${pricingRule.effectiveTo} > now()`),
        ),
      );
    return { ...coverage(billableActions(), rules), checkedAt: now };
  }
}
