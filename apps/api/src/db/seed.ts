import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { userAccount } from '../modules/acc/acc.schema';
import { item, bin, itemImage, custodyEvent, itemChangeHistory, binTransfer, batch } from '../modules/cst/cst.schema';
import { listing, transaction, offer, swapProposal } from '../modules/mkt/mkt.schema';
import {
  ledgerRecord,
  externalPayment,
  charge,
  withdrawal,
  walletRequest,
  walletRequestEvent,
} from '../modules/pay/pay.schema';
import { pricingRule } from '../modules/prc/prc.schema';
import { serviceRequest } from '../modules/dis/dis.schema';
import { shipment } from '../modules/shp/shp.schema';
import { dispute } from '../modules/adm/adm.schema';
import { auditRecord } from '../modules/sec/audit.schema';
import { outboxMessage } from '../modules/not/outbox/outbox.schema';
import { notification, notificationPreference } from '../modules/not/notification.schema';
import { shippingAddress } from '../modules/acc/address.schema';
import { facility } from '../modules/inv/facility.schema';
import { consignmentEvent } from '../modules/dis/consignment-event.schema';
import { ID_PREFIX, prefixedId } from '../shared/ids';
import { makeBinBarcode, makeBinSerial } from '../modules/inv/labels';

/**
 * Seed script — realistic, internally-consistent sample data (dev only).
 *
 * RESET: TRUNCATE clears every table, INCLUDING the append-only history tables,
 * and the background job queue with them. The append-only guards
 * (0001_append_only.sql) block UPDATE/DELETE via per-ROW triggers, which do NOT
 * fire on TRUNCATE — so a full reset is possible here but remains impossible
 * through the running application. This is a deliberate, dev-only escape hatch;
 * never TRUNCATE in production.
 *
 * The reset is what makes this script the answer to a database full of test
 * residue. The e2e suites drive the real HTTP stack against a real database, so
 * every intake they perform creates a real item, with a real custody trail, in a
 * real collector's vault — 112 of them after one full run — and none of it can
 * be deleted afterwards through any supported path, because an item is never
 * deleted (Principle I) and its trail is append-only. Re-seeding is the only
 * way back to the catalogue, which is why `pnpm test` now ends by running it.
 *
 * The dataset below is consistent by construction: every item has an intake
 * custody event + transfer-ledger row + image + intake charge; ownership changes
 * (sale/donation) carry matching custody events, transaction records and ledger
 * rows; wallet balances are the exact sum of the ledger rows written here.
 *
 * Conventions the seed upholds:
 *  - Every amount is USD in cents (Requirement 7.1) — no shekels/agorot anywhere.
 *  - Owner IDs are OW-, item labels BC-, lots LOT-, bins BIN-, shipments SHP-,
 *    service requests SR-, disputes DSP-, transactions TXN- (Requirement 9).
 *  - Every pricing rule states its description, value, scope and billing trigger
 *    (Requirement 14.1).
 */

/** Narrow a single-row RETURNING result (needed under noUncheckedIndexedAccess). */
function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error('insert returned no row');
  return r;
}

