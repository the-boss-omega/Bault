import { GRADING_TIERS, tierFeeAction } from '../dis/grading-tiers';
import { CONSIGNMENT_CHANNELS, channelFeeAction } from '../dis/consignment-channels';
import { SHIPMENT_ADD_ONS, addOnFeeAction } from '../shp/shipping-options';
import { PICKUP_FEE_ACTION, whiteGloveFeeAction } from '../shp/fulfilment';
import { MEMBERSHIP_TIERS } from '../mem/tiers';
import { ESCROW_FEE_ACTION } from '../esc/escrow-terms';
import { CASHOUT_FEE_ACTION, CHARGEBACK_FEE_ACTION } from '../pay/money-terms';

/**
 * Every price the code charges, and what happens when its rule is missing.
 *
 * No migration inserts a `pricing_rule`. The seed does, so every development
 * database is fully priced, and a production database built by migration
 * alone is not. What an absent rule DOES depends on where the price is read,
 * and that varies more than anybody would guess from the outside:
 *
 *   required          `PricingService.price` throws, so the action itself
 *                     fails — the first intake on an unpriced database is a 400.
 *   fallback_rule     the code TRIES a narrower rule and falls back to a broader
 *                     one: an unpriced grading tier costs the flat service fee.
 *   code_default      the code falls back to a figure written in the source,
 *                     so the price exists but cannot be changed without a deploy.
 *   free_if_unpriced  the code falls back to ZERO. Rush packing and show pickup
 *                     cost nothing at all without a rule.
 *   code_constant     the amount charged is a constant in the source and no rule
 *                     is consulted when charging. A rule may exist so the price
 *                     list can show it — editing that rule changes what is
 *                     PUBLISHED and not what is CHARGED.
 *
 * The launch procedure has to be able to see all five, action by action, before
 * the first customer is billed. `GET /admin/pricing/coverage` reads this list
 * against the rules in force.
 *
 * The families are DERIVED from the catalogues the charging code itself reads —
 * grading tiers, consignment channels, add-ons, membership tiers — so adding a
 * tier lists its price here without anybody remembering to. The literals are
 * the ones the services pass to `price`/`tryPrice`/`BillingService.charge`, and
 * `tests3/contract/pricing-coverage.test.ts` scans the source for any it does
 * not find here.
 *
 * Pure data: it talks to nothing, so it is testable without a database.
 */

export type PriceResolution =
  | 'required'
  | 'fallback_rule'
  | 'code_default'
  | 'free_if_unpriced'
  | 'code_constant';

export interface BillableAction {
  /** The `pricing_rule.action_type` read, or a descriptive key for a code constant. */
  actionType: string;
  resolution: PriceResolution;
  /** For `fallback_rule`: the broader action whose rule is used instead. */
  fallsBackTo: string | null;
  /** Where it is charged — so a reviewer can go and read it. */
  chargedBy: string;
  description: string;
}

const action = (
  actionType: string,
  resolution: PriceResolution,
  chargedBy: string,
  description: string,
  fallsBackTo: string | null = null,
): BillableAction => ({ actionType, resolution, fallsBackTo, chargedBy, description });

