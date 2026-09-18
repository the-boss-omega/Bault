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
   *   - **Upgrade** takes effect at once and opens a new cycle, charged in full.
   *     The member asked for more and is paying for more from today.
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

      if (existing && existing.status !== 'ended') {
        if (existing.tier === tierKey && existing.status === 'active') {
          throw new AppError(ErrorCode.CONFLICT, `Already on ${tier.key}`, 409);
        }
        if (tierRank(tierKey) < tierRank(existing.tier)) {
          // A downgrade is a scheduled change, not a charge. Nothing moves today.
          await tx
            .update(membership)
            .set({ status: 'cancelling', cancelledAt: new Date(), updatedAt: new Date() })
            .where(eq(membership.id, existing.id));
          return {
            tier: existing.tier,
            status: 'cancelling' as const,
            effectiveFrom: existing.currentPeriodEnd,
            scheduledTier: tierKey,
            chargedMinor: 0,
          };
        }
      }

      const fee = await this.feeFor(tier, tx as Database);
      const now = new Date();
      const periodEnd = new Date(now.getTime() + CYCLE_MS);

      const id = existing
        ? (await tx
            .update(membership)
            .set({
              tier: tierKey,
              status: 'active',
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              cancelledAt: null,
              endedAt: null,
              updatedAt: now,
            })
            .where(eq(membership.id, existing.id))
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
      .set({ status: 'cancelling', cancelledAt: new Date(), updatedAt: new Date() })
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

    await tx
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
        ),
      );

    const left = remaining(tier, action, used + 1);
    return { covered: true, remainingAfter: left === UNLIMITED ? UNLIMITED : left, tier: tier.key };
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
      const tier = membershipTier(m.tier);
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
          .set({ currentPeriodStart: start, currentPeriodEnd: end, updatedAt: now })
          .where(eq(membership.id, m.id));
        await this.openPeriod(tx as Database, { id: m.id, userId: m.userId }, tier, start, end, fee);
      });
      renewed += 1;
    }

    return { renewed, ended, considered: due.length };
  }
}
