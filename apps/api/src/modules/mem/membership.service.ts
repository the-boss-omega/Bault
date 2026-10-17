import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PricingService } from '../prc/pricing.service';
import { LedgerService } from '../pay/ledger.service';
import { WalletService } from '../pay/wallet.service';
import { charge } from '../pay/pay.schema';
import { membership, membershipPeriod } from './mem.schema';
import {
  MEMBERSHIP_TIERS,
  UNCOVERED,
  UNLIMITED,
  covers,
  isTierKey,
  membershipTier,
  remaining,
  tierRank,
  type MembershipTier,
} from './tiers';

/** How long a cycle is. Calendar months vary; a fixed window does not. */
const CYCLE_DAYS = 30;
const CYCLE_MS = CYCLE_DAYS * 86_400_000;

/**
 * What a member's tier can pay towards ONE parcel, right now.
 *
 * Read-only: a quote shows it, and nothing is spent until the parcel is paid for.
 */
export interface ShippingCover {
  tier: string;
  insuredShipmentsLeft: number;
  insuredValueCapMinor: number;
  postageCreditLeftMinor: number;
  rushIncluded: boolean;
  /** Per add-on fee action (`shipping_addon:gps_tracker`), how many are left. */
  addOnsLeft: Record<string, number>;
}

/**
 * What a tier actually paid towards a particular rate, as quoted and agreed.
 *
 * Stored on the shipment and spent at payment. Every figure is minor units the
 * MEMBER does not pay; the gross amounts stay on the rate, because Bault still
 * pays the real premium and the real postage.
 */
export interface AppliedShippingCover {
  tier: string;
  insuredShipment: boolean;
  insuranceMinor: number;
  postageMinor: number;
  rushMinor: number;
  addOns: Record<string, number>;
  /**
   * The membership period the cover was spent in, written when it is spent, so
   * a cancelled parcel gives it back to the cycle it came out of and not to
   * whichever cycle happens to be running when it is cancelled.
   */
  spentInPeriodId?: string;
}

export interface Entitlement {
  /** True when the tier covers this action and the allowance is not spent. */
  covered: boolean;
  /** Remaining after this one, or `UNLIMITED`. Null when not a member. */
  remainingAfter: number | null;
  tier: string | null;
  /** The period row the allowance was taken from, when it was. */
  periodId?: string;
}

/**
 * Membership: subscribing, renewing, and answering "is this one included".
 *
 * `consume` is what every billable action calls, and it must answer atomically
 * and fail closed:
 *
 *   - **Atomically**: it runs inside the caller's transaction, so an intake that
 *     consumes an allowance and then fails has not consumed it, and pressing the
 *     same button twice does not give two for one.
 *   - **Fail closed**: outside a paid-up cycle, with no membership, or on an
 *     action the tier does not name, the answer is "not covered", which means
 *     the ordinary price, shown and approved as for a non-member.
 *
 * Nothing here charges more than the subscription when an allowance runs out.
 */