export function billableActions(): BillableAction[] {
  return [
    /* ---- intake ---- */
    action('intake', 'required', 'inv/intake.service.ts, inv/batch.service.ts', 'Booking an item into the vault. Per-class rules win over the catch-all.'),
    action('intake_lot', 'fallback_rule', 'inv/intake.service.ts', 'Booking a lot as one item.', 'intake'),
    action('parcel_processing', 'required', 'inv/parcel.service.ts', 'Receiving, opening and cataloguing a parcel.'),
    action('parcel_forwarding', 'required', 'inv/parcel.service.ts', 'Forwarding a parcel from a receiving-only address.'),

    /* ---- storage ---- */
    action('storage', 'required', 'worker jobs/storage-fee.ts, adm/adm.service.ts', 'Storage after the included period. Without it the daily sweep bills nothing.'),
    action('storage_oversized', 'fallback_rule', 'worker jobs/storage-fee.ts', 'Storage terms for oversized items.', 'storage'),

    /* ---- services ---- */
    action('service', 'required', 'dis/service.service.ts, mkt/trade.service.ts', 'The flat fee for a service request, and each side of a swap.'),
    ...['video_review', 'condition_inspection', 'deslab'].map((key) =>
      action(`service_fee:${key}`, 'fallback_rule', 'dis/media.service.ts, dis/disposal-services.service.ts', `The ${key.replace('_', ' ')} service.`, 'service'),
    ),
    ...GRADING_TIERS.map((tier) =>
      action(tierFeeAction(tier.key), 'fallback_rule', 'dis/grading.service.ts', `Grading at the ${tier.key} tier.`, 'service'),
    ),

    /* ---- selling ---- */
    action('marketplace_fee', 'required', 'mkt/purchase.service.ts, dis/consignment.service.ts', 'Commission on a marketplace sale, charged to the seller.'),
    ...CONSIGNMENT_CHANNELS.map((channel) =>
      action(channelFeeAction(channel.key), 'fallback_rule', 'dis/consignment.service.ts', `Bault's commission on a ${channel.key} consignment sale.`, 'marketplace_fee'),
    ),
    action(ESCROW_FEE_ACTION, 'code_constant', 'esc/escrow.service.ts (escrow-terms.ts)', 'Escrow fee. Charged from ESCROW_FEE_BPS and its minimum; a rule is only reported on the published terms.'),

    /* ---- shipping ---- */
    action('shipping', 'required', 'shp/shipment.service.ts', 'Handling added on top of the carrier rate. Every carrier quote needs it.'),
    action('shipping_rush', 'free_if_unpriced', 'shp/shipment.service.ts', 'Same-day picking and packing.'),
    ...SHIPMENT_ADD_ONS.map((addOn) =>
      action(addOnFeeAction(addOn.key), 'code_default', 'shp/shipment.service.ts (shipping-options.ts)', `${addOn.label}. Falls back to the catalogue price.`),
    ),
    action(PICKUP_FEE_ACTION, 'free_if_unpriced', 'shp/human-fulfilment.service.ts', 'Collecting at a show. A show with its own fee overrides this.'),
    ...(['domestic', 'international'] as const).map((scope) =>
      action(whiteGloveFeeAction(scope), 'code_default', 'shp/human-fulfilment.service.ts (fulfilment.ts)', `The published white-glove base, ${scope}. The charge itself is the quote an operator writes.`),
    ),
    action('shipping_restocking_fee', 'code_constant', 'shp/shipment-edit.service.ts (RESTOCKING_FEE_MINOR)', 'Cancelling a shipment after its service was paid for.'),
    action('shipping_insurance_premium', 'code_constant', 'shp/shipping-options.ts (INSURANCE_PREMIUM_BPS)', 'Insurance premium on an outbound parcel.'),
    action('direct_ship_flat', 'code_constant', 'shp/carriers.ts (flatCostMinor)', 'Shipping straight from a receiving-only address.'),

    /* ---- memberships ---- */
    ...MEMBERSHIP_TIERS.map((tier) =>
      action(tier.feeActionType, 'required', 'mem/membership.service.ts, worker jobs/membership-renewal.ts', `The ${tier.key} membership. Joining falls back to the catalogue price, but renewal refuses without a rule and the member lapses.`),
    ),

    /* ---- money ---- */
    action(CASHOUT_FEE_ACTION, 'code_constant', 'pay/wallet-request.service.ts (money-terms.ts)', 'Cash-out fee. Charged from the schedule in money-terms.ts; a rule is only shown on the price list.'),
    action(CHARGEBACK_FEE_ACTION, 'code_constant', 'pay/chargeback.service.ts (CHARGEBACK_FEE_MINOR)', 'Handling fee on a reversed payment; a rule is only shown on the price list.'),
    action('interest', 'code_constant', 'worker jobs/interest-accrual.ts (WALLET_DEBT_INTEREST_BPS)', 'Daily interest on a negative balance past the grace period. Set by environment, not by a rule.'),
  ];
}

