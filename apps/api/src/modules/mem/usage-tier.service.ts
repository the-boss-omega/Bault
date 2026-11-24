import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from '../acc/acc.schema';
import { usageTierRule } from './mem.schema';
import { MembershipService } from './membership.service';
import { TIER_RULES, TIER_WINDOW_DAYS, nextTier, tierRule } from './tiers';

@Injectable()
export class UsageTierService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly memberships: MembershipService,
  ) {}

  async onModuleInit() {
    for (const rule of TIER_RULES) {
      await this.db
        .insert(usageTierRule)
        .values({
          tier: rule.key,
          minActions: rule.minActions,
          minSpentMinor: rule.minSpentMinor,
          discountBps: rule.discountBps,
        })
        .onConflictDoUpdate({
          target: usageTierRule.tier,
          set: {
            minActions: rule.minActions,
            minSpentMinor: rule.minSpentMinor,
            discountBps: rule.discountBps,
            updatedAt: new Date(),
          },
          setWhere: sql`(${usageTierRule.minActions}, ${usageTierRule.minSpentMinor}, ${usageTierRule.discountBps}) IS DISTINCT FROM (${rule.minActions}, ${rule.minSpentMinor}, ${rule.discountBps})`,
        });
    }
  }

  rules() {
    return { windowDays: TIER_WINDOW_DAYS, currency: 'USD', rules: TIER_RULES };
  }

  async usage(userId: string, tx?: Database) {
    const exec = tx ?? this.db;
    const result = await exec.execute<{ actions: number; spent_minor: string }>(
      sql`SELECT actions, spent_minor::text FROM usage_tier_counts(${userId}::uuid)`,
    );
    const row = result.rows[0];
    return { actions: Number(row?.actions ?? 0), spentMinor: Number(row?.spent_minor ?? 0) };
  }

  async standing(userId: string) {
    const [account] = await this.db
      .select({ tier: userAccount.usageTier, computedAt: userAccount.usageTierComputedAt })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!account) throw AppError.notFound('Account not found');

    const usage = await this.usage(userId);
    const rule = tierRule(account.tier);
    return {
      tier: rule.key,
      discountBps: rule.discountBps,
      computedAt: account.computedAt,
      window: { days: TIER_WINDOW_DAYS, actions: usage.actions, spentMinor: usage.spentMinor },
      next: nextTier(rule.key, usage),
      rules: TIER_RULES,
      honoured: await this.memberships.allowances(userId),
    };
  }
}