@Injectable()
export class MembershipService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) {}

  /* ------------------------------------------------------------------
     The catalogue
     ------------------------------------------------------------------ */

  /**
   * Every tier with its live price, for the page somebody reads before joining.
   * Served publicly, like the price list.
   */
  async catalogue() {
    const tiers = await Promise.all(
      MEMBERSHIP_TIERS.map(async (t) => ({
        ...t,
        priceMinor: await this.feeFor(t).then((f) => f.amountMinor),
      })),
    );
    return { tiers, uncovered: UNCOVERED, cycleDays: CYCLE_DAYS, currency: 'USD' };
  }

  /** A tier's fee: the rule if there is one, the catalogue figure if not. */
  private async feeFor(tier: MembershipTier, tx?: Database) {
    const resolved = await this.pricing.tryPrice(tier.feeActionType, {}, tx);
    return {
      amountMinor: resolved?.amount.amount ?? tier.listPriceMinor,
      snapshot: resolved?.snapshot ?? { fallback: 'catalogue', tier: tier.key, listPriceMinor: tier.listPriceMinor },
      currency: resolved?.amount.currency ?? 'USD',
    };
  }

  /* ------------------------------------------------------------------
     Reading
     ------------------------------------------------------------------ */

  /** The account's membership and the cycle it is in, or null for a non-member. */
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

  /**
   * What a member has left this cycle, in the shape the wallet screen shows.
   *
   * Returns null for a non-member rather than a zeroed structure: "not a member"
   * and "a member with nothing left" read differently in the SPA.
   */
  async allowances(userId: string) {
    const state = await this.current(userId);
    if (!state) return null;
    const tier = membershipTier(state.membership.tier);
    if (!tier) return null;

    const consumed = (state.period?.consumed as Record<string, number>) ?? {};
    const live = this.isCycleLive(state.membership);

    return {
      tier: tier.key,
      status: state.membership.status,
      scheduledTier: state.membership.scheduledTier,
      /** What this cycle cost; the SPA uses it to show an upgrade's credit up front. */
      currentFeeMinor: state.period?.feeMinor ?? 0,
      cycleLive: live,
      currentPeriodStart: state.membership.currentPeriodStart,
      currentPeriodEnd: state.membership.currentPeriodEnd,
      cancelledAt: state.membership.cancelledAt,
      perCycle: Object.fromEntries(
        Object.keys(tier.perCycle).map((action) => [
          action,
          {
            allowed: tier.perCycle[action],
            used: consumed[action] ?? 0,
            remaining: live ? remaining(tier, action, consumed[action] ?? 0) : 0,
          },
        ]),
      ),
      storedItems: tier.storedItems,
      insuredShipments: {
        allowed: tier.insuredShipments,
        used: state.period?.insuredShipmentsUsed ?? 0,
        capMinor: tier.insuredValueCapMinor,
      },
      postage: {
        creditMinor: tier.postageCreditMinor,
        usedMinor: state.period?.postageUsedMinor ?? 0,
      },
      commission: {
        waivedOnMinor: tier.commissionWaivedOnMinor,
        usedMinor: state.period?.commissionWaivedOnMinor ?? 0,
      },
      perks: tier.perks,
    };
  }

  /** Whether the cycle on this membership is currently paid up and running. */
  private isCycleLive(m: typeof membership.$inferSelect, now = new Date()): boolean {
    if (m.status === 'ended') return false;
    return now >= m.currentPeriodStart && now < m.currentPeriodEnd;
  }

  /* ------------------------------------------------------------------
     Subscribing
     ------------------------------------------------------------------ */

  /**
   * Join a tier, or move to another one.
   *
   * The fee for the first cycle is charged here and now, so the allowance is
   * usable immediately.
   *
   * Moving tiers is not symmetrical:
   *
   *   - **Upgrade** takes effect at once and opens a new cycle, with the unused
   *     remainder of the old one credited against the first charge.
   *   - **Downgrade** is scheduled for the end of the cycle already paid for,
   *     because a subscription never takes away a bought allowance mid-cycle.
   */
  async subscribe(userId: string, tierKey: string) {
    if (!isTierKey(tierKey)) throw AppError.validation(`Unknown tier "${tierKey}"`);
    const tier = membershipTier(tierKey)!;

    return this.db.transaction(async (tx) => {
      // The membership row, then the wallet: the order the renewal job takes
      // them in. Taking the wallet first let a subscribe and a renewal of the
      // same member each hold one and wait for the other.
      const [existing] = await tx
        .select()
        .from(membership)
        .where(eq(membership.userId, userId))
        .for('update')
        .limit(1);
      await this.wallet.assertNotBlocked(userId, tx as Database);

      const now = new Date();
      const live = existing && existing.status !== 'ended' ? existing : null;

      if (live && live.tier === tierKey) {
        /**
         * The same tier again is never a purchase. Resuming a cancellation, or
         * dropping a scheduled downgrade, keeps the cycle already paid for.
         * Asking for the current tier with nothing pending is refused.
         */
        if (live.status === 'cancelling' || live.scheduledTier) {
          await tx
            .update(membership)
            .set({ status: 'active', cancelledAt: null, scheduledTier: null, updatedAt: now })
            .where(eq(membership.id, live.id));
          return {
            tier: tierKey,
            status: 'active' as const,
            effectiveFrom: now,
            currentPeriodEnd: live.currentPeriodEnd,
            chargedMinor: 0,
          };
        }
        throw new AppError(ErrorCode.CONFLICT, `Already on ${tier.key}`, 409);
      }

      if (live && tierRank(tierKey) < tierRank(live.tier)) {
        /**
         * A downgrade is scheduled and the membership stays `active`: the target
         * tier is stored on the row and renewal opens the next cycle on it.
         * Nothing already paid for is taken away today.
         */
        await tx
          .update(membership)
          .set({ scheduledTier: tierKey, status: 'active', cancelledAt: null, updatedAt: now })
          .where(eq(membership.id, live.id));
        return {
          tier: live.tier,
          status: 'active' as const,
          effectiveFrom: live.currentPeriodEnd,
          scheduledTier: tierKey,
          chargedMinor: 0,
        };
      }

      const listed = await this.feeFor(tier, tx as Database);

      /**
       * An upgrade credits what is left of the cycle already paid for: the
       * unused fraction of what was charged for the current cycle comes off the
       * first charge on the new one, so the overlap is never paid twice. The
       * snapshot records the list price, the credit and the previous tier.
       */
      let prorationCreditMinor = 0;
      if (live && this.isCycleLive(live, now)) {
        const [current] = await tx
          .select({ feeMinor: membershipPeriod.feeMinor })
          .from(membershipPeriod)
          .where(
            and(
              eq(membershipPeriod.membershipId, live.id),
              eq(membershipPeriod.periodStart, live.currentPeriodStart),
            ),
          )
          .limit(1);
        const cycleMs = live.currentPeriodEnd.getTime() - live.currentPeriodStart.getTime();
        const leftMs = live.currentPeriodEnd.getTime() - now.getTime();
        if (current && cycleMs > 0 && leftMs > 0) {
          prorationCreditMinor = Math.floor((current.feeMinor * leftMs) / cycleMs);
        }
      }
      const fee = {
        amountMinor: Math.max(0, listed.amountMinor - prorationCreditMinor),
        currency: listed.currency,
        snapshot: {
          ...listed.snapshot,
          listPriceMinor: listed.amountMinor,
          prorationCreditMinor,
          previousTier: live?.tier ?? null,
        },
      };

      const periodEnd = new Date(now.getTime() + CYCLE_MS);
      const row = live ?? existing;
      const id = row
        ? (await tx
            .update(membership)
            .set({
              tier: tierKey,
              status: 'active',
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              scheduledTier: null,
              cancelledAt: null,
              endedAt: null,
              updatedAt: now,
            })
            .where(eq(membership.id, row.id))
            .returning({ id: membership.id }))[0]!.id
        : (await tx
            .insert(membership)
            .values({
              userId,
              tier: tierKey,
              status: 'active',
              startedAt: now,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
            })
            .returning({ id: membership.id }))[0]!.id;

      await this.openPeriod(tx as Database, { id, userId }, tier, now, periodEnd, fee);
      return {
        tier: tierKey,
        status: 'active' as const,
        effectiveFrom: now,
        currentPeriodEnd: periodEnd,
        chargedMinor: fee.amountMinor,
        prorationCreditMinor,
      };
    });
  }

  /**
   * Open a cycle: write the period row, raise the charge, debit the ledger.
   *
   * The period row carries the tier and the fee that were in force, frozen, for
   * the same reason every charge carries its pricing snapshot.
   */
  private async openPeriod(
    tx: Database,
    m: { id: string; userId: string },
    tier: MembershipTier,
    start: Date,
    end: Date,
    fee: { amountMinor: number; snapshot: Record<string, unknown>; currency: string },
  ) {
    await tx.insert(membershipPeriod).values({
      membershipId: m.id,
      userId: m.userId,
      tier: tier.key,
      periodStart: start,
      periodEnd: end,
      feeMinor: fee.amountMinor,
      currency: fee.currency,
      pricingRuleSnapshot: fee.snapshot,
      consumed: {},
    });

    if (fee.amountMinor <= 0) return;

    const [c] = await tx
      .insert(charge)
      .values({
        userId: m.userId,
        actionType: tier.feeActionType,
        pricingRuleSnapshot: fee.snapshot,
        amount: fee.amountMinor,
        currency: fee.currency,
        paymentMeans: 'wallet',
        status: 'settled',
        referenceId: m.id,
      })
      .returning({ id: charge.id });
    if (!c) throw AppError.validation('Failed to create membership charge');

    await this.ledger.record(
      {
        userId: m.userId,
        type: 'service_charge',
        amount: fee.amountMinor,
        direction: 'debit',
        currency: fee.currency,
        referenceType: 'charge',
        referenceId: c.id,
      },
      tx,
    );
  }

  /**
   * Stop renewing.
   *
   * The cycle already paid for runs to its end with status `cancelling` and the
   * allowances intact. Stored items are untouched: storage over the old tier's
   * included count reverts to the published terms from the end of the cycle
   * forward, never retroactively, since each charge freezes its own rule.
   */
  async cancel(userId: string) {
    const [m] = await this.db.select().from(membership).where(eq(membership.userId, userId)).limit(1);
    if (!m || m.status === 'ended') throw AppError.notFound('No active membership');
    if (m.status === 'cancelling') return { status: 'cancelling' as const, endsAt: m.currentPeriodEnd };

    await this.db
      .update(membership)
      // A pending downgrade is moot once the member has asked to stop altogether.
      .set({ status: 'cancelling', cancelledAt: new Date(), scheduledTier: null, updatedAt: new Date() })
      .where(eq(membership.id, m.id));
    return { status: 'cancelling' as const, endsAt: m.currentPeriodEnd };
  }

  /* ------------------------------------------------------------------
     The allowance itself
     ------------------------------------------------------------------ */

  /**
   * Is one more of `action` included, and if so, spend it.
   *
   * Called from inside the caller's transaction, so the allowance is spent if
   * and only if the thing it covered actually happened.
   *
   * The counter is incremented with a SQL `jsonb_set` against the row rather
   * than read-modify-written in JavaScript, so two intakes committed
   * concurrently cannot both read `used: 3` and both write `4`.
   */
  async consume(tx: Database, userId: string, action: string): Promise<Entitlement> {
    const state = await this.current(userId, tx);
    if (!state) return { covered: false, remainingAfter: null, tier: null };

    const tier = membershipTier(state.membership.tier);
    if (!tier || !this.isCycleLive(state.membership)) {
      return { covered: false, remainingAfter: null, tier: state.membership.tier };
    }

    const consumed = (state.period?.consumed as Record<string, number>) ?? {};
    const used = consumed[action] ?? 0;
    if (!covers(tier, action, used)) {
      return { covered: false, remainingAfter: 0, tier: tier.key };
    }

    /**
     * Conditional, and checked. The WHERE clause re-tests the allowance, so two
     * actions committing at the same moment cannot both take the last one. No
     * row updated (also when the period row cannot be found) means not covered.
     */
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

  /**
   * Give back one counted allowance taken by `consume`, to the period it came
   * out of.
   *
   * For when the thing it covered does not happen after all, such as a cash-out
   * whose payout the provider refused. Never below zero; a period that has
   * already ended takes it back harmlessly, since nothing reads its counters.
   */
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

  /* ------------------------------------------------------------------
     Fees charged outside the billing port
     ------------------------------------------------------------------ */

  /**
   * How much of a fee this member's tier waives, spent in the same transaction
   * as the charge it reduces.
   *
   * Four fees never pass through `BillingService`: the marketplace commission
   * (a percentage, charged in the purchase), the escrow fee (frozen on the deal,
   * charged at settlement), the cash-out fee (charged at completion) and the
   * show-pickup fee (charged at booking). Each call site asks here at the moment
   * it charges.
   *
   * A waiver can only LOWER a fee the member was already shown, never raise one.
   * Each was quoted at its ordinary price before the member committed; if the
   * allowance was taken in the meantime, the answer is that ordinary fee.
   *
   *   marketplace_fee  value-based: waived on the first N of sale value a cycle,
   *                    proportionally when a sale straddles the limit.
   *   escrow_fee       one deal a cycle, in full up to the tier's value cap; the
   *                    fee on any excess is paid (`feeAt` computes it).
   *   cash_out_fee     counted.
   *   show_pickup      counted.
   */
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
    if (!state || !this.isCycleLive(state.membership)) return none;
    const tier = membershipTier(state.membership.tier);
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

  /* ------------------------------------------------------------------
     Shipping: insurance, postage, rush, trackers
     ------------------------------------------------------------------ */

  /**
   * What this member's tier can pay towards a parcel, if anything.
   *
   * Null for a non-member and for a lapsed cycle. This fails closed: no cover
   * means the ordinary price, shown first.
   */
  async shippingCover(userId: string, tx?: Database): Promise<ShippingCover | null> {
    const state = await this.current(userId, tx);
    if (!state || !this.isCycleLive(state.membership)) return null;
    const tier = membershipTier(state.membership.tier);
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
      rushIncluded: tier.perks.includes('rush_included'),
      addOnsLeft,
    };
  }

  /**
   * Spend the cover a parcel was priced with, inside the payment's transaction.
   *
   * The counters are incremented in ONE conditional UPDATE whose WHERE clause
   * re-checks the allowance, so two parcels paid at the same moment cannot both
   * take the last insured shipment. If the allowance has changed since the
   * member was shown the price (another parcel took it, the tier changed, the
   * cycle rolled over), this REFUSES rather than charging the difference: a
   * larger figure needs a fresh quote.
   */
  async spendShippingCover(tx: Database, userId: string, applied: AppliedShippingCover): Promise<AppliedShippingCover> {
    const stale = () =>
      new AppError(
        ErrorCode.CONFLICT,
        'Your membership allowance has changed since this parcel was priced. Choose the rate again to see the current price.',
        409,
      );
    const state = await this.current(userId, tx);
    const tier = state ? membershipTier(state.membership.tier) : undefined;
    if (!state || !tier || !this.isCycleLive(state.membership) || tier.key !== applied.tier) throw stale();
    if (applied.rushMinor > 0 && !tier.perks.includes('rush_included')) throw stale();

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
    // What was spent, and from which cycle. Stored on the shipment so a
    // cancellation can give it back (`returnShippingCover`).
    return { ...applied, spentInPeriodId: state.period?.id };
  }

  /**
   * Give back the cover a parcel spent, when the parcel is cancelled before any
   * label was bought.
   *
   * The counters are decremented in the period the cover was spent in, never
   * below zero. A cover with no `spentInPeriodId` (shipments paid before
   * migration 0031) goes back to the current cycle.
   */
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

  /* ------------------------------------------------------------------
     Renewal
     ------------------------------------------------------------------ */

  /**
   * Roll every membership whose cycle has run out. A `cancelling` membership
   * ends here rather than renewing.
   *
   * The scheduled renewal is the worker's own SQL job (`membership-renewal.ts`),
   * not this method. Unlike that job, this one does not claim rows or record
   * the cycle it renews.
   */
  async renewDue(now = new Date()) {
    const due = await this.db
      .select()
      .from(membership)
      .where(and(lte(membership.currentPeriodEnd, now), sql`${membership.status} <> 'ended'`));

    let renewed = 0;
    let ended = 0;

    for (const m of due) {
      // A scheduled downgrade takes effect HERE, at the start of the next cycle.
      const tier = membershipTier(m.scheduledTier ?? m.tier);
      if (!tier) continue;

      if (m.status === 'cancelling') {
        await this.db
          .update(membership)
          .set({ status: 'ended', endedAt: now, updatedAt: now })
          .where(eq(membership.id, m.id));
        ended += 1;
        continue;
      }

      await this.db.transaction(async (tx) => {
        const start = now;
        const end = new Date(now.getTime() + CYCLE_MS);
        const fee = await this.feeFor(tier, tx as Database);
        await tx
          .update(membership)
          .set({ tier: tier.key, scheduledTier: null, currentPeriodStart: start, currentPeriodEnd: end, updatedAt: now })
          .where(eq(membership.id, m.id));
        await this.openPeriod(tx as Database, { id: m.id, userId: m.userId }, tier, start, end, fee);
      });
      renewed += 1;
    }

    return { renewed, ended, considered: due.length };
  }
}