/* ============================================================
   Coverage: the catalogue read against the rules in force
   ============================================================ */

export interface RuleInForce {
  id: string;
  actionType: string;
  itemClass: string | null;
  model: string;
  value: number;
  currency: string;
  effectiveFrom: Date | string;
}

export type CoverageStatus = 'priced' | 'missing' | 'falls_back' | 'code_default' | 'free' | 'code_constant';

export interface CoverageRow extends BillableAction {
  status: CoverageStatus;
  /** The catch-all rule in force for this action, when there is one. */
  rule: Pick<RuleInForce, 'id' | 'model' | 'value' | 'currency' | 'effectiveFrom'> | null;
  /** How many class-specific rules are in force beside it. */
  classRules: number;
}

/**
 * What each billable action costs right now — or what it falls back to.
 *
 * `rules` are the rules IN FORCE (effective now, not yet superseded). A
 * class-specific rule alone does not price an action: an item of any other
 * class still needs the catch-all, and its absence is what makes `price` throw.
 *
 * `ready` is the launch gate: every action whose price comes from a rule has
 * its own rule. A fallback that happens to work is still not ready — "grading
 * costs the flat service fee because nobody loaded the tier" is a price
 * somebody has to have chosen.
 */
export function coverage(catalogue: BillableAction[], rules: RuleInForce[]) {
  const catchAll = new Map<string, RuleInForce>();
  const classCount = new Map<string, number>();
  // Newest first, so the first catch-all seen is the one `price` would use.
  const sorted = [...rules].sort((a, b) => Date.parse(String(b.effectiveFrom)) - Date.parse(String(a.effectiveFrom)));
  for (const r of sorted) {
    if (r.itemClass) classCount.set(r.actionType, (classCount.get(r.actionType) ?? 0) + 1);
    else if (!catchAll.has(r.actionType)) catchAll.set(r.actionType, r);
  }

  const actions: CoverageRow[] = catalogue.map((a) => {
    const own = catchAll.get(a.actionType) ?? null;
    let status: CoverageStatus;
    if (a.resolution === 'code_constant') status = 'code_constant';
    else if (own) status = 'priced';
    else if (a.resolution === 'fallback_rule') status = a.fallsBackTo && catchAll.has(a.fallsBackTo) ? 'falls_back' : 'missing';
    else if (a.resolution === 'code_default') status = 'code_default';
    else if (a.resolution === 'free_if_unpriced') status = 'free';
    else status = 'missing';
    return {
      ...a,
      status,
      rule: own
        ? { id: own.id, model: own.model, value: own.value, currency: own.currency, effectiveFrom: own.effectiveFrom }
        : null,
      classRules: classCount.get(a.actionType) ?? 0,
    };
  });

  const known = new Set(catalogue.map((a) => a.actionType));
  // A rule the code never reads is usually a typo — and a typo in an action
  // type is a price that was loaded and will never be charged.
  const unknownRules = sorted
    .filter((r) => !known.has(r.actionType))
    .map((r) => ({ id: r.id, actionType: r.actionType, itemClass: r.itemClass }));

  const count = (s: CoverageStatus) => actions.filter((a) => a.status === s).length;
  const summary = {
    total: actions.length,
    priced: count('priced'),
    missing: count('missing'),
    fallingBack: count('falls_back'),
    codeDefault: count('code_default'),
    free: count('free'),
    codeConstant: count('code_constant'),
  };
  return {
    ready: actions.every((a) => a.status === 'priced' || a.status === 'code_constant'),
    summary,
    actions,
    unknownRules,
  };
}
