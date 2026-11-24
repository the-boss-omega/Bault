import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { membership, membershipPeriod } from './mem.schema';
import { UNLIMITED, covers, honouredAllowance, remaining } from './tiers';

export interface ShippingCover {
  tier: string;
  insuredShipmentsLeft: number;
  insuredValueCapMinor: number;
  postageCreditLeftMinor: number;
  rushIncluded: boolean;
  addOnsLeft: Record<string, number>;
}

export interface AppliedShippingCover {
  tier: string;
  insuredShipment: boolean;
  insuranceMinor: number;
  postageMinor: number;
  rushMinor: number;
  addOns: Record<string, number>;
  spentInPeriodId?: string;
}

export interface Entitlement {
  covered: boolean;
  remainingAfter: number | null;
  tier: string | null;
  periodId?: string;
}

@Injectable()
export class MembershipService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async current(userId: string, tx?: Database) {
    const exec = tx ?? this.db;
    const [m] = await exec.select().from(membership).where(eq(membership.userId, userId)).limit(1);
    if (!m || m.status === 'ended') return null;

    const [period] = await exec
      .select()
      .from(membershipPeriod)
      .where(and(eq(membershipPeriod.membershipId, m.id), eq(membershipPeriod.periodStart, m.currentPeriodStart)))
      .limit(1);

