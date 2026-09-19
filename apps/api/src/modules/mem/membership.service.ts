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
 * MEMBER does not pay; the gross amounts stay on the rate, because the premium
 * is still a real premium and the postage is still real postage — Bault pays
 * them either way.
 */
export interface AppliedShippingCover {
  tier: string;
  insuredShipment: boolean;
  insuranceMinor: number;
  postageMinor: number;
  rushMinor: number;
  addOns: Record<string, number>;
}

export interface Entitlement {
  /** True when the tier covers this action and the allowance is not spent. */
  covered: boolean;
  /** Remaining after this one, or `UNLIMITED`. Null when not a member. */
  remainingAfter: number | null;
  tier: string | null;
}

/**
 * Membership: subscribing, renewing, and answering "is this one included".
 *
 * The important method is the smallest one. `consume` is what every billable
 * action calls, and everything else in this file exists so that `consume` can
 * answer honestly and atomically:
 *
 *   - **Atomically**, because it runs inside the caller's transaction. An intake
 *     that consumes an allowance and then fails must not have consumed it, and a
 *     member pressing the same button twice must not get two for one.
 *   - **Honestly**, because it FAILS CLOSED. Outside a paid-up cycle, with no
 *     membership, or on an action the tier does not name, the answer is "not
 *     covered" — and not covered means the ordinary price, which the collector
 *     is shown and approves, exactly as a non-member does.
 *
 * There is no code path in this file that charges somebody more than their
 * subscription because they went over. That is the point: the allowance runs
 * out, and the thing simply costs what it has always cost, after they say yes.
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
   *
   * Public — the same reasoning that made the price list public. Somebody
   * deciding whether to subscribe has to be able to read what it costs and what
   * it covers without an account, and putting either behind a session makes them
   * unreadable to exactly the person deciding.
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
   * Returns null for a non-member rather than a zeroed structure — "you are not
   * a member" and "you are a member with nothing left" are different sentences
   * and the SPA says different things about them.
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
      /** What this cycle cost — the SPA needs it to show an upgrade's credit up front. */
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
   * The fee for the first cycle is charged here and now, which is what makes the
   * allowance real immediately — a member who paid two minutes ago and is told
   * their intake is not covered yet has been sold a promise, not a service.
   *
   * MOVING TIERS is an upgrade or a downgrade and they are not symmetrical:
   *
   *   - **Upgrade** takes effect at once and opens a new cycle, with the unused
   *     remainder of the old one credited against the first charge. The member
   *     asked for more and is paying for more from today — not twice for today.
   *   - **Downgrade** is scheduled, not immediate. It takes effect at the end of
   *     the cycle they have already paid for, because taking away an allowance
   *     somebody has bought — and may have already planned around — is the one
   *     thing a subscription must never do mid-month.
   */
  async subscribe(userId: string, tierKey: string) {
    if (!isTierKey(tierKey)) throw AppError.validation(`Unknown tier "${tierKey}"`);
    const tier = membershipTier(tierKey)!;

    return this.db.transaction(async (tx) => {
      await this.wallet.assertNotBlocked(userId, tx as Database);

      const [existing] = await tx
        .select()
        .from(membership)
        .where(eq(membership.userId, userId))
        .for('update')
        .limit(1);

      const now = new Date();
      const live = existing && existing.status !== 'ended' ? existing : null;

      if (live && live.tier === tierKey) {
        /**
         * The same tier again. Three different requests, and none of them is a
         * purchase.
         *
         * This used to fall through to the paid path whenever the membership was
         * `cancelling` — so somebody who cancelled on the 2nd and changed their
         * mind on the 3rd was charged a whole new cycle for the one they had
         * already paid for. Now resuming a cancellation, or dropping a scheduled
         * downgrade, simply keeps what is paid for. Only asking for the tier you
         * are already on, with nothing pending, is refused.
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
         * A downgrade is SCHEDULED, and it stays a membership.
         *
         * It used to set `cancelling` and hand the target tier back to the caller
         * without storing it anywhere — so at the end of the cycle the renewal
         * saw `cancelling` and ENDED the membership. Somebody who asked to pay
         * less next month was not a member next month. The target now lives on
         * the row, the status stays `active`, and renewal opens the next cycle
         * on the cheaper tier. Nothing already paid for is taken away today.
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
       * An upgrade credits what is left of the cycle already paid for.
       *
       * It used to charge the new tier in full and throw the rest of the old one
       * away, so upgrading on day 29 of 30 cost the same as upgrading on day 1 —
       * the member paid twice for the overlap. The unused fraction of what was
       * actually charged for the current cycle comes off the first charge on the
       * new one. The snapshot records the list price, the credit and the tier it
       * came from, so the net figure can be explained later.
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
   * the same reason every charge carries its pricing snapshot — a member asking
   * what they got for July's money is asking about July's terms.
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
   * The cycle already paid for runs to its end — status `cancelling`, allowances
   * intact. Nothing happens to a single stored item, then or ever: storage for
   * anything over the old tier's included count simply reverts to the published
   * terms from the end of the cycle FORWARD, never retroactively. The platform
   * already guarantees the "never retroactively" half, because the rule in force
   * at the moment of a charge is frozen onto that charge.
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
   * than read-modify-written in JavaScript. Two intakes committed concurrently
   * would otherwise both read `used: 3`, both write `4`, and the member would
   * get a free one — the same lost-update that a wallet balance derived from a
   * stored number would have, and avoided the same way.
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
     * Conditional, and CHECKED.
     *
     * The WHERE clause re-tests the allowance, so two actions committing at the
     * same moment cannot both take the last one. And the row count is checked:
     * this UPDATE used to be fire-and-forget, so when the period row could not
     * be found (a renewal that wrote its start at a different precision did
     * exactly that) nothing was recorded and the answer was still "covered" —
     * an allowance that never ran out. No row updated now means not covered.
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
    return { covered: true, remainingAfter: left === UNLIMITED ? UNLIMITED : left, tier: tier.key };
  }

  /* ------------------------------------------------------------------
     Fees charged outside the billing port
     ------------------------------------------------------------------ */

  /**
   * How much of a fee this member's tier waives, spent in the same transaction
   * as the charge it reduces.
   *
   * Four fees never pass through `BillingService` — the marketplace commission
   * (a percentage, charged in the purchase), the escrow fee (frozen on the deal,
   * charged at settlement), the cash-out fee (charged at completion) and the
   * show-pickup fee (charged at booking). Each call site asks here at the moment
   * it charges.
   *
   * THE RULE: a waiver can only LOWER a fee the member was already shown, never
   * raise one. Every one of these was quoted at its ordinary price before the
   * member committed, so applying the waiver at the charge is safe in one
   * direction only — and if the allowance was taken by something else in the
   * meantime, the answer is simply the ordinary fee they already agreed to.
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
  ): Promise<{ waivedMinor: number; tier: string | null; waivedOnMinor?: number }> {
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
    if (action === 'escrow_fee' && tier.escrowValueCapMinor > 0 && valueMinor > tier.escrowValueCapMinor && feeAt) {
      return { waivedMinor: Math.min(feeMinor, feeAt(tier.escrowValueCapMinor)), tier: tier.key };
    }
    return { waivedMinor: feeMinor, tier: tier.key };
  }

  /* ------------------------------------------------------------------
     Shipping: insurance, postage, rush, trackers
     ------------------------------------------------------------------ */

  /**
   * What this member's tier can pay towards a parcel, if anything.
   *
   * Null for a non-member and for a lapsed cycle — failing closed, like
   * everything else here: no cover means the ordinary price, shown first.
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
   * re-checks the allowance — so two parcels paid at the same moment cannot
   * both take the last insured shipment. If the allowance has changed since the
   * member was shown the price (another parcel took it, the tier changed, the
   * cycle rolled over), this REFUSES rather than charging the difference. The
   * member agreed to a figure; a larger one needs a new agreement, which is a
   * fresh quote.
   */
  async spendShippingCover(tx: Database, userId: string, applied: AppliedShippingCover): Promise<void> {
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
  }

  /* ------------------------------------------------------------------
     Renewal
     ------------------------------------------------------------------ */

  /**
   * Roll every membership whose cycle has run out. Driven by the worker.
   *
   * A `cancelling` membership ends here rather than renewing — which is the only
   * place a membership actually stops, so the end of a subscription is a dated
   * event with a row behind it rather than an absence.
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
