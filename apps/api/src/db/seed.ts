import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { userAccount } from '../modules/acc/acc.schema';
import { item, bin, itemImage, custodyEvent, itemChangeHistory, binTransfer, batch } from '../modules/cst/cst.schema';
import { listing, transaction, offer, swapProposal } from '../modules/mkt/mkt.schema';
import { houseListing } from '../modules/mkt/house.schema';
import {
  ledgerRecord,
  externalPayment,
  charge,
  withdrawal,
  walletRequest,
  walletRequestEvent,
} from '../modules/pay/pay.schema';
import { pricingRule } from '../modules/prc/prc.schema';
import { MEMBERSHIP_TIERS } from '../modules/mem/tiers';
import { serviceRequest } from '../modules/dis/dis.schema';
import { shipment } from '../modules/shp/shp.schema';
import { dispute } from '../modules/adm/adm.schema';
import { auditRecord } from '../modules/sec/audit.schema';
import { outboxMessage } from '../modules/not/outbox/outbox.schema';
import { notification, notificationPreference } from '../modules/not/notification.schema';
import { shippingAddress } from '../modules/acc/address.schema';
import { facility } from '../modules/inv/facility.schema';
import { consignmentEvent } from '../modules/dis/consignment-event.schema';
import { parcel, parcelEvent } from '../modules/inv/parcel.schema';
import { arrivalDisposal } from '../modules/inv/disposal.schema';
import { supportTicket, supportMessage } from '../modules/sup/sup.schema';
import { escrowDeal, escrowEvent } from '../modules/esc/escrow.schema';
import { ID_PREFIX, prefixedId } from '../shared/ids';
import { makeBinBarcode, makeBinSerial } from '../modules/inv/labels';

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error('insert returned no row');
  return r;
}

const DESTRUCTIVE_SEED_CONFIRMATION = 'yes-i-am-sure';

function refuseInProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.ALLOW_DESTRUCTIVE_SEED === DESTRUCTIVE_SEED_CONFIRMATION) return;
  throw new Error(
    'Refusing to seed: NODE_ENV=production. This script TRUNCATEs every table, the ledger, the ' +
      'custody trail and the audit log included, and creates admin accounts with a published ' +
      'password. If this database is disposable, run it again with ' +
      `ALLOW_DESTRUCTIVE_SEED=${DESTRUCTIVE_SEED_CONFIRMATION}.`,
  );
}