    return { membership: m, period: period ?? null };
  }

  async allowances(userId: string) {
    const state = await this.current(userId);
    if (!state || !this.isHonoured(state.membership)) return null;
    const allowance = honouredAllowance(state.membership.tier);
    if (!allowance) return null;

    const consumed = (state.period?.consumed as Record<string, number>) ?? {};
    return {
      tier: allowance.key,
      honouredUntil: state.membership.honouredUntil,
      perCycle: Object.fromEntries(
        Object.keys(allowance.perCycle).map((action) => [
          action,
          {
            allowed: allowance.perCycle[action],
            used: consumed[action] ?? 0,
            remaining: remaining(allowance, action, consumed[action] ?? 0),
          },
        ]),
      ),
      storedItems: state.membership.honouredStoredItems,
      insuredShipments: {
        allowed: allowance.insuredShipments,
        used: state.period?.insuredShipmentsUsed ?? 0,
        capMinor: allowance.insuredValueCapMinor,
      },
      postage: {
        creditMinor: allowance.postageCreditMinor,
        usedMinor: state.period?.postageUsedMinor ?? 0,
      },
      commission: {
        waivedOnMinor: allowance.commissionWaivedOnMinor,
        usedMinor: state.period?.commissionWaivedOnMinor ?? 0,
      },
      rushIncluded: allowance.rushIncluded,
    };
  }

  private isHonoured(m: typeof membership.$inferSelect, now = new Date()): boolean {
    if (m.status === 'ended' || !m.honouredUntil) return false;
    return now >= m.currentPeriodStart && now < m.currentPeriodEnd && now < m.honouredUntil;
  }

  async consume(tx: Database, userId: string, action: string): Promise<Entitlement> {
    const state = await this.current(userId, tx);
    if (!state) return { covered: false, remainingAfter: null, tier: null };

    const tier = honouredAllowance(state.membership.tier);
    if (!tier || !this.isHonoured(state.membership)) {
      return { covered: false, remainingAfter: null, tier: state.membership.tier };
    }

    const consumed = (state.period?.consumed as Record<string, number>) ?? {};
    const used = consumed[action] ?? 0;
    if (!covers(tier, action, used)) {
      return { covered: false, remainingAfter: 0, tier: tier.key };
    }

    const allowed = tier.perCycle[action];
    const updated = await tx
      .update(membershipPeriod)
      .set({
        consumed: sql`jsonb_set(
          coalesce(${membershipPeriod.consumed}, '{}'::jsonb),
          ARRAY[${action}],
          to_jsonb(coalesce((${membershipPeriod.consumed} ->> ${action})::int, 0) + 1)
        )`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(membershipPeriod.membershipId, state.membership.id),
          eq(membershipPeriod.periodStart, state.membership.currentPeriodStart),
          allowed === UNLIMITED
            ? sql`true`
            : sql`coalesce((${membershipPeriod.consumed} ->> ${action})::int, 0) < ${allowed}`,
        ),
      )
      .returning({ id: membershipPeriod.id });
    if (updated.length === 0) return { covered: false, remainingAfter: 0, tier: tier.key };

    const left = remaining(tier, action, used + 1);
    return {
      covered: true,
      remainingAfter: left === UNLIMITED ? UNLIMITED : left,
      tier: tier.key,
      periodId: updated[0]!.id,
    };
  }

  async restoreCounted(tx: Database, periodId: string, action: string): Promise<void> {
    await tx
      .update(membershipPeriod)
      .set({
        consumed: sql`jsonb_set(
          coalesce(${membershipPeriod.consumed}, '{}'::jsonb),
          ARRAY[${action}],
          to_jsonb(greatest(coalesce((${membershipPeriod.consumed} ->> ${action})::int, 0) - 1, 0))
        )`,
        updatedAt: new Date(),
      })
      .where(eq(membershipPeriod.id, periodId));
  }

  async waive(
    tx: Database,
    userId: string,
    action: 'marketplace_fee' | 'escrow_fee' | 'cash_out_fee' | 'show_pickup',
    feeMinor: number,
    valueMinor = 0,
    feeAt?: (valueMinor: number) => number,
  ): Promise<{ waivedMinor: number; tier: string | null; waivedOnMinor?: number; periodId?: string }> {
    const none = { waivedMinor: 0, tier: null };
    if (feeMinor <= 0) return none;
    const state = await this.current(userId, tx);
    if (!state || !this.isHonoured(state.membership)) return none;
    const tier = honouredAllowance(state.membership.tier);
    if (!tier) return none;

    if (action === 'marketplace_fee') {
      const cap = tier.commissionWaivedOnMinor;
      if (cap <= 0 || valueMinor <= 0) return none;
      const used = state.period?.commissionWaivedOnMinor ?? 0;
      const waivedOn = Math.min(Math.max(0, cap - used), valueMinor);
      if (waivedOn <= 0) return none;
      const updated = await tx
        .update(membershipPeriod)
        .set({
          commissionWaivedOnMinor: sql`${membershipPeriod.commissionWaivedOnMinor} + ${waivedOn}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(membershipPeriod.membershipId, state.membership.id),
            eq(membershipPeriod.periodStart, state.membership.currentPeriodStart),
            sql`${membershipPeriod.commissionWaivedOnMinor} + ${waivedOn} <= ${cap}`,
          ),
        )
        .returning({ id: membershipPeriod.id });
      if (updated.length === 0) return none;
      return {
        waivedMinor: Math.min(feeMinor, Math.round((feeMinor * waivedOn) / valueMinor)),
        tier: tier.key,
        waivedOnMinor: waivedOn,
      };
    }

    const entitlement = await this.consume(tx, userId, action);
    if (!entitlement.covered) return none;
    const periodId = entitlement.periodId;
    if (action === 'escrow_fee' && tier.escrowValueCapMinor > 0 && valueMinor > tier.escrowValueCapMinor && feeAt) {
      return { waivedMinor: Math.min(feeMinor, feeAt(tier.escrowValueCapMinor)), tier: tier.key, periodId };
    }
    return { waivedMinor: feeMinor, tier: tier.key, periodId };
  }

  async shippingCover(userId: string, tx?: Database): Promise<ShippingCover | null> {
    const state = await this.current(userId, tx);
    if (!state || !this.isHonoured(state.membership)) return null;
    const tier = honouredAllowance(state.membership.tier);
    if (!tier) return null;

    const p = state.period;
    const consumed = (p?.consumed as Record<string, number>) ?? {};
    const addOnsLeft: Record<string, number> = {};
    for (const action of Object.keys(tier.perCycle)) {
      if (action.startsWith('shipping_addon:')) addOnsLeft[action] = remaining(tier, action, consumed[action] ?? 0);
    }
    return {
      tier: tier.key,
      insuredShipmentsLeft: Math.max(0, tier.insuredShipments - (p?.insuredShipmentsUsed ?? 0)),
      insuredValueCapMinor: tier.insuredValueCapMinor,
      postageCreditLeftMinor: Math.max(0, tier.postageCreditMinor - (p?.postageUsedMinor ?? 0)),
      rushIncluded: tier.rushIncluded,
      addOnsLeft,
    };
  }

  async spendShippingCover(tx: Database, userId: string, applied: AppliedShippingCover): Promise<AppliedShippingCover> {
    const stale = () =>
      new AppError(
        ErrorCode.CONFLICT,
        'Your membership allowance has changed since this parcel was priced. Choose the rate again to see the current price.',
        409,
      );
    const state = await this.current(userId, tx);
    const tier = state ? honouredAllowance(state.membership.tier) : undefined;
    if (!state || !tier || !this.isHonoured(state.membership) || tier.key !== applied.tier) throw stale();
    if (applied.rushMinor > 0 && !tier.rushIncluded) throw stale();

    const insured = applied.insuredShipment ? 1 : 0;
    if (insured > 0 || applied.postageMinor > 0) {
      const updated = await tx
        .update(membershipPeriod)
        .set({
          insuredShipmentsUsed: sql`${membershipPeriod.insuredShipmentsUsed} + ${insured}`,
          postageUsedMinor: sql`${membershipPeriod.postageUsedMinor} + ${applied.postageMinor}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(membershipPeriod.membershipId, state.membership.id),
            eq(membershipPeriod.periodStart, state.membership.currentPeriodStart),
            sql`${membershipPeriod.insuredShipmentsUsed} + ${insured} <= ${tier.insuredShipments}`,
            sql`${membershipPeriod.postageUsedMinor} + ${applied.postageMinor} <= ${tier.postageCreditMinor}`,
          ),
        )
        .returning({ id: membershipPeriod.id });
      if (updated.length === 0) throw stale();
    }
    for (const action of Object.keys(applied.addOns)) {
      const e = await this.consume(tx, userId, action);
      if (!e.covered) throw stale();
    }
    return { ...applied, spentInPeriodId: state.period?.id };
  }

  async returnShippingCover(tx: Database, userId: string, applied: AppliedShippingCover): Promise<void> {
    let periodId = applied.spentInPeriodId;
    if (!periodId) {
      const state = await this.current(userId, tx);
      periodId = state?.period?.id;
    }
    if (!periodId) return;

    const insured = applied.insuredShipment ? 1 : 0;
    const postage = Math.max(0, applied.postageMinor ?? 0);
    if (insured > 0 || postage > 0) {
      await tx
        .update(membershipPeriod)
        .set({
          insuredShipmentsUsed: sql`greatest(${membershipPeriod.insuredShipmentsUsed} - ${insured}, 0)`,
          postageUsedMinor: sql`greatest(${membershipPeriod.postageUsedMinor} - ${postage}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(membershipPeriod.id, periodId));
    }
    for (const action of Object.keys(applied.addOns ?? {})) await this.restoreCounted(tx, periodId, action);
  }
}