async function main(): Promise<void> {
  const { db, pool } = createDb();
  /** The platform's single settlement currency (Requirement 7.1). */
  const CUR = 'USD';

  // Every seeded person has this password.
  const pw = await argon2.hash('11111111');

  // -------------------------------------------------------------------------
  // 1. RESET — wipe all app data (see header). TRUNCATE bypasses row triggers.
  // -------------------------------------------------------------------------
  await pool.query(`TRUNCATE TABLE
    user_account, verification_token, login_session,
    item, bin, item_image, custody_event, item_change_history, bin_transfer, batch,
    listing, "transaction", offer, swap_proposal,
    ledger_record, external_payment, charge, withdrawal,
    wallet_request, wallet_request_event,
    pricing_rule, service_request, shipment,
    outbox_message, audit_record, idempotency_key, confirmation_token,
    notification, notification_preference, dispute,
    storage_fee_run, shipping_address,
    facility, parcel, parcel_event, arrival_disposal,
    support_ticket, support_message,
    consignment_event, grading_submission, shipment_group,
    escrow_deal, escrow_event
    RESTART IDENTITY`);

  /**
   * The background job queue is app data too, and the reset was leaving it
   * behind.
   *
   * pg-boss keeps its own schema, so nothing above touches it, and after a test
   * run it held a hundred and fifty rows of history for work done on rows that
   * no longer exist. Worse than untidy: the outbox dispatcher's queued jobs
   * would wake up against a table that had just been truncated underneath them.
   *
   * Only the two HISTORY tables are cleared. `queue`, `schedule`, `subscription`
   * and `version` are pg-boss's own configuration and its schema version —
   * emptying those would leave the worker unable to start. `job` is partitioned
   * one table per queue, and TRUNCATE on the parent empties every partition
   * while keeping the partitions themselves.
   *
   * Guarded on the schema existing at all, because a checkout that has never run
   * the worker has no pgboss schema and a seed must not fail on that.
   */
  await pool.query(`DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss') THEN
        TRUNCATE TABLE pgboss.job, pgboss.archive;
      END IF;
    END $$;`);

  // -------------------------------------------------------------------------
  // 2. USERS — delete-all is handled by the TRUNCATE above. Password: 11111111.
  //    Roles: manager Eldar (admin), garage worker Hermon (warehouse_operator),
  //    collectors Red & Golden (user), plus the platform custodian (system).
  //    `username` is set HERE and never again — it is immutable (Requirement 4.1).
  // -------------------------------------------------------------------------
  /**
   * `username` is the customer-facing identifier and is set HERE and never again
   * — the DB trigger from 0004 rejects any later UPDATE of the column.
   *
   * No `intakeId` is minted. The OW- code is retired: new accounts do not get
   * one, and nothing in the product asks for one. Exactly one seeded account
   * (`legacy`, below) carries an intake ID, so the pre-printed-label fallback in
   * `IntakeService.resolveOwner` has something real to exercise.
   */
  const mkUser = async (
    email: string,
    username: string,
    role: 'user' | 'warehouse_operator' | 'admin',
    firstName: string,
    /** Null only for a flagged legacy row whose boundary was never resolved. */
    lastName: string | null,
    legacy?: { intakeId?: string; nameReviewRequired?: boolean; legacyDisplayName?: string },
  ) =>
    one(
      await db
        .insert(userAccount)
        .values({
          email,
          username,
          passwordHash: pw,
          status: 'active',
          role,
          // Two explicit name parts — there is no display-name column to seed.
          firstName,
          lastName,
          intakeId: legacy?.intakeId ?? null,
          nameReviewRequired: legacy?.nameReviewRequired ?? false,
          legacyDisplayName: legacy?.legacyDisplayName ?? null,
        })
        .returning({ id: userAccount.id, username: userAccount.username }),
    );

  const eldarAcc = await mkUser('eldar@bault.dev', 'eldar', 'admin', 'Eldar', 'Cohen');
  const hermonAcc = await mkUser('hermon@bault.dev', 'hermon', 'warehouse_operator', 'Hermon', 'Levi');
  const redAcc = await mkUser('red@bault.dev', 'red', 'user', 'Red', 'Ashwood');
  const goldenAcc = await mkUser('golden@bault.dev', 'golden', 'user', 'Golden', 'Marsh');
  // A pre-identity-pass account, reproduced exactly as migration 0004 would leave
  // one whose single display name could not be split without guessing: the whole
  // string became the first name, the original is kept read-only, the row is
  // flagged for review, and the OW- code it was routed by still works.
  const veteranAcc = await mkUser(
    'veteran@bault.dev',
    'veteran',
    'user',
    'Ana Maria van der Berg',
    null,
    {
      intakeId: prefixedId(ID_PREFIX.owner, 6),
      nameReviewRequired: true,
      legacyDisplayName: 'Ana Maria van der Berg',
    },
  );
  // Custodian that receives donated/consigned items (keeps single-owner-never-deleted
  // true once a donation is accepted). It owns nothing in this dataset — the seeded
  // donation request is still open — but the account must exist for that flow to run.
  await mkUser('platform@bault.dev', 'platform', 'admin', 'Platform', 'Custodian');

  const eldar = eldarAcc.id;
  const hermon = hermonAcc.id;
  const red = redAcc.id;
  const golden = goldenAcc.id;
  const veteran = veteranAcc.id;

  // -------------------------------------------------------------------------
  // 3. PRICING RULES. Each rule states WHAT it is (description), HOW MUCH
  //    (value: cents for fixed, basis points for percentage), its SCOPE
  //    (actionType + itemClass) and WHEN it bills (Requirement 14.1).
  // -------------------------------------------------------------------------
  const rules = [
    {
      actionType: 'intake',
      model: 'fixed' as const,
      value: 500, // $5.00
      description: 'Intake handling fee per received item',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Storage is an INCLUDED period folded into the intake fee, then periods
       * priced as a proportion of that same intake fee. `value` is only the
       * fallback base for an item that has no intake charge to take a percentage
       * of; the real terms are in `parameters`, which the worker's sweep reads.
       */
      actionType: 'storage',
      model: 'fixed' as const,
      value: 100, // $1.00 — fallback base only
      description: '180 days included, then 10% of the item intake fee every 90 days',
      billingTrigger: 'daily' as const,
      parameters: { freeDays: 180, periodDays: 90, percentOfIntakeBps: 1_000 },
    },
    {
      /**
       * Oversized items get a much shorter included window and pay the whole
       * intake fee again each period. Deliberately punitive: shelf space is the
       * scarce resource, and this exists to make "leave it there forever" a
       * decision rather than a default.
       */
      actionType: 'storage_oversized',
      model: 'fixed' as const,
      value: 500, // $5.00 — fallback base only
      description: '90 days included, then the full intake fee again every 90 days',
      billingTrigger: 'daily' as const,
      parameters: { freeDays: 90, periodDays: 90, percentOfIntakeBps: 10_000 },
    },
    {
      actionType: 'service',
      model: 'fixed' as const,
      value: 2000, // $20.00
      description: 'Flat fee for a value-added service request',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'shipping',
      model: 'fixed' as const,
      value: 0,
      description: 'Handling surcharge added on top of the carrier rate',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'marketplace_fee',
      model: 'percentage' as const,
      value: 500, // 5.00%
      description: 'Marketplace commission charged to the seller on every sale',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Bault's own cut per consignment channel. The partner's commission is
       * deducted by the partner before they remit and never touches this ledger,
       * so these are only ever Bault's share.
       */
      actionType: 'consignment_fee:card_show',
      model: 'percentage' as const,
      value: 1000, // 10.00% — Bault sells it at the table itself
      description: 'Bault commission on a card-show consignment sale',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'consignment_fee:auction_house',
      model: 'percentage' as const,
      value: 100, // 1.00% on top of the auction house's own rate
      description: 'Bault commission on an auction-house consignment sale',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'consignment_fee:ebay_partner',
      model: 'percentage' as const,
      value: 100, // 1.00% on top of the partner seller's own rate
      description: 'Bault commission on an eBay partner consignment sale',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Grading is priced per TIER, not per card, because a grader is not
       * selling a grade — it is selling a turnaround and a declared-value band.
       * A five-day return on a $5,000 card and a six-week return on a common are
       * different work and cannot share one fee.
       *
       * These sit alongside the flat `service` rule rather than replacing it:
       * `feeActionType` is TRIED, so a tier added to the catalogue without a
       * price here falls back to $20 (expensive-by-default) instead of being
       * silently free.
       */
      actionType: 'grading_fee:psa_value',
      model: 'fixed' as const,
      value: 2500, // $25.00
      description: 'PSA Value — up to $499, 45–65 days',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:psa_regular',
      model: 'fixed' as const,
      value: 7500, // $75.00
      description: 'PSA Regular — up to $1,499, 20–30 days',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:psa_express',
      model: 'fixed' as const,
      value: 15000, // $150.00
      description: 'PSA Express — up to $4,999, 10–15 days',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:psa_walkthrough',
      model: 'fixed' as const,
      value: 30000, // $300.00
      description: 'PSA Walkthrough — no ceiling, 5–10 days, needs approval',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:bgs_standard',
      model: 'fixed' as const,
      value: 6500, // $65.00
      description: 'BGS Standard — up to $1,499, 25–40 days',
      billingTrigger: 'per_event' as const,
    },
    {
      /** Turning the card under a light on camera — the only way to show gloss. */
      actionType: 'service_fee:video_review',
      model: 'fixed' as const,
      value: 1000, // $10.00
      description: 'A short video of the card turned under a light',
      billingTrigger: 'per_event' as const,
    },
    {
      /** A person looking at named areas and writing down what they see. */
      actionType: 'service_fee:condition_inspection',
      model: 'fixed' as const,
      value: 1500, // $15.00
      description: 'Per-area condition report against a fixed severity scale',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Cheaper than the flat service fee on purpose: cracking a slab is thirty
       * seconds of work, and pricing it like a photo shoot would only push people
       * to do it themselves badly after the card was shipped home.
       */
      actionType: 'service_fee:deslab',
      model: 'fixed' as const,
      value: 500, // $5.00
      description: 'Cracking a graded card out of its holder. Irreversible.',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Rush is BAULT moving the parcel to the front of the packing queue. It
       * used to be handed to the carrier, which doubled the carrier rate and
       * shortened the carrier estimate — attributing Bault's own speed to FedEx.
       */
      actionType: 'shipping_rush',
      model: 'fixed' as const,
      value: 1000, // $10.00
      description: 'Same-day picking and packing, ahead of the standard queue',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * A tracker in the outgoing parcel. Priced as a rule rather than only in
       * the add-on catalogue so it can be changed without a deploy (Principle
       * VI); the catalogue figure is the fallback if the rule is ever removed.
       */
      actionType: 'shipping_addon:gps_tracker',
      model: 'fixed' as const,
      value: 3000, // $30.00
      description: 'GPS tracker placed in the parcel; handed over after delivery',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Cashing out. Two bands with a kink at $100: below it a percentage with
       * a floor, because the provider's own minimum dominates a small payout;
       * above it a fixed component plus a much smaller percentage, because the
       * work does not scale with the amount.
       *
       * The rule records the LARGE band's percentage; the full schedule lives
       * in `money-terms.ts`, which is what both the quote and the charge use.
       */
      actionType: 'cash_out_fee',
      model: 'percentage' as const,
      value: 100, // 1.00% over $100, plus $5.00 fixed
      description: 'Cash-out fee: 6% (min $0.99) under $100, otherwise $5.00 + 1%',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * What the provider charges Bault to handle a disputed card payment,
       * regardless of who wins it. Charged to the account that received the
       * money, because that is the only account it could be.
       */
      actionType: 'chargeback_fee',
      model: 'fixed' as const,
      value: 2500, // $25.00
      description: 'Handling fee when a card payment into your wallet is reversed',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Escrow. A percentage, because the work scales with what is at stake:
       * inspecting a $500 card and a $50,000 one are not the same look.
       */
      actionType: 'escrow_fee',
      model: 'percentage' as const,
      value: 100, // 1.00%
      description: 'Middleman fee on a private deal, 1% of the agreed value',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * White glove. This is the BASE — travel is quoted on top, per journey,
       * because the cost of getting a person from New Jersey to a hotel in
       * Boston on a Tuesday is not something a rate table knows.
       */
      actionType: 'white_glove:domestic',
      model: 'fixed' as const,
      value: 100000, // $1,000.00
      description: 'Hand delivery within the United States, before travel',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'white_glove:international',
      model: 'fixed' as const,
      value: 150000, // $1,500.00
      description: 'Hand delivery outside the United States, before travel',
      billingTrigger: 'per_event' as const,
    },
    {
      /**
       * Collecting at a show costs a fraction of postage for one reason: the van
       * was going anyway. A show may override this with its own figure.
       */
      actionType: 'show_pickup',
      model: 'fixed' as const,
      value: 1500, // $15.00
      description: 'Collect your cards in person at a show Bault is attending',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'parcel_processing',
      model: 'fixed' as const,
      value: 200, // $2.00
      description: 'Per-package fee for receiving, opening and cataloguing a parcel',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'parcel_forwarding',
      model: 'fixed' as const,
      value: 400, // $4.00
      description: 'Second leg, charged only to parcels sent to a forwarding address',
      billingTrigger: 'per_event' as const,
    },
  ];
  for (const r of rules) {
    await db.insert(pricingRule).values({ ...r, currency: CUR, updatedBy: eldar });
  }

  // -------------------------------------------------------------------------
  // 3b. FACILITIES — the addresses collectors ship their purchases to.
  //
  //     ⚠ THE STREET ADDRESSES BELOW ARE PLACEHOLDERS. ⚠
  //     They are what a customer will write on a parcel, so inventing something
  //     that reads as real would be worse than leaving them obviously unset.
  //     Replace both with the actual facility addresses before anybody is
  //     invited to ship anything.
  //
  //     New Jersey is the PRIMARY site: goods are stored there. Delaware is a
  //     FORWARDING site that holds nothing — it exists because Delaware levies
  //     no sales tax, so a purchase delivered there is not taxed by the
  //     destination state, at the cost of a second leg to New Jersey.
  //
  //     `salesTaxBps` is the DESTINATION state's rate, recorded for guidance
  //     only. Bault is not the seller and neither collects nor remits anybody's
  //     sales tax; the figure exists so the app can show a collector what a
  //     purchase would cost at each address instead of making them work it out.
  //     NJ is 6.625% (6625 bps) at the time of writing; DE is 0.
  // -------------------------------------------------------------------------
  const njFacility = one(
    await db
      .insert(facility)
      .values({
        code: 'NJ',
        name: 'Bault New Jersey',
        role: 'primary',
        line1: 'SET REAL ADDRESS — placeholder',
        city: 'Newark',
        region: 'NJ',
        postalCode: '00000',
        country: 'US',
        salesTaxBps: 6625,
        active: true,
      })
      .returning({ id: facility.id }),
  ).id;

  await db.insert(facility).values({
    code: 'DE',
    name: 'Bault Delaware',
    role: 'forwarding',
    line1: 'SET REAL ADDRESS — placeholder',
    city: 'Wilmington',
    region: 'DE',
    postalCode: '00000',
    country: 'US',
    salesTaxBps: 0,
    forwardsToFacilityId: njFacility,
    forwardingDays: 4,
    active: true,
  });

  // -------------------------------------------------------------------------
  // 4. BINS (shelves) — BIN- prefixed SERIALS, minted, never named
  //    (Requirement 9.3, and 0019_bins_get_a_serial).
  // -------------------------------------------------------------------------
  // No capacity: a bin holds what physically goes into it, and the person who
  // knows whether there is room is the one standing in front of it. Every shelf
  // names the building it is in, because "stow it wherever there is room" has to
  // mean "wherever in THIS building" — see 0018_stow_wherever_it_fits.
  //
  // Zone O is oversized shelving. Without at least one such bin, the directed
  // stow has nowhere to send a sealed case or a piece of memorabilia and says so
  // rather than putting it on a card shelf.
  // The serial is minted, exactly as the console mints one — the seed does not
  // get to hand-write `BIN-A-001`, because nothing else can either.
  const mkBin = async (zone: string, oversized = false) => {
    const serialNumber = makeBinSerial();
    return one(
      await db
        .insert(bin)
        .values({
          serialNumber,
          barcode: makeBinBarcode(serialNumber),
          zone,
          oversized,
          facilityId: njFacility,
        })
        .returning({ id: bin.id }),
    ).id;
  };
  const binA1 = await mkBin('A');
  const binA2 = await mkBin('A');
  const binB1 = await mkBin('B');
  const binB2 = await mkBin('B');
  await mkBin('O', true);
  await mkBin('O', true);

  // -------------------------------------------------------------------------
  // Money constants (USD cents) and small helpers.
  // -------------------------------------------------------------------------
  const INTAKE = 500; // $5.00
  const SERVICE = 2000; // $20.00
  const SHIP = 3500; // $35.00
  const MEGA_SALE = 26_000; // $260.00 — M Rayquaza-EX sale price
  const FEE = 1_300; // 5% of MEGA_SALE
  const GOLD_STAR_ASK = 320_000; // $3,200.00 — Gold Star asking price
  const GOLD_STAR_OFFER = 275_000; // $2,750.00 — Golden's standing offer
  const TOPUP = 500_000; // $5,000.00
  const WITHDRAW = 100_000; // $1,000.00

  const ledger = (userId: string, type: string, amount: number, direction: 'debit' | 'credit', refType: string, refId: string) =>
    db.insert(ledgerRecord).values({ userId, type: type as never, amount, direction, currency: CUR, referenceType: refType, referenceId: refId });

  /** Insert a settled Charge + its ledger debit (mirrors BillingService). */
  const bill = async (userId: string, actionType: string, amount: number, refItemId: string) => {
    const chargeId = one(
      await db
        .insert(charge)
        .values({
          userId,
          actionType,
          pricingRuleSnapshot: { seed: true, actionType, currency: CUR },
          amount,
          currency: CUR,
          paymentMeans: 'wallet',
          status: 'settled',
          referenceId: refItemId,
        })
        .returning({ id: charge.id }),
    ).id;
    const ledgerType = actionType === 'marketplace_fee' ? 'fee' : 'service_charge';
    await ledger(userId, ledgerType, amount, 'debit', 'charge', chargeId);
  };

  const topup = async (userId: string, amount: number) => {
    const epId = one(
      await db
        .insert(externalPayment)
        .values({ userId, provider: 'sandbox', providerRef: `sbx_topup_seed_${userId}`, purpose: 'topup', status: 'succeeded', amount, currency: CUR })
        .returning({ id: externalPayment.id }),
    ).id;
    await ledger(userId, 'credit_topup', amount, 'credit', 'external_payment', epId);
  };

  const mkItem = async (v: {
    ownerId: string;
    serialNumber: string;
    barcode: string;
    typeClass: string;
    description: string;
    conditionGrade: string | null;
    lifecycleState: 'stored' | 'listed' | 'shipped' | 'donated';
    binId: string | null;
    sourceBatchId?: string;
    isLot?: boolean;
    lotSize?: number;
  }) => one(await db.insert(item).values({ ...v, receivedAt: new Date() }).returning({ id: item.id })).id;

  const custody = (v: {
    itemId: string;
    eventType: 'intake' | 'relocate' | 'ownership_transfer' | 'state_change' | 'hold_placed' | 'hold_released' | 'batch_split' | 'dispatch';
    prevOwnerId?: string;
    newOwnerId?: string;
    prevBinId?: string;
    newBinId?: string;
    prevState?: string;
    newState?: string;
    actorId: string;
    reason: string;
  }) => db.insert(custodyEvent).values(v);

  /** Dedicated bin/shelf transfer ledger row: source AND destination (Req 10.4). */
  const transfer = (itemId: string, fromBinId: string | null, toBinId: string, actorId: string, reason: string) =>
    db.insert(binTransfer).values({ itemId, fromBinId, toBinId, actorId, reason });

  const img = (itemId: string, type: 'intake' | 'professional', version: number, objectKey: string) =>
    db.insert(itemImage).values({ itemId, type, version, objectKey });

  // -------------------------------------------------------------------------
  // 5. WALLET TOP-UPS (so the collectors have spendable balances).
  // -------------------------------------------------------------------------
  await topup(red, TOPUP);
  await topup(golden, TOPUP);

  // -------------------------------------------------------------------------
  // 6. ITEMS + full history for each.
  // -------------------------------------------------------------------------

  // The vault holds eight of the ten catalogued Rayquaza cards, four owned by Red
  // and four by Golden. Each `serialNumber` is also the filename of that card's
  // catalogue photograph under assets/images (SN-DR97-0001.png), so the serial is
  // the single key joining the database row to the picture on screen.
  //
  // GRADES: the research dossiers state their PSA 10 is a *target profile*, not a
  // certified slab, and carry no certificate number. Inventing one for a real card
  // would be fabricating an authentication record, so every seeded card is entered
  // exactly as it is documented — raw and ungraded. The grading workflow is instead
  // demonstrated by a submission that is still out at PSA (item d).

  // (a) EX Dragon Rayquaza ex — Red, stored, professionally photographed.
  const rayDragon = await mkItem({
    ownerId: red, serialNumber: 'SN-DR97-0001', barcode: 'BC-DR97-0001',
    typeClass: 'trading_card',
    description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97 · Rare Holo EX · art by Hikaru Koike · ex3-97',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binA1,
  });
  await custody({ itemId: rayDragon, eventType: 'intake', newOwnerId: red, newBinId: binA1, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayDragon, null, binA1, hermon, 'intake');
  await img(rayDragon, 'intake', 1, 'images/sn-dr97-0001-intake.jpg');
  await bill(red, 'intake', INTAKE, rayDragon);
  await img(rayDragon, 'professional', 2, 'images/sn-dr97-0001-pro.jpg');
  await db.insert(serviceRequest).values({
    code: prefixedId(ID_PREFIX.serviceRequest),
    type: 'professional_photography', requesterId: red, itemId: rayDragon, status: 'completed',
    typeFields: { objectKey: 'images/sn-dr97-0001-pro.jpg', version: 2 },
    fulfillment: { objectKey: 'images/sn-dr97-0001-pro.jpg', shotCount: 6, lighting: 'diffused softbox', itemVerified: true, notes: 'Front and back, holofoil raked at 45° to show the print lines.' },
    fulfilledBy: hermon,
    fulfilledAt: new Date(),
  });
  await bill(red, 'service', SERVICE, rayDragon);

  // (b) + (g) EX Deoxys ex and Roaring Skies EX arrived together as a BATCH for
  //     Golden and were split onto separate shelves by Hermon.
  const goldenBatch = one(await db.insert(batch).values({ ownerId: golden, status: 'split' }).returning({ id: batch.id })).id;

  const rayDeoxys = await mkItem({
    ownerId: golden, serialNumber: 'SN-DX102-0002', barcode: 'BC-DX102-0002',
    typeClass: 'trading_card',
    description: '2005 Pokémon EX Deoxys — Rayquaza ex #102/107 · Rare Holo EX · art by Shin-ichi Yoshikawa · ex8-102',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binA2, sourceBatchId: goldenBatch,
  });
  await custody({ itemId: rayDeoxys, eventType: 'batch_split', newOwnerId: golden, newBinId: binA2, newState: 'stored', actorId: hermon, reason: 'batch_split' });
  await transfer(rayDeoxys, null, binA2, hermon, 'batch_split');
  await img(rayDeoxys, 'intake', 1, 'images/sn-dx102-0002-intake.jpg');
  await bill(golden, 'intake', INTAKE, rayDeoxys);

  // (c) Gold Star — the collection's centrepiece. Red has it LISTED, with a
  //     standing offer from Golden. Relocated once, so the transfer ledger shows
  //     a real source → destination move.
  const rayGoldStar = await mkItem({
    ownerId: red, serialNumber: 'SN-DX107-0003', barcode: 'BC-DX107-0003',
    typeClass: 'trading_card',
    description: '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star) #107/107 · Rare Holo Star · art by Masakazu Fukuda · ex8-107',
    conditionGrade: 'Raw', lifecycleState: 'listed', binId: binB1,
  });
  await custody({ itemId: rayGoldStar, eventType: 'intake', newOwnerId: red, newBinId: binA2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayGoldStar, null, binA2, hermon, 'intake');
  await custody({ itemId: rayGoldStar, eventType: 'relocate', prevBinId: binA2, newBinId: binB1, actorId: hermon, reason: 'scan relocate' });
  await transfer(rayGoldStar, binA2, binB1, hermon, 'scan relocate');
  await img(rayGoldStar, 'intake', 1, 'images/sn-dx107-0003-intake.jpg');
  await bill(red, 'intake', INTAKE, rayGoldStar);
  await custody({ itemId: rayGoldStar, eventType: 'state_change', prevState: 'stored', newState: 'listed', actorId: red, reason: 'listed for sale' });
  const goldStarListing = one(
    await db.insert(listing).values({ itemId: rayGoldStar, sellerId: red, askingPrice: GOLD_STAR_ASK, currency: CUR, status: 'active' }).returning({ id: listing.id }),
  ).id;
  await db.insert(offer).values({ listingId: goldStarListing, buyerId: golden, amount: GOLD_STAR_OFFER, currency: CUR, status: 'pending' });

  // (d) Dragon Frontiers δ — Golden's, currently OUT at PSA. The request is open,
  //     so it sits in the operator's service queue waiting to be closed with a
  //     real returned grade; nothing about a grade is asserted here.
  const rayDelta = await mkItem({
    ownerId: golden, serialNumber: 'SN-DF97-0004', barcode: 'BC-DF97-0004',
    typeClass: 'trading_card',
    description: '2006 Pokémon EX Dragon Frontiers — Rayquaza ex δ (Delta Species) #97/101 · Rare Holo EX · art by Ryo Ueda · ex15-97',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binB1,
  });
  await custody({ itemId: rayDelta, eventType: 'intake', newOwnerId: golden, newBinId: binB1, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayDelta, null, binB1, hermon, 'intake');
  await img(rayDelta, 'intake', 1, 'images/sn-df97-0004-intake.jpg');
  await bill(golden, 'intake', INTAKE, rayDelta);
  await db.insert(serviceRequest).values({
    code: prefixedId(ID_PREFIX.serviceRequest),
    type: 'third_party_grading', requesterId: golden, itemId: rayDelta, status: 'in_progress',
    // Target grade only — the certificate number is filled in when the slab returns.
    typeFields: { gradingBody: 'PSA', targetGrade: 'PSA 10', submittedAt: new Date().toISOString() },
  });
  await bill(golden, 'service', SERVICE, rayDelta);

  // (e) Call of Legends Rayquaza — Red, stored, unremarkable on purpose: a plain
  //     shelved item with nothing pending against it.
  const rayLegends = await mkItem({
    ownerId: red, serialNumber: 'SN-CL10-0005', barcode: 'BC-CL10-0005',
    typeClass: 'trading_card',
    description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo (Shiny Legendary subset) · art by Noriko Hotta · col1-SL10',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binA1,
  });
  await custody({ itemId: rayLegends, eventType: 'intake', newOwnerId: red, newBinId: binA1, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayLegends, null, binA1, hermon, 'intake');
  await img(rayLegends, 'intake', 1, 'images/sn-cl10-0005-intake.jpg');
  await bill(red, 'intake', INTAKE, rayLegends);

  // (f) Supreme Victors C LV.X — Golden shipped it home (rush). Ownership stays
  //     with Golden; only custody of the physical card leaves the vault.
  const rayLevelX = await mkItem({
    ownerId: golden, serialNumber: 'SN-SV146-0006', barcode: 'BC-SV146-0006',
    typeClass: 'trading_card',
    description: '2009 Pokémon Supreme Victors — Rayquaza C LV.X #146/147 · Rare Holo LV.X (Pokémon SP) · art by Shizurow · pl3-146',
    conditionGrade: 'Raw', lifecycleState: 'shipped', binId: null,
  });
  await custody({ itemId: rayLevelX, eventType: 'intake', newOwnerId: golden, newBinId: binB2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayLevelX, null, binB2, hermon, 'intake');
  await img(rayLevelX, 'intake', 1, 'images/sn-sv146-0006-intake.jpg');
  await bill(golden, 'intake', INTAKE, rayLevelX);
  await custody({ itemId: rayLevelX, eventType: 'state_change', prevState: 'stored', newState: 'shipped', actorId: hermon, reason: 'dispatched via DHL' });
  await db.insert(shipment).values({
    code: prefixedId(ID_PREFIX.shipment),
    userId: golden, itemIds: [rayLevelX], destinationAddress: 'Golden Marsh, 55 Wall St, New York 10005, US',
    recipientName: 'Golden Marsh',
    carrier: 'DHL', serviceLevel: 'Express',
    rushFlag: true, cost: SHIP, currency: CUR, status: 'shipped', trackingNumber: 'SBX-SEED-0001', labelObjectKey: 'labels/sn-sv146-0006.pdf',
    // The carrier's Express quote at dispatch time; the tracking list shows it.
    estimatedDeliveryAt: new Date(Date.now() + 86_400_000),
    packageWeightGrams: 120,
    fulfillmentNotes: 'Single card, top-loader in a team bag, rigid mailer.',
    fulfillment: { carrier: 'DHL', packageWeightGrams: 120, verifiedItemIds: [rayLevelX], notes: 'Single card, top-loader in a team bag, rigid mailer.' },
    fulfilledBy: hermon,
    fulfilledAt: new Date(),
  });
  await bill(golden, 'shipping', SHIP, rayLevelX);

  // (g) Roaring Skies Rayquaza-EX — Golden's, second half of the batch above, with
  //     an OPEN donation request so the DIS donation path has a live example.
  const rayFullArt = await mkItem({
    ownerId: golden, serialNumber: 'SN-ROS104-0007', barcode: 'BC-ROS104-0007',
    typeClass: 'trading_card',
    description: '2015 Pokémon XY Roaring Skies — Rayquaza-EX (Full Art) #104/108 · Rare Ultra · art by Ryo Ueda · xy6-104',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binB2, sourceBatchId: goldenBatch,
  });
  await custody({ itemId: rayFullArt, eventType: 'batch_split', newOwnerId: golden, newBinId: binB2, newState: 'stored', actorId: hermon, reason: 'batch_split' });
  await transfer(rayFullArt, null, binB2, hermon, 'batch_split');
  await img(rayFullArt, 'intake', 1, 'images/sn-ros104-0007-intake.jpg');
  await bill(golden, 'intake', INTAKE, rayFullArt);
  await db.insert(serviceRequest).values({
    code: prefixedId(ID_PREFIX.serviceRequest),
    type: 'donation', requesterId: golden, itemId: rayFullArt, status: 'requested',
    typeFields: { note: 'Donate to the youth league raffle if the platform accepts it.' },
  });

  // (h) M Rayquaza-EX — intaken by Golden, LISTED, then SOLD to Red. This is the
  //     one full sale record: custody transfer, both ledger legs, fee, and a TXN.
  const rayMega = await mkItem({
    ownerId: red, serialNumber: 'SN-ROS105-0008', barcode: 'BC-ROS105-0008',
    typeClass: 'trading_card',
    description: '2015 Pokémon XY Roaring Skies — M Rayquaza-EX (Full Art, Δ Evolution) #105/108 · Rare Ultra · art by 5ban Graphics · xy6-105',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binB2,
  });
  await custody({ itemId: rayMega, eventType: 'intake', newOwnerId: golden, newBinId: binB2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayMega, null, binB2, hermon, 'intake');
  await img(rayMega, 'intake', 1, 'images/sn-ros105-0008-intake.jpg');
  await bill(golden, 'intake', INTAKE, rayMega);
  await custody({ itemId: rayMega, eventType: 'state_change', prevState: 'stored', newState: 'listed', actorId: golden, reason: 'listed for sale' });
  const megaListing = one(
    await db.insert(listing).values({ itemId: rayMega, sellerId: golden, askingPrice: MEGA_SALE, currency: CUR, status: 'sold' }).returning({ id: listing.id }),
  ).id;
  await custody({ itemId: rayMega, eventType: 'ownership_transfer', prevOwnerId: golden, newOwnerId: red, actorId: red, reason: `sale of listing ${megaListing}` });
  await custody({ itemId: rayMega, eventType: 'state_change', prevState: 'listed', newState: 'stored', actorId: red, reason: 'sold' });
  await ledger(red, 'purchase', MEGA_SALE, 'debit', 'listing', megaListing);
  await ledger(golden, 'sale_credit', MEGA_SALE, 'credit', 'listing', megaListing);
  await ledger(golden, 'fee', FEE, 'debit', 'listing', megaListing);
  const saleTxn = one(
    await db
      .insert(transaction)
      .values({
        code: prefixedId(ID_PREFIX.transaction),
        type: 'sale', itemIds: [rayMega], buyerId: red, sellerId: golden, price: MEGA_SALE, fee: FEE,
        frozenPricing: { model: 'percentage', value: 500, currency: CUR }, currency: CUR,
      })
      .returning({ id: transaction.id }),
  ).id;
  // The condition was corrected on arrival, giving the item a real change history.
  await db.insert(itemChangeHistory).values({ itemId: rayMega, actorId: hermon, field: 'conditionGrade', oldValue: 'Near Mint', newValue: 'Raw' });

  // NOT SEEDED, ON PURPOSE — the remaining two cards of the ten are left out of the
  // database so the warehouse intake flow can be exercised end to end against real
  // items. Their photographs are already on disk, so booking one in with the serial
  // below immediately shows the correct picture in the vault:
  //
  //   SN-EVS194-0009  2021 Pokémon SWSH Evolving Skies — Rayquaza V (Alternate Full Art)
  //                   #194/203 · Rare Ultra · art by Ryuta Fuse · swsh7-194
  //   SN-EVS218-0010  2021 Pokémon SWSH Evolving Skies — Rayquaza VMAX (Alternate Art
  //                   secret) #218/203 · Rare Rainbow · art by Anesaki Dynamic · swsh7-218

  // -------------------------------------------------------------------------
  // 7. A pending SWAP PROPOSAL: Red offers the Call of Legends Rayquaza for
  //    Golden's EX Deoxys Rayquaza ex.
  // -------------------------------------------------------------------------
  await db.insert(swapProposal).values({
    proposerId: red, responderId: golden, offeredItemIds: [rayLegends], requestedItemIds: [rayDeoxys],
    proposerApproved: true, responderApproved: false, status: 'pending',
  });

  // -------------------------------------------------------------------------
  // 8. A completed WITHDRAWAL by Golden (money out), from before cash-out became
  //    a reviewed request. Kept so the historical `withdrawal` reference type in
  //    the ledger has a real row behind it.
  // -------------------------------------------------------------------------
  const w = one(
    await db.insert(withdrawal).values({ userId: golden, destinationAccount: '••••1234', amount: WITHDRAW, currency: CUR, status: 'paid', confirmedAt: new Date() }).returning({ id: withdrawal.id }),
  ).id;
  await ledger(golden, 'withdrawal', WITHDRAW, 'debit', 'withdrawal', w);

  // -------------------------------------------------------------------------
  // 8b. WALLET REQUESTS — one at each interesting point of the lifecycle, so the
  //     Requests view and the review queue both have real work in them.
  //
  //     The COMPLETED one is the only one with a ledger row, and that row is what
  //     changed the balance — exactly the invariant the workflow exists to hold.
  //     The open ones have moved no money at all.
  // -------------------------------------------------------------------------
  const walletEvent = async (
    requestId: string,
    toStatus: string,
    fromStatus: string | null,
    actorId: string | null,
    actorRole: string | null,
    reason?: string,
  ) => {
    await db.insert(walletRequestEvent).values({
      requestId,
      actorId,
      actorRole,
      fromStatus,
      toStatus,
      reason: reason ?? null,
      metadata: {},
    });
  };

  // (a) Red's cash-in, waiting to be picked up by a reviewer.
  const cashInSubmitted = one(
    await db
      .insert(walletRequest)
      .values({
        code: prefixedId('WR'),
        userId: red,
        type: 'cash_in',
        status: 'submitted',
        amount: 25_000, // $250.00
        currency: CUR,
        fundingSource: 'bank_transfer',
        reference: 'Wire ref 8842-A',
        notes: 'Funding the M Rayquaza-EX purchase.',
      })
      .returning({ id: walletRequest.id }),
  ).id;
  await walletEvent(cashInSubmitted, 'submitted', null, red, 'user');

  // (b) Golden's cash-out, approved by the manager and now being paid out.
  const cashOutProcessing = one(
    await db
      .insert(walletRequest)
      .values({
        code: prefixedId('WR'),
        userId: golden,
        type: 'cash_out',
        status: 'processing',
        amount: 12_500, // $125.00
        currency: CUR,
        destinationAccount: 'IL62 0108 0000 0009 9999 999',
        beneficiaryName: 'Golden Marsh',
        reviewedBy: eldar,
        reviewedAt: new Date(),
      })
      .returning({ id: walletRequest.id }),
  ).id;
  await walletEvent(cashOutProcessing, 'submitted', null, golden, 'user');
  await walletEvent(cashOutProcessing, 'pending_review', 'submitted', eldar, 'admin');
  await walletEvent(cashOutProcessing, 'approved', 'pending_review', eldar, 'admin', 'Beneficiary matches the account holder.');
  await walletEvent(cashOutProcessing, 'processing', 'approved', eldar, 'admin', 'Bank transfer initiated.');

  // (c) A rejected cash-out — the reason is mandatory and is recorded on both the
  //     request and its event trail.
  const cashOutRejected = one(
    await db
      .insert(walletRequest)
      .values({
        code: prefixedId('WR'),
        userId: red,
        type: 'cash_out',
        status: 'rejected',
        amount: 300_000, // $3,000.00 — more than Red's wallet held
        currency: CUR,
        destinationAccount: 'IL62 0108 0000 0001 1111 111',
        beneficiaryName: 'R. Ashwood',
        reviewedBy: eldar,
        reviewedAt: new Date(),
        rejectionReason: 'Requested amount exceeded the available balance at review time.',
      })
      .returning({ id: walletRequest.id }),
  ).id;
  await walletEvent(cashOutRejected, 'submitted', null, red, 'user');
  await walletEvent(
    cashOutRejected,
    'rejected',
    'submitted',
    eldar,
    'admin',
    'Requested amount exceeded the available balance at review time.',
  );

  // (d) A COMPLETED cash-in — and the one ledger row it produced. This pair is
  //     the whole rule in miniature: the credit exists because, and only because,
  //     the request reached `completed`.
  const cashInCompleted = one(
    await db
      .insert(walletRequest)
      .values({
        code: prefixedId('WR'),
        userId: red,
        type: 'cash_in',
        status: 'completed',
        amount: TOPUP,
        currency: CUR,
        fundingSource: 'card',
        reviewedBy: eldar,
        reviewedAt: new Date(),
        completedAt: new Date(),
      })
      .returning({ id: walletRequest.id }),
  ).id;
  const cashInLedgerId = one(
    await db
      .insert(ledgerRecord)
      .values({
        userId: red,
        type: 'credit_topup',
        amount: TOPUP,
        direction: 'credit',
        currency: CUR,
        referenceType: 'wallet_request',
        referenceId: cashInCompleted,
      })
      .returning({ id: ledgerRecord.id }),
  ).id;
  await db
    .update(walletRequest)
    .set({ settledLedgerId: cashInLedgerId })
    .where(eq(walletRequest.id, cashInCompleted));
  await walletEvent(cashInCompleted, 'submitted', null, red, 'user');
  await walletEvent(cashInCompleted, 'approved', 'submitted', eldar, 'admin');
  await walletEvent(cashInCompleted, 'completed', 'approved', eldar, 'admin', 'Funds cleared.');

  // -------------------------------------------------------------------------
  // 9. A DISPUTE against the real M Rayquaza-EX sale (Requirement 13.3 — disputes always
  //    reference an actual recorded transaction, never placeholder data).
  // -------------------------------------------------------------------------
  await db.insert(dispute).values({
    code: prefixedId(ID_PREFIX.dispute),
    transactionId: saleTxn,
    openedBy: eldar,
    assignedAdminId: eldar,
    status: 'investigating',
    note: 'Buyer reports the card arrived with a nicked corner not shown in the listing photo.',
  });

  // -------------------------------------------------------------------------
  // 10. A few AUDIT records + OUTBOX messages (normally interceptor/worker-driven).
  // -------------------------------------------------------------------------
  const goldStarName = '2005 Pokémon EX Deoxys Rayquaza ★ (Gold Star) #107/107';
  await db.insert(auditRecord).values([
    { actorId: hermon, action: 'POST /api/v1/intake/items', targetEntity: 'item', targetId: rayDragon },
    { actorId: red, action: 'POST /api/v1/marketplace/listings', targetEntity: 'listing', targetId: goldStarListing },
    { actorId: red, action: 'POST /api/v1/marketplace/listings/:id/purchase', targetEntity: 'transaction', targetId: saleTxn },
  ]);
  await db.insert(outboxMessage).values([
    { aggregateType: 'item', aggregateId: rayDragon, eventType: 'item_received', payload: { itemId: rayDragon, ownerId: red, barcode: 'BC-DR97-0001' } },
    {
      aggregateType: 'listing',
      aggregateId: goldStarListing,
      eventType: 'offer_received',
      payload: { listingId: goldStarListing, sellerId: red, amount: GOLD_STAR_OFFER, itemId: rayGoldStar, barcode: 'BC-DX107-0003', itemDescription: goldStarName },
    },
  ]);

  // -------------------------------------------------------------------------
  // 11. NOTIFICATIONS + preferences and saved ADDRESSES. Every notification
  //     carries a rendered, human-readable message (Requirement 6.1).
  // -------------------------------------------------------------------------
  await db.insert(notification).values([
    {
      userId: red,
      eventType: 'item_received',
      content: {
        itemId: rayDragon,
        barcode: 'BC-DR97-0001',
        message: 'Item BC-DR97-0001 was received into your vault and shelved.',
      },
    },
    {
      userId: red,
      eventType: 'offer_received',
      content: {
        listingId: goldStarListing,
        amount: GOLD_STAR_OFFER,
        itemDescription: goldStarName,
        message: `You received an offer of $2,750.00 on your listing for ${goldStarName}.`,
      },
    },
    {
      userId: golden,
      eventType: 'item_received',
      content: {
        itemId: rayDeoxys,
        barcode: 'BC-DX102-0002',
        message: 'Item BC-DX102-0002 was received into your vault and shelved.',
      },
    },
  ]);
  // Golden opts OUT of hold_placed notifications (worker skips them on dispatch).
  await db.insert(notificationPreference).values({ userId: golden, eventType: 'hold_placed', enabled: false });

  await db.insert(shippingAddress).values([
    { userId: red, label: 'Home', recipient: 'Red Ashwood', line1: '1200 Market St', city: 'San Francisco', country: 'US', postalCode: '94102', isDefault: true },
    { userId: golden, label: 'Home', recipient: 'Golden Marsh', line1: '55 Wall St', city: 'New York', country: 'US', postalCode: '10005', isDefault: true },
    { userId: veteran, label: 'Home', recipient: 'Ana Maria van der Berg', line1: 'Keizersgracht 12', city: 'Amsterdam', country: 'NL', postalCode: '1015 CS', isDefault: true },
  ]);

  /**
   * Two shows Bault is taking a table at.
   *
   * Real rows rather than decoration: the consignment channel refuses a show
   * whose deadline has passed or whose capacity is full, the published calendar
   * reads from here, and show PICKUP is gated on the same deadline because it is
   * the same van. Dates are relative to the seed run so they never go stale.
   */
  const days = (n: number) => new Date(Date.now() + n * 86_400_000);
  await db.insert(consignmentEvent).values([
    {
      name: 'Philly Non-Sports Card Show',
      venue: 'Greater Philadelphia Expo Center',
      city: 'Oaks, PA',
      startsAt: days(28),
      endsAt: days(30),
      requestDeadline: days(21),
      capacity: 40,
      // Bault hands cards back at this one as well as selling at it.
      pickupEnabled: true,
      pickupCapacity: 12,
      pickupFeeMinor: 1500,
      notes: 'Three-day show. Collections from the Bault table, ask for Hermon.',
    },
    {
      name: 'East Coast Winter Card Expo',
      venue: 'Meadowlands Exposition Center',
      city: 'Secaucus, NJ',
      startsAt: days(63),
      endsAt: days(64),
      requestDeadline: days(56),
      capacity: 25,
      // Selling only — no room behind the table to hand boxes back.
      pickupEnabled: false,
      notes: 'Consignment only at this one.',
    },
  ]);

  await pool.end();
  // eslint-disable-next-line no-console
  console.log(
    '✔ seed complete: 6 users, 6 bins (4 standard, 2 oversized), 8 items (4 Red / 4 Golden), 1 batch, 2 listings, 1 offer, ' +
      '1 swap, 1 transaction, 1 dispute, 3 service requests, 1 shipment, 1 withdrawal, ' +
      '4 wallet requests, 3 notifications, 2 addresses, 2 shows.',
  );
  // eslint-disable-next-line no-console
  console.log(
    `  usernames — ${redAcc.username} · ${goldenAcc.username} · ${hermonAcc.username} · ${eldarAcc.username} · ${veteranAcc.username}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    '  intake IDs are retired: only "veteran" carries one, so the pre-printed-label fallback stays exercised.',
  );
  console.log(
    '  NOT seeded (intake test material, photos already on disk):\n' +
      '    SN-EVS194-0009  2021 Evolving Skies Rayquaza V (Alt Full Art) #194/203\n' +
      '    SN-EVS218-0010  2021 Evolving Skies Rayquaza VMAX (Alt Art secret) #218/203',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed failed', err);
  process.exit(1);
});