async function main(): Promise<void> {
  refuseInProduction();
  let handle: ReturnType<typeof createDb>;
  try {
    handle = createDb();
  } finally {
    refuseInProduction();
  }
  const { db, pool } = handle;
  const CUR = 'USD';

  const pw = await argon2.hash('11111111');

  await pool.query(`TRUNCATE TABLE
    user_account, verification_token, login_session, login_attempt,
    mfa_factor, mfa_recovery_code, mfa_challenge,
    item, bin, item_image, custody_event, item_change_history, bin_transfer, batch,
    listing, "transaction", offer, swap_proposal, house_listing, house_order,
    ledger_record, external_payment, charge, withdrawal,
    wallet_request, wallet_request_event,
    pricing_rule, service_request, shipment,
    outbox_message, audit_record, idempotency_key, confirmation_token,
    notification, notification_preference, dispute,
    storage_fee_run, shipping_address,
    facility, parcel, parcel_event, parcel_photo, arrival_disposal,
    support_ticket, support_message, media_upload,
    consignment_event, grading_submission, shipment_group,
    escrow_deal, escrow_event,
    membership, membership_period,
    storage_cover, worker_heartbeat
    RESTART IDENTITY`);

  await pool.query(`DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss') THEN
        TRUNCATE TABLE pgboss.job, pgboss.archive;
      END IF;
    END $$;`);

  const mkUser = async (
    email: string,
    username: string,
    role: 'user' | 'warehouse_operator' | 'admin',
    firstName: string,
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
  // The row migration 0038 writes, so a seeded database has production's platform custodian.
  const platformAcc = one(
    await db
      .insert(userAccount)
      .values({
        email: 'platform@bault.dev',
        username: 'platform',
        passwordHash:
          '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        status: 'closed',
        role: 'user',
        firstName: 'Platform',
        lastName: 'Custodian',
      })
      .returning({ id: userAccount.id, username: userAccount.username }),
  );

  const eldar = eldarAcc.id;
  const hermon = hermonAcc.id;
  const red = redAcc.id;
  const golden = goldenAcc.id;
  const veteran = veteranAcc.id;
  const platform = platformAcc.id;

  const rules = [
    {
      actionType: 'intake',
      model: 'fixed' as const,
      value: 500,
      description: 'Intake handling fee per received item',
      billingTrigger: 'per_event' as const,
    },
    ...(
      [
        ['trading_card', 100, 'A single card'],
        ['graded_slab', 100, 'A graded card, priced as a single card'],
        ['oversized_card', 500, 'An oversized card'],
        ['sealed_pack', 500, 'A sealed pack'],
        ['sealed_box', 500, 'A sealed box'],
        ['sealed_case', 2000, 'A sealed case'],
        ['collection_box', 1000, 'A collection box'],
        ['comic_raw', 500, 'A comic book'],
        ['comic_graded', 500, 'A graded comic'],
        ['memorabilia', 2000, 'Memorabilia'],
        ['small_collectible', 500, 'A small collectible'],
      ] as const
    ).map(([itemClass, value, what]) => ({
      actionType: 'intake',
      itemClass,
      model: 'fixed' as const,
      value,
      description: `Intake: ${what}`,
      billingTrigger: 'per_event' as const,
    })),
    {
      actionType: 'intake_lot',
      model: 'fixed' as const,
      value: 500,
      description: 'Intake: a lot, booked as one item',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'storage',
      model: 'fixed' as const,
      value: 100,
      description: '180 days included, then 10% of the item intake fee every 90 days',
      billingTrigger: 'daily' as const,
      parameters: { freeDays: 180, periodDays: 90, percentOfIntakeBps: 1_000 },
    },
    {
      actionType: 'storage_oversized',
      model: 'fixed' as const,
      value: 500,
      description: '90 days included, then the full intake fee again every 90 days',
      billingTrigger: 'daily' as const,
      parameters: { freeDays: 90, periodDays: 90, percentOfIntakeBps: 10_000 },
    },
    {
      actionType: 'service',
      model: 'fixed' as const,
      value: 2000,
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
      value: 500,
      description: 'Marketplace commission charged to the seller on every sale',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'consignment_fee:card_show',
      model: 'percentage' as const,
      value: 1000,
      description: 'Bault commission on a card-show consignment sale',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'consignment_fee:auction_house',
      model: 'percentage' as const,
      value: 100,
      description: 'Bault commission on an auction-house consignment sale',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'consignment_fee:ebay_partner',
      model: 'percentage' as const,
      value: 100,
      description: 'Bault commission on an eBay partner consignment sale',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:psa_value',
      model: 'fixed' as const,
      value: 2500,
      description: 'PSA Value — up to $499, 45–65 days',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:psa_regular',
      model: 'fixed' as const,
      value: 7500,
      description: 'PSA Regular — up to $1,499, 20–30 days',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:psa_express',
      model: 'fixed' as const,
      value: 15000,
      description: 'PSA Express — up to $4,999, 10–15 days',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:psa_walkthrough',
      model: 'fixed' as const,
      value: 30000,
      description: 'PSA Walkthrough — no ceiling, 5–10 days, needs approval',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'grading_fee:bgs_standard',
      model: 'fixed' as const,
      value: 6500,
      description: 'BGS Standard — up to $1,499, 25–40 days',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'service_fee:video_review',
      model: 'fixed' as const,
      value: 1000,
      description: 'A short video of the card turned under a light',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'service_fee:condition_inspection',
      model: 'fixed' as const,
      value: 1500,
      description: 'Per-area condition report against a fixed severity scale',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'service_fee:deslab',
      model: 'fixed' as const,
      value: 500,
      description: 'Cracking a graded card out of its holder. Irreversible.',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'shipping_rush',
      model: 'fixed' as const,
      value: 1000,
      description: 'Same-day picking and packing, ahead of the standard queue',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'shipping_addon:gps_tracker',
      model: 'fixed' as const,
      value: 3000,
      description: 'GPS tracker placed in the parcel; handed over after delivery',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'cash_out_fee',
      model: 'percentage' as const,
      value: 100,
      description: 'Cash-out fee: 6% (min $0.99) under $100, otherwise $5.00 + 1%',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'chargeback_fee',
      model: 'fixed' as const,
      value: 2500,
      description: 'Handling fee when a card payment into your wallet is reversed',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'escrow_fee',
      model: 'percentage' as const,
      value: 100,
      description: 'Middleman fee on a private deal, 1% of the agreed value',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'white_glove:domestic',
      model: 'fixed' as const,
      value: 100000,
      description: 'Hand delivery within the United States, before travel',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'white_glove:international',
      model: 'fixed' as const,
      value: 150000,
      description: 'Hand delivery outside the United States, before travel',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'show_pickup',
      model: 'fixed' as const,
      value: 1500,
      description: 'Collect your cards in person at a show Bault is attending',
      billingTrigger: 'per_event' as const,
    },
    ...MEMBERSHIP_TIERS.map((t) => ({
      actionType: t.feeActionType,
      model: 'fixed' as const,
      value: t.listPriceMinor,
      description: `${t.key[0]!.toUpperCase()}${t.key.slice(1)} membership — storage for ${t.storedItems} items, ${t.perCycle.intake} intakes a month`,
      billingTrigger: 'monthly' as const,
      parameters: {
        storedItems: t.storedItems,
        insuredShipments: t.insuredShipments,
        insuredValueCapMinor: t.insuredValueCapMinor,
        postageCreditMinor: t.postageCreditMinor,
        commissionWaivedOnMinor: t.commissionWaivedOnMinor,
      },
    })),
    {
      actionType: 'parcel_processing',
      model: 'fixed' as const,
      value: 200,
      description: 'Per-package fee for receiving, opening and cataloguing a parcel',
      billingTrigger: 'per_event' as const,
    },
    {
      actionType: 'parcel_forwarding',
      model: 'fixed' as const,
      value: 400,
      description: 'Second leg, charged only to parcels sent to a forwarding address',
      billingTrigger: 'per_event' as const,
    },
  ];
  for (const r of rules) {
    await db.insert(pricingRule).values({ ...r, currency: CUR, updatedBy: eldar });
  }

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
        salesTaxBps: 663,
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

  const INTAKE = 500;
  const SERVICE = 2000;
  const SHIP = 3500;
  const MEGA_SALE = 26_000;
  const FEE = 1_300;
  const GOLD_STAR_ASK = 320_000;
  const GOLD_STAR_OFFER = 275_000;
  const TOPUP = 500_000;
  const WITHDRAW = 100_000;

  const ledger = (userId: string, type: string, amount: number, direction: 'debit' | 'credit', refType: string, refId: string) =>
    db.insert(ledgerRecord).values({ userId, type: type as never, amount, direction, currency: CUR, referenceType: refType, referenceId: refId });

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

  const transfer = (itemId: string, fromBinId: string | null, toBinId: string, actorId: string, reason: string) =>
    db.insert(binTransfer).values({ itemId, fromBinId, toBinId, actorId, reason });

  const img = (itemId: string, type: 'intake' | 'professional', version: number, objectKey: string) =>
    db.insert(itemImage).values({ itemId, type, version, objectKey });

  await topup(red, TOPUP);
  await topup(golden, TOPUP);

  const rayDragon = await mkItem({
    ownerId: red, serialNumber: 'SN-DR97-0001', barcode: 'SN-DR97-0001',
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

  const goldenBatch = one(await db.insert(batch).values({ ownerId: golden, status: 'split' }).returning({ id: batch.id })).id;

  const rayDeoxys = await mkItem({
    ownerId: golden, serialNumber: 'SN-DX102-0002', barcode: 'SN-DX102-0002',
    typeClass: 'trading_card',
    description: '2005 Pokémon EX Deoxys — Rayquaza ex #102/107 · Rare Holo EX · art by Shin-ichi Yoshikawa · ex8-102',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binA2, sourceBatchId: goldenBatch,
  });
  await custody({ itemId: rayDeoxys, eventType: 'batch_split', newOwnerId: golden, newBinId: binA2, newState: 'stored', actorId: hermon, reason: 'batch_split' });
  await transfer(rayDeoxys, null, binA2, hermon, 'batch_split');
  await img(rayDeoxys, 'intake', 1, 'images/sn-dx102-0002-intake.jpg');
  await bill(golden, 'intake', INTAKE, rayDeoxys);

  const rayGoldStar = await mkItem({
    ownerId: red, serialNumber: 'SN-DX107-0003', barcode: 'SN-DX107-0003',
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

  const rayDelta = await mkItem({
    ownerId: golden, serialNumber: 'SN-DF97-0004', barcode: 'SN-DF97-0004',
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
    typeFields: { gradingBody: 'PSA', targetGrade: 'PSA 10', submittedAt: new Date().toISOString() },
  });
  await bill(golden, 'service', SERVICE, rayDelta);

  const rayLegends = await mkItem({
    ownerId: red, serialNumber: 'SN-CL10-0005', barcode: 'SN-CL10-0005',
    typeClass: 'trading_card',
    description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo (Shiny Legendary subset) · art by Noriko Hotta · col1-SL10',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binA1,
  });
  await custody({ itemId: rayLegends, eventType: 'intake', newOwnerId: red, newBinId: binA1, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayLegends, null, binA1, hermon, 'intake');
  await img(rayLegends, 'intake', 1, 'images/sn-cl10-0005-intake.jpg');
  await bill(red, 'intake', INTAKE, rayLegends);

  const rayLevelX = await mkItem({
    ownerId: golden, serialNumber: 'SN-SV146-0006', barcode: 'SN-SV146-0006',
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
    estimatedDeliveryAt: new Date(Date.now() + 86_400_000),
    packageWeightGrams: 120,
    fulfillmentNotes: 'Single card, top-loader in a team bag, rigid mailer.',
    fulfillment: { carrier: 'DHL', packageWeightGrams: 120, verifiedItemIds: [rayLevelX], notes: 'Single card, top-loader in a team bag, rigid mailer.' },
    fulfilledBy: hermon,
    fulfilledAt: new Date(),
  });
  await bill(golden, 'shipping', SHIP, rayLevelX);

  const rayFullArt = await mkItem({
    ownerId: golden, serialNumber: 'SN-ROS104-0007', barcode: 'SN-ROS104-0007',
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

  const rayMega = await mkItem({
    ownerId: red, serialNumber: 'SN-ROS105-0008', barcode: 'SN-ROS105-0008',
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
  await db.insert(itemChangeHistory).values({ itemId: rayMega, actorId: hermon, field: 'conditionGrade', oldValue: 'Near Mint', newValue: 'Raw' });

  await db.insert(houseListing).values([
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo (Shiny Legendary subset) · art by Noriko Hotta · col1-SL10',
      conditionGrade: 'Raw', photoRef: 'SN-CL10-0005', askingPrice: 3_500, currency: CUR, stock: 3, createdBy: eldar,
    },
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2015 Pokémon XY Roaring Skies — Rayquaza-EX (Full Art) #104/108 · Rare Ultra · art by Ryo Ueda · xy6-104',
      conditionGrade: 'Raw', photoRef: 'SN-ROS104-0007', askingPrice: 4_900, currency: CUR, stock: 2, createdBy: eldar,
    },
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2006 Pokémon EX Dragon Frontiers — Rayquaza ex δ (Delta Species) #97/101 · Rare Holo EX · art by Ryo Ueda · ex15-97',
      conditionGrade: 'Raw', photoRef: 'SN-DF97-0004', askingPrice: 16_500, currency: CUR, stock: 1, createdBy: eldar,
    },
  ]);

  await db.insert(swapProposal).values({
    proposerId: red, responderId: golden, offeredItemIds: [rayLegends], requestedItemIds: [rayDeoxys],
    proposerApproved: true, responderApproved: false, status: 'pending',
  });

  const w = one(
    await db.insert(withdrawal).values({ userId: golden, destinationAccount: '••••1234', amount: WITHDRAW, currency: CUR, status: 'paid', confirmedAt: new Date() }).returning({ id: withdrawal.id }),
  ).id;
  await ledger(golden, 'withdrawal', WITHDRAW, 'debit', 'withdrawal', w);

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

  const cashInSubmitted = one(
    await db
      .insert(walletRequest)
      .values({
        code: prefixedId('WR'),
        userId: red,
        type: 'cash_in',
        status: 'submitted',
        amount: 25_000,
        currency: CUR,
        fundingSource: 'bank_transfer',
        reference: 'Wire ref 8842-A',
        notes: 'Funding the M Rayquaza-EX purchase.',
      })
      .returning({ id: walletRequest.id }),
  ).id;
  await walletEvent(cashInSubmitted, 'submitted', null, red, 'user');

  const cashOutProcessing = one(
    await db
      .insert(walletRequest)
      .values({
        code: prefixedId('WR'),
        userId: golden,
        type: 'cash_out',
        status: 'processing',
        amount: 12_500,
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

  const cashOutRejected = one(
    await db
      .insert(walletRequest)
      .values({
        code: prefixedId('WR'),
        userId: red,
        type: 'cash_out',
        status: 'rejected',
        amount: 300_000,
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

  await db.insert(dispute).values({
    code: prefixedId(ID_PREFIX.dispute),
    transactionId: saleTxn,
    openedBy: eldar,
    assignedAdminId: eldar,
    status: 'investigating',
    note: 'Buyer reports the card arrived with a nicked corner not shown in the listing photo.',
  });

  const goldStarName = '2005 Pokémon EX Deoxys Rayquaza ★ (Gold Star) #107/107';
  await db.insert(auditRecord).values([
    { actorId: hermon, action: 'POST /api/v1/intake/items', targetEntity: 'item', targetId: rayDragon },
    { actorId: red, action: 'POST /api/v1/marketplace/listings', targetEntity: 'listing', targetId: goldStarListing },
    { actorId: red, action: 'POST /api/v1/marketplace/listings/:id/purchase', targetEntity: 'transaction', targetId: saleTxn },
  ]);
  await db.insert(outboxMessage).values([
    { aggregateType: 'item', aggregateId: rayDragon, eventType: 'item_received', payload: { itemId: rayDragon, ownerId: red, barcode: 'SN-DR97-0001' } },
    {
      aggregateType: 'listing',
      aggregateId: goldStarListing,
      eventType: 'offer_received',
      payload: { listingId: goldStarListing, sellerId: red, amount: GOLD_STAR_OFFER, itemId: rayGoldStar, barcode: 'SN-DX107-0003', itemDescription: goldStarName },
    },
  ]);

  await db.insert(notification).values([
    {
      userId: red,
      eventType: 'item_received',
      content: {
        itemId: rayDragon,
        barcode: 'SN-DR97-0001',
        message: 'Item SN-DR97-0001 was received into your vault and shelved.',
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
        barcode: 'SN-DX102-0002',
        message: 'Item SN-DX102-0002 was received into your vault and shelved.',
      },
    },
  ]);
  await db.insert(notificationPreference).values({ userId: golden, eventType: 'hold_placed', enabled: false });

  await db.insert(shippingAddress).values([
    { userId: red, label: 'Home', recipient: 'Red Ashwood', line1: '1200 Market St', city: 'San Francisco', region: 'CA', country: 'US', postalCode: '94102', isDefault: true },
    { userId: golden, label: 'Home', recipient: 'Golden Marsh', line1: '55 Wall St', city: 'New York', region: 'NY', country: 'US', postalCode: '10005', isDefault: true },
    { userId: veteran, label: 'Home', recipient: 'Ana Maria van der Berg', line1: 'Keizersgracht 12', city: 'Amsterdam', country: 'NL', postalCode: '1015 CS', isDefault: true },
  ]);

  const days = (n: number) => new Date(Date.now() + n * 86_400_000);
  const minutes = (n: number) => new Date(Date.now() - n * 60_000);
  await db.insert(consignmentEvent).values([
    {
      name: 'Philly Non-Sports Card Show',
      venue: 'Greater Philadelphia Expo Center',
      city: 'Oaks, PA',
      startsAt: days(28),
      endsAt: days(30),
      requestDeadline: days(21),
      capacity: 40,
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
      pickupEnabled: false,
      notes: 'Consignment only at this one.',
    },
  ]);


  const rayAltArt = await mkItem({
    ownerId: platform, serialNumber: 'SN-EVS194-0009', barcode: 'SN-EVS194-0009',
    typeClass: 'trading_card',
    description: '2021 Pokémon SWSH Evolving Skies — Rayquaza V (Alternate Full Art) #194/203 · Rare Ultra · art by Ryuta Fuse · swsh7-194',
    conditionGrade: 'Raw', lifecycleState: 'donated', binId: binB1,
  });
  await custody({ itemId: rayAltArt, eventType: 'intake', newOwnerId: red, newBinId: binB1, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(rayAltArt, null, binB1, hermon, 'intake');
  await img(rayAltArt, 'intake', 1, 'images/sn-evs194-0009-intake.jpg');
  await bill(red, 'intake', INTAKE, rayAltArt);
  await db.insert(serviceRequest).values({
    code: prefixedId(ID_PREFIX.serviceRequest),
    type: 'donation', requesterId: red, itemId: rayAltArt, status: 'completed',
    typeFields: { note: 'For the youth league raffle. No conditions.' },
    fulfillment: { recipient: 'Bault platform custodian', notes: 'Accepted for the youth-league raffle. Ownership moved; the card stays on shelf B until the raffle van goes.' },
    fulfilledBy: eldar,
    fulfilledAt: minutes(4_320),
  });
  await custody({
    itemId: rayAltArt, eventType: 'ownership_transfer', prevOwnerId: red, newOwnerId: platform,
    actorId: eldar, reason: 'donation',
  });
  await custody({
    itemId: rayAltArt, eventType: 'state_change', prevState: 'stored', newState: 'donated',
    actorId: eldar, reason: 'donated',
  });

  await db.update(item).set({ holdFlag: true }).where(eq(item.id, rayMega));
  await custody({
    itemId: rayMega, eventType: 'hold_placed', actorId: eldar,
    reason: 'Dispute opened on the sale: sold as Near Mint, received Raw. Held until the dispute closes.',
  });

  const danaAcc = await mkUser('dana@bault.dev', 'dana', 'user', 'Dana', 'Okonkwo');
  const dana = danaAcc.id;
  await db.update(userAccount).set({ status: 'suspended' }).where(eq(userAccount.id, dana));

  const mkTicket = async (v: {
    userId: string;
    category: 'parcel' | 'shipment' | 'item' | 'billing' | 'account' | 'private_sale' | 'other';
    subject: string;
    status: 'open' | 'awaiting_customer' | 'resolved';
    assignedTo?: string;
    relatedType?: string;
    relatedId?: string;
    messages: { author: string; role: 'customer' | 'staff'; body: string; minutesAgo: number }[];
  }) => {
    const newest = Math.min(...v.messages.map((m) => m.minutesAgo));
    const ticketId = one(
      await db
        .insert(supportTicket)
        .values({
          code: prefixedId(ID_PREFIX.ticket),
          userId: v.userId,
          category: v.category,
          subject: v.subject,
          status: v.status,
          assignedTo: v.assignedTo ?? null,
          relatedType: v.relatedType ?? null,
          relatedId: v.relatedId ?? null,
          lastMessageAt: minutes(newest),
          resolvedAt: v.status === 'resolved' ? minutes(newest) : null,
          resolvedBy: v.status === 'resolved' ? (v.assignedTo ?? hermon) : null,
        })
        .returning({ id: supportTicket.id }),
    ).id;
    await db.insert(supportMessage).values(
      v.messages.map((m) => ({
        ticketId,
        authorId: m.author,
        authorRole: m.role,
        body: m.body,
        createdAt: minutes(m.minutesAgo),
      })),
    );
    return ticketId;
  };

  await mkTicket({
    userId: dana,
    category: 'account',
    subject: 'My account is suspended and I cannot cash in to clear it',
    status: 'open',
    messages: [
      {
        author: dana, role: 'customer', minutesAgo: 90,
        body: 'I got the email saying my account is suspended for unpaid storage. I want to pay it, but the wallet will not open. What do I do?',
      },
    ],
  });

  await mkTicket({
    userId: red,
    category: 'item',
    subject: 'M Rayquaza-EX arrived as Raw, not Near Mint',
    status: 'awaiting_customer',
    assignedTo: hermon,
    relatedType: 'item',
    relatedId: rayMega,
    messages: [
      {
        author: red, role: 'customer', minutesAgo: 2880,
        body: 'The listing said Near Mint. The card that landed has soft corners and a print line through the holo. I have opened a dispute.',
      },
      {
        author: hermon, role: 'staff', minutesAgo: 2760,
        body: 'Thanks — the card is held and will not move while the dispute is open. Our intake photographs are on the item page; the corner is visible in the arrival shot. Would you like us to send it for a third-party grade, at our cost, before anybody decides anything?',
      },
    ],
  });

  await mkTicket({
    userId: golden,
    category: 'billing',
    subject: 'What is the $5.00 charge on 5 September?',
    status: 'resolved',
    assignedTo: eldar,
    messages: [
      { author: golden, role: 'customer', minutesAgo: 14_400, body: 'There is a $5.00 debit I do not recognise.' },
      {
        author: eldar, role: 'staff', minutesAgo: 14_280,
        body: 'That is the intake fee for the Roaring Skies Rayquaza-EX, charged when it was booked in. Open the ledger line and it names the pricing rule and the version that was in force that day.',
      },
      { author: golden, role: 'customer', minutesAgo: 14_220, body: 'Understood, thank you.' },
    ],
  });

  const mkParcel = async (v: {
    ownerId: string | null;
    addressedTo: string;
    status: 'expected' | 'received' | 'unclaimed';
    carrier?: string;
    trackingNumber?: string;
    declaredContents?: string;
    internationalOrigin?: boolean;
    expectedAt?: Date;
    receivedAt?: Date;
    unclaimedAt?: Date;
    receivedBy?: string;
    notes?: string;
    events: { type: string; from?: string; to?: string; actor?: string; notes: string; at: Date }[];
  }) => {
    const row = one(
      await db
        .insert(parcel)
        .values({
          code: prefixedId(ID_PREFIX.parcel),
          ownerId: v.ownerId,
          addressedTo: v.addressedTo,
          facilityId: njFacility,
          status: v.status,
          carrier: v.carrier ?? null,
          trackingNumber: v.trackingNumber ?? null,
          declaredContents: v.declaredContents ?? null,
          internationalOrigin: v.internationalOrigin ?? false,
          expectedAt: v.expectedAt ?? null,
          receivedAt: v.receivedAt ?? null,
          unclaimedAt: v.unclaimedAt ?? null,
          receivedBy: v.receivedBy ?? null,
          notes: v.notes ?? null,
        })
        .returning({ id: parcel.id, code: parcel.code }),
    );
    await db.insert(parcelEvent).values(
      v.events.map((e) => ({
        parcelId: row.id,
        eventType: e.type,
        fromStatus: e.from ?? null,
        toStatus: e.to ?? null,
        actorId: e.actor ?? null,
        facilityId: njFacility,
        notes: e.notes,
        occurredAt: e.at,
      })),
    );
    return row;
  };

  await mkParcel({
    ownerId: red,
    addressedTo: 'red',
    status: 'expected',
    carrier: 'USPS',
    trackingNumber: '9400100000000000000001',
    declaredContents: 'Two raw Rayquaza singles from a private sale, top-loaders in a bubble mailer.',
    expectedAt: days(2),
    events: [
      { type: 'registered', to: 'expected', notes: 'Registered by the collector before dispatch.', at: minutes(600) },
    ],
  });

  await mkParcel({
    ownerId: golden,
    addressedTo: 'golden',
    status: 'received',
    carrier: 'DHL',
    trackingNumber: 'JD0140000000000001',
    declaredContents: 'One sealed booster box.',
    internationalOrigin: true,
    receivedAt: minutes(45),
    receivedBy: hermon,
    events: [
      { type: 'registered', to: 'expected', notes: 'Registered by the collector before dispatch.', at: days(-4) },
      { type: 'received', from: 'expected', to: 'received', actor: hermon, notes: 'Signed for at the NJ dock. Outer carton sound, tape intact.', at: minutes(45) },
    ],
  });

  await mkParcel({
    ownerId: null,
    addressedTo: 'r.ashwod',
    status: 'unclaimed',
    carrier: 'UPS',
    trackingNumber: '1Z999AA10123456784',
    receivedAt: days(-6),
    receivedBy: hermon,
    unclaimedAt: days(-6),
    notes: 'Handwritten label, no return address, no phone number. Held unopened.',
    events: [
      { type: 'received', to: 'received', actor: hermon, notes: 'Arrived with no resolvable recipient.', at: days(-6) },
      { type: 'unclaimed', from: 'received', to: 'unclaimed', actor: hermon, notes: 'Addressed to "r.ashwod", which is not an account. Holding period started; box not opened.', at: days(-6) },
    ],
  });

  await db.insert(arrivalDisposal).values({
    code: prefixedId(ID_PREFIX.disposal),
    ownerId: red,
    category: 'lithium_battery',
    outcome: 'destroyed',
    description: 'A 3.7 V lithium pouch cell packed loose beside the cards, taped to the inner flap.',
    notes:
      'Refused at the arrival check. Carrier and facility both prohibit loose cells. Photographed, removed to the battery bin, cards booked in normally. The collector was notified the same day.',
    actorId: hermon,
    occurredAt: days(-9),
  });

  await db.insert(serviceRequest).values([
    {
      code: prefixedId(ID_PREFIX.serviceRequest),
      type: 'custom', requesterId: red, itemId: rayGoldStar, status: 'requested',
      typeFields: {
        stage: 'awaiting_quote',
        summary: 'Sleeve and double-boot before it goes to the show',
        detail:
          'If the Gold Star travels to Philly I want it in a perfect-fit sleeve inside a semi-rigid, not just a top-loader. Can you do that before it goes on the van?',
      },
    },
    {
      code: prefixedId(ID_PREFIX.serviceRequest),
      type: 'custom', requesterId: red, itemId: rayLegends, status: 'in_progress',
      typeFields: {
        stage: 'quoted',
        summary: 'Photograph the back under raking light',
        detail:
          'The back looks like it has a surface scratch under the right kind of light. Before I decide about grading I want a photograph that shows it, or shows that it is not there.',
        priceMinor: 1_800,
        scope:
          'Two additional photographs of the reverse under raking light at 30° and 60°, added to the item as a new professional version. No handling out of the sleeve.',
        quotedBy: hermon,
        quotedAt: minutes(300).toISOString(),
      },
    },
    {
      code: prefixedId(ID_PREFIX.serviceRequest),
      type: 'custom', requesterId: golden, itemId: rayDeoxys, status: 'completed',
      typeFields: {
        stage: 'done',
        summary: 'Weigh the sealed box and record it',
        detail:
          'Before it goes into storage I want the sealed weight on record, in case anyone ever asks whether it was opened.',
        priceMinor: 900,
        scope: 'Weigh on the calibrated bench scale to 1 g, photograph the display, record the figure on the item.',
        quotedBy: hermon,
        quotedAt: minutes(9_000).toISOString(),
        acceptedAt: minutes(8_940).toISOString(),
      },
      fulfillment: { weightGrams: 1_042, notes: 'Weighed twice on the bench scale, 1 042 g both times. Photograph of the display attached.' },
      fulfilledBy: hermon,
      fulfilledAt: minutes(8_800),
    },
  ]);

  const DEAL_VALUE = 145_000;
  const DEAL_FEE = 2_500;
  const deal = one(
    await db
      .insert(escrowDeal)
      .values({
        code: prefixedId(ID_PREFIX.escrow),
        raisedBy: golden,
        raiserRole: 'seller',
        counterpartyUserId: red,
        description:
          'A second copy of the 2003 Pokémon EX Dragon — Rayquaza ex #97/97 · Rare Holo EX · art by Hikaru Koike · ex3-97. Raw, described as Near Mint: centred front, no whitening on the back edges.',
        valueMinor: DEAL_VALUE,
        currency: CUR,
        feeMinor: DEAL_FEE,
        status: 'inspecting',
        settlement: 'buyer_vault',
        fundingSource: 'wallet',
        fundedAt: days(-3),
        fundingAttestedBy: eldar,
        fundingReference: 'Wallet hold against Red Ashwood',
        itemReceivedAt: days(-1),
      })
      .returning({ id: escrowDeal.id }),
  ).id;
  await db.insert(escrowEvent).values([
    { dealId: deal, eventType: 'raised', toStatus: 'proposed', actorId: golden, notes: 'Seller raised the deal.', occurredAt: days(-6) },
    { dealId: deal, eventType: 'agreed', fromStatus: 'proposed', toStatus: 'agreed', actorId: red, notes: 'Buyer agreed to the description and the value.', occurredAt: days(-5) },
    { dealId: deal, eventType: 'funded', fromStatus: 'agreed', toStatus: 'funded', actorId: eldar, notes: 'Held from the buyer wallet. The amount has left the spendable balance.', occurredAt: days(-3) },
    { dealId: deal, eventType: 'item_received', fromStatus: 'funded', toStatus: 'inspecting', actorId: hermon, notes: 'Card received at NJ and logged in. Inspection opens against the written description.', occurredAt: days(-1) },
  ]);

  // ---- More cards: two more vaults (noam's and eldar's), and the marketplace ----
  //
  // The ten photographs in assets/images are the whole catalogue, and nine of them are already someone's. A further
  // copy of a card is its serial with a copy number after it (SN-DR97-0001-C2), and is shown with the card's
  // photograph (catalogueSerial, in the web app). Each of the two keeps two copies in the vault and has two for sale.
  const noamAcc = await mkUser('noam@bault.dev', 'noam', 'user', 'Noam', null);
  const noam = noamAcc.id;
  await topup(noam, TOPUP);
  await topup(eldar, TOPUP);

  const shelve = async (itemId: string, ownerId: string, binId: string, serial: string) => {
    await custody({ itemId, eventType: 'intake', newOwnerId: ownerId, newBinId: binId, newState: 'stored', actorId: hermon, reason: 'intake' });
    await transfer(itemId, null, binId, hermon, 'intake');
    await img(itemId, 'intake', 1, `images/${serial.toLowerCase()}-intake.jpg`);
    await bill(ownerId, 'intake', INTAKE, itemId);
  };
  const listForSale = async (itemId: string, sellerId: string, askingPrice: number) => {
    await custody({ itemId, eventType: 'state_change', prevState: 'stored', newState: 'listed', actorId: sellerId, reason: 'listed for sale' });
    await db.insert(listing).values({ itemId, sellerId, askingPrice, currency: CUR, status: 'active' });
  };

  const noamDragon = await mkItem({
    ownerId: noam, serialNumber: 'SN-DR97-0001-C2', barcode: 'SN-DR97-0001-C2',
    typeClass: 'trading_card',
    description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97 · Rare Holo EX · art by Hikaru Koike · ex3-97',
    conditionGrade: 'Near Mint', lifecycleState: 'stored', binId: binA1,
  });
  await shelve(noamDragon, noam, binA1, 'SN-DR97-0001-C2');

  const noamLegends = await mkItem({
    ownerId: noam, serialNumber: 'SN-CL10-0005-C2', barcode: 'SN-CL10-0005-C2',
    typeClass: 'trading_card',
    description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo (Shiny Legendary subset) · art by Noriko Hotta · col1-SL10',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binB1,
  });
  await shelve(noamLegends, noam, binB1, 'SN-CL10-0005-C2');

  const noamFullArt = await mkItem({
    ownerId: noam, serialNumber: 'SN-ROS104-0007-C2', barcode: 'SN-ROS104-0007-C2',
    typeClass: 'trading_card',
    description: '2015 Pokémon XY Roaring Skies — Rayquaza-EX (Full Art) #104/108 · Rare Ultra · art by Ryo Ueda · xy6-104',
    conditionGrade: 'Near Mint', lifecycleState: 'listed', binId: binB2,
  });
  await shelve(noamFullArt, noam, binB2, 'SN-ROS104-0007-C2');
  await listForSale(noamFullArt, noam, 8_500);

  const noamLevelX = await mkItem({
    ownerId: noam, serialNumber: 'SN-SV146-0006-C2', barcode: 'SN-SV146-0006-C2',
    typeClass: 'trading_card',
    description: '2009 Pokémon Supreme Victors — Rayquaza C LV.X #146/147 · Rare Holo LV.X (Pokémon SP) · art by Shizurow · pl3-146',
    conditionGrade: 'Raw', lifecycleState: 'listed', binId: binA2,
  });
  await shelve(noamLevelX, noam, binA2, 'SN-SV146-0006-C2');
  await listForSale(noamLevelX, noam, 4_200);

  const eldarDeoxys = await mkItem({
    ownerId: eldar, serialNumber: 'SN-DX102-0002-C2', barcode: 'SN-DX102-0002-C2',
    typeClass: 'trading_card',
    description: '2005 Pokémon EX Deoxys — Rayquaza ex #102/107 · Rare Holo EX · art by Shin-ichi Yoshikawa · ex8-102',
    conditionGrade: 'Near Mint', lifecycleState: 'stored', binId: binA2,
  });
  await shelve(eldarDeoxys, eldar, binA2, 'SN-DX102-0002-C2');

  const eldarDelta = await mkItem({
    ownerId: eldar, serialNumber: 'SN-DF97-0004-C2', barcode: 'SN-DF97-0004-C2',
    typeClass: 'trading_card',
    description: '2006 Pokémon EX Dragon Frontiers — Rayquaza ex δ (Delta Species) #97/101 · Rare Holo EX · art by Ryo Ueda · ex15-97',
    conditionGrade: 'Raw', lifecycleState: 'stored', binId: binB1,
  });
  await shelve(eldarDelta, eldar, binB1, 'SN-DF97-0004-C2');

  const eldarMega = await mkItem({
    ownerId: eldar, serialNumber: 'SN-ROS105-0008-C2', barcode: 'SN-ROS105-0008-C2',
    typeClass: 'trading_card',
    description: '2015 Pokémon XY Roaring Skies — M Rayquaza-EX (Full Art, Δ Evolution) #105/108 · Rare Ultra · art by 5ban Graphics · xy6-105',
    conditionGrade: 'Near Mint', lifecycleState: 'listed', binId: binB2,
  });
  await shelve(eldarMega, eldar, binB2, 'SN-ROS105-0008-C2');
  await listForSale(eldarMega, eldar, 24_000);

  const eldarAltArt = await mkItem({
    ownerId: eldar, serialNumber: 'SN-EVS194-0009-C2', barcode: 'SN-EVS194-0009-C2',
    typeClass: 'trading_card',
    description: '2021 Pokémon SWSH Evolving Skies — Rayquaza V (Alternate Full Art) #194/203 · Rare Ultra · art by Ryuta Fuse · swsh7-194',
    conditionGrade: 'Near Mint', lifecycleState: 'listed', binId: binA1,
  });
  await shelve(eldarAltArt, eldar, binA1, 'SN-EVS194-0009-C2');
  await listForSale(eldarAltArt, eldar, 12_500);

  // The store's own stock, for the cards it has no listing for yet: the photographs are the catalogue's.
  await db.insert(houseListing).values([
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97 · Rare Holo EX · art by Hikaru Koike · ex3-97',
      conditionGrade: 'Raw', photoRef: 'SN-DR97-0001', askingPrice: 39_500, currency: CUR, stock: 1, createdBy: eldar,
    },
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2005 Pokémon EX Deoxys — Rayquaza ex #102/107 · Rare Holo EX · art by Shin-ichi Yoshikawa · ex8-102',
      conditionGrade: 'Raw', photoRef: 'SN-DX102-0002', askingPrice: 6_200, currency: CUR, stock: 2, createdBy: eldar,
    },
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2009 Pokémon Supreme Victors — Rayquaza C LV.X #146/147 · Rare Holo LV.X (Pokémon SP) · art by Shizurow · pl3-146',
      conditionGrade: 'Raw', photoRef: 'SN-SV146-0006', askingPrice: 4_800, currency: CUR, stock: 3, createdBy: eldar,
    },
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2015 Pokémon XY Roaring Skies — M Rayquaza-EX (Full Art, Δ Evolution) #105/108 · Rare Ultra · art by 5ban Graphics · xy6-105',
      conditionGrade: 'Raw', photoRef: 'SN-ROS105-0008', askingPrice: 21_000, currency: CUR, stock: 2, createdBy: eldar,
    },
    {
      code: prefixedId(ID_PREFIX.houseListing), typeClass: 'trading_card',
      description: '2021 Pokémon SWSH Evolving Skies — Rayquaza VMAX (Alternate Art secret) #218/203 · Rare Rainbow · art by Anesaki Dynamic · swsh7-218',
      conditionGrade: 'Raw', photoRef: 'SN-EVS218-0010', askingPrice: 64_000, currency: CUR, stock: 1, createdBy: eldar,
    },
  ]);

  await pool.end();
  // eslint-disable-next-line no-console
  console.log(
    '✔ seed complete: 8 users (1 suspended), 6 bins (4 standard, 2 oversized), 17 items (4 Red / 4 Golden / 4 Noam / 4 Eldar / 1 donated to the custodian), ' +
      '1 batch, 6 listings, 8 store products, 1 offer, 1 swap, 1 transaction, 1 dispute, 7 service requests, 1 shipment, ' +
      '1 withdrawal, 4 wallet requests, 3 notifications, 2 addresses, 2 shows, 3 support tickets, ' +
      '3 parcels, 1 arrival disposal, 1 escrow deal.',
  );
  // eslint-disable-next-line no-console
  console.log(
    `  usernames — ${redAcc.username} · ${goldenAcc.username} · ${hermonAcc.username} · ${eldarAcc.username} · ${veteranAcc.username} · ${noamAcc.username}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    '  intake IDs are retired: only "veteran" carries one, so the pre-printed-label fallback stays exercised.',
  );
  console.log(
    '  states seeded for the interface — every one of these had no data before:\n' +
      '    FROZEN    SN-ROS105-0008, held while the sale dispute runs\n' +
      '    DEPARTED  SN-EVS194-0009, donated away; history intact, nothing deleted\n' +
      '    SUSPENDED dana@bault.dev — signs in, reaches the helpdesk and nothing else\n' +
      '    PARCELS   one expected, one unopened on the bench, one addressed to nobody\n' +
      '    REFUSED   a lithium cell, destroyed and recorded\n' +
      '    CUSTOM    one request at each of the three steps\n' +
      '    ESCROW    one deal stopped at the inspection gate\n' +
      '    COPIES    SN-…-C2 is a second copy of the card whose photograph SN-… is: noam and eldar keep two and sell two each',
  );
  console.log(
    '  NOT seeded (intake test material, photos already on disk):\n' +
      '    SN-EVS218-0010  2021 Evolving Skies Rayquaza VMAX (Alt Art secret) #218/203',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed failed', err);
  process.exit(1);
});
