import * as argon2 from 'argon2';
import { createDb } from './client';
import { userAccount } from '../modules/acc/acc.schema';
import { item, bin, itemImage, custodyEvent, itemChangeHistory, binTransfer, batch } from '../modules/cst/cst.schema';
import { listing, transaction, offer, swapProposal } from '../modules/mkt/mkt.schema';
import { ledgerRecord, externalPayment, charge, withdrawal } from '../modules/pay/pay.schema';
import { pricingRule } from '../modules/prc/prc.schema';
import { serviceRequest } from '../modules/dis/dis.schema';
import { shipment } from '../modules/shp/shp.schema';
import { dispute } from '../modules/adm/adm.schema';
import { auditRecord } from '../modules/sec/audit.schema';
import { outboxMessage } from '../modules/not/outbox/outbox.schema';
import { notification, notificationPreference } from '../modules/not/notification.schema';
import { shippingAddress } from '../modules/acc/address.schema';
import { ID_PREFIX, prefixedId } from '../shared/ids';

/**
 * Seed script — realistic, internally-consistent sample data (dev only).
 *
 * RESET: TRUNCATE clears every table, INCLUDING the append-only history tables.
 * The append-only guards (0001_append_only.sql) block UPDATE/DELETE via per-ROW
 * triggers, which do NOT fire on TRUNCATE — so a full reset is possible here but
 * remains impossible through the running application. This is a deliberate,
 * dev-only escape hatch; never TRUNCATE in production.
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
    pricing_rule, service_request, shipment,
    outbox_message, audit_record, idempotency_key, confirmation_token,
    notification, notification_preference, dispute,
    storage_fee_run, shipping_address
    RESTART IDENTITY`);

  // -------------------------------------------------------------------------
  // 2. USERS — delete-all is handled by the TRUNCATE above. Password: 11111111.
  //    Roles: manager Eldar (admin), garage worker Hermon (warehouse_operator),
  //    collectors Red & Golden (user), plus the platform custodian (system).
  //    `username` is set HERE and never again — it is immutable (Requirement 4.1).
  // -------------------------------------------------------------------------
  const mkUser = async (
    email: string,
    username: string,
    role: 'user' | 'warehouse_operator' | 'admin',
    displayName: string,
  ) =>
    one(
      await db
        .insert(userAccount)
        .values({
          email,
          username,
          passwordHash: pw,
          status: 'active',
          // Owner ID for the intake context: OW- + random (Requirement 9.1).
          intakeId: prefixedId(ID_PREFIX.owner, 6),
          role,
          displayName,
        })
        .returning({ id: userAccount.id, intakeId: userAccount.intakeId }),
    );

  const eldarAcc = await mkUser('eldar@bault.dev', 'eldar', 'admin', 'Eldar');
  const hermonAcc = await mkUser('hermon@bault.dev', 'hermon', 'warehouse_operator', 'Hermon');
  const redAcc = await mkUser('red@bault.dev', 'red', 'user', 'Red');
  const goldenAcc = await mkUser('golden@bault.dev', 'golden', 'user', 'Golden');
  // Custodian that owns donated/consigned items (keeps single-owner-never-deleted true).
  const platformAcc = await mkUser('platform@bault.dev', 'platform', 'admin', 'Platform Custodian');

  const eldar = eldarAcc.id;
  const hermon = hermonAcc.id;
  const red = redAcc.id;
  const golden = goldenAcc.id;
  const platform = platformAcc.id;

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
      actionType: 'storage',
      model: 'fixed' as const,
      value: 100, // $1.00
      description: 'Daily storage fee per item held in the vault',
      billingTrigger: 'daily' as const,
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
  ];
  for (const r of rules) {
    await db.insert(pricingRule).values({ ...r, currency: CUR, updatedBy: eldar });
  }

  // -------------------------------------------------------------------------
  // 4. BINS (shelves) — BIN- prefixed barcodes (Requirement 9.3).
  // -------------------------------------------------------------------------
  const mkBin = async (barcode: string, zone: string, capacity: number) =>
    one(await db.insert(bin).values({ barcode, zone, capacity }).returning({ id: bin.id })).id;
  const binA1 = await mkBin('BIN-A-001', 'A', 50);
  const binA2 = await mkBin('BIN-A-002', 'A', 50);
  const binB1 = await mkBin('BIN-B-001', 'B', 100);
  const binB2 = await mkBin('BIN-B-002', 'B', 100);

  // -------------------------------------------------------------------------
  // Money constants (USD cents) and small helpers.
  // -------------------------------------------------------------------------
  const INTAKE = 500; // $5.00
  const SERVICE = 2000; // $20.00
  const SHIP = 3500; // $35.00
  const LEBRON = 150_000; // $1,500.00 sale price
  const FEE = 7_500; // 5% of LEBRON
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

  // (a) Charizard — Red, stored, professionally photographed (2 image versions).
  const charizard = await mkItem({
    ownerId: red, serialNumber: 'SN-CHAR-0001', barcode: 'BC-CHAR-0001',
    typeClass: 'Pokémon Card', description: '1999 Pokémon Base Set Charizard-Holo 1st Edition #4/102 · PSA cert 78359325',
    conditionGrade: 'PSA 9', lifecycleState: 'stored', binId: binA1,
  });
  await custody({ itemId: charizard, eventType: 'intake', newOwnerId: red, newBinId: binA1, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(charizard, null, binA1, hermon, 'intake');
  await img(charizard, 'intake', 1, 'images/charizard-intake.jpg');
  await bill(red, 'intake', INTAKE, charizard);
  await img(charizard, 'professional', 2, 'images/charizard-pro.jpg');
  await db.insert(serviceRequest).values({
    code: prefixedId(ID_PREFIX.serviceRequest),
    type: 'professional_photography', requesterId: red, itemId: charizard, status: 'completed',
    typeFields: { objectKey: 'images/charizard-pro.jpg', version: 2 },
    fulfillment: { objectKey: 'images/charizard-pro.jpg', shotCount: 6, lighting: 'diffused softbox', itemVerified: true, notes: 'Front and back, slab shot at 45°.' },
    fulfilledBy: hermon,
    fulfilledAt: new Date(),
  });
  await bill(red, 'service', SERVICE, charizard);

  // (b) Pikachu — Red, stored, with a corrected grade in change history.
  const pikachu = await mkItem({
    ownerId: red, serialNumber: 'SN-PIKA-0002', barcode: 'BC-PIKA-0002',
    typeClass: 'Pokémon Card', description: '1998 Pokémon Japanese Promo Pikachu Illustrator-Holo · PSA cert 83509149',
    conditionGrade: 'PSA 8', lifecycleState: 'stored', binId: binA1,
  });
  await custody({ itemId: pikachu, eventType: 'intake', newOwnerId: red, newBinId: binA1, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(pikachu, null, binA1, hermon, 'intake');
  await img(pikachu, 'intake', 1, 'images/pikachu-intake.jpg');
  await bill(red, 'intake', INTAKE, pikachu);
  await db.insert(itemChangeHistory).values({ itemId: pikachu, actorId: hermon, field: 'conditionGrade', oldValue: 'PSA 7', newValue: 'PSA 8' });

  // (c) Blue-Eyes White Dragon — Red, LISTED for sale + a pending offer from Golden.
  //     Relocated once, so the transfer ledger shows a real source → destination move.
  const blueEyes = await mkItem({
    ownerId: red, serialNumber: 'SN-BEWD-0003', barcode: 'BC-BEWD-0003',
    typeClass: 'Yu-Gi-Oh! Card', description: '2002 Yu-Gi-Oh! Legend of Blue Eyes White Dragon 1st Edition Blue-Eyes White Dragon LOB-001 · PSA cert 64400602',
    conditionGrade: 'PSA 10', lifecycleState: 'listed', binId: binB1,
  });
  await custody({ itemId: blueEyes, eventType: 'intake', newOwnerId: red, newBinId: binA2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(blueEyes, null, binA2, hermon, 'intake');
  await custody({ itemId: blueEyes, eventType: 'relocate', prevBinId: binA2, newBinId: binB1, actorId: hermon, reason: 'scan relocate' });
  await transfer(blueEyes, binA2, binB1, hermon, 'scan relocate');
  await img(blueEyes, 'intake', 1, 'images/blueeyes-intake.jpg');
  await bill(red, 'intake', INTAKE, blueEyes);
  await custody({ itemId: blueEyes, eventType: 'state_change', prevState: 'stored', newState: 'listed', actorId: red, reason: 'listed for sale' });
  const blueEyesListing = one(
    await db.insert(listing).values({ itemId: blueEyes, sellerId: red, askingPrice: 800_000, currency: CUR, status: 'active' }).returning({ id: listing.id }),
  ).id;
  await db.insert(offer).values({ listingId: blueEyesListing, buyerId: golden, amount: 700_000, currency: CUR, status: 'pending' });

  // (d) LeBron rookie — intaken by Golden, LISTED, then SOLD to Red (full sale record).
  const lebron = await mkItem({
    ownerId: red, serialNumber: 'SN-LBJ-0004', barcode: 'BC-LBJ-0004',
    typeClass: 'Basketball Card', description: '2003 Topps Chrome LeBron James Rookie Draft Pick #1 #111 · PSA cert 63359664',
    conditionGrade: 'PSA 9', lifecycleState: 'stored', binId: binB2,
  });
  await custody({ itemId: lebron, eventType: 'intake', newOwnerId: golden, newBinId: binB2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(lebron, null, binB2, hermon, 'intake');
  await img(lebron, 'intake', 1, 'images/lebron-intake.jpg');
  await bill(golden, 'intake', INTAKE, lebron);
  await custody({ itemId: lebron, eventType: 'state_change', prevState: 'stored', newState: 'listed', actorId: golden, reason: 'listed for sale' });
  const lebronListing = one(
    await db.insert(listing).values({ itemId: lebron, sellerId: golden, askingPrice: LEBRON, currency: CUR, status: 'sold' }).returning({ id: listing.id }),
  ).id;
  await custody({ itemId: lebron, eventType: 'ownership_transfer', prevOwnerId: golden, newOwnerId: red, actorId: red, reason: `sale of listing ${lebronListing}` });
  await custody({ itemId: lebron, eventType: 'state_change', prevState: 'listed', newState: 'stored', actorId: red, reason: 'sold' });
  await ledger(red, 'purchase', LEBRON, 'debit', 'listing', lebronListing);
  await ledger(golden, 'sale_credit', LEBRON, 'credit', 'listing', lebronListing);
  await ledger(golden, 'fee', FEE, 'debit', 'listing', lebronListing);
  const saleTxn = one(
    await db
      .insert(transaction)
      .values({
        code: prefixedId(ID_PREFIX.transaction),
        type: 'sale', itemIds: [lebron], buyerId: red, sellerId: golden, price: LEBRON, fee: FEE,
        frozenPricing: { model: 'percentage', value: 500, currency: CUR }, currency: CUR,
      })
      .returning({ id: transaction.id }),
  ).id;

  // (e) Luka Prizm — Red, shipped home (rush), leaves the vault. The shipment
  //     carries its SHP- Shipment ID and the operator's fulfillment record.
  const luka = await mkItem({
    ownerId: red, serialNumber: 'SN-LUKA-0005', barcode: 'BC-LUKA-0005',
    typeClass: 'Basketball Card', description: '2018 Panini Prizm Luka Dončić Rookie #280 (Dallas Mavericks) · PSA cert 42670603',
    conditionGrade: 'PSA 10', lifecycleState: 'shipped', binId: null,
  });
  await custody({ itemId: luka, eventType: 'intake', newOwnerId: red, newBinId: binB2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(luka, null, binB2, hermon, 'intake');
  await img(luka, 'intake', 1, 'images/luka-intake.jpg');
  await bill(red, 'intake', INTAKE, luka);
  await custody({ itemId: luka, eventType: 'state_change', prevState: 'stored', newState: 'shipped', actorId: hermon, reason: 'dispatched via DHL' });
  await db.insert(shipment).values({
    code: prefixedId(ID_PREFIX.shipment),
    userId: red, itemIds: [luka], destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
    carrier: 'DHL', serviceLevel: 'Express',
    rushFlag: true, cost: SHIP, currency: CUR, status: 'shipped', trackingNumber: 'SBX-SEED-0001', labelObjectKey: 'labels/luka.pdf',
    packageWeightGrams: 500,
    fulfillmentNotes: 'Single slab, bubble-wrapped, rigid mailer.',
    fulfillment: { carrier: 'DHL', packageWeightGrams: 500, verifiedItemIds: [luka], notes: 'Single slab, bubble-wrapped, rigid mailer.' },
    fulfilledBy: hermon,
    fulfilledAt: new Date(),
  });
  await bill(red, 'shipping', SHIP, luka);

  // (f) Black Lotus + (g) Mickey Mantle — arrived as a BATCH for Golden, split by Hermon.
  const goldenBatch = one(await db.insert(batch).values({ ownerId: golden, status: 'split' }).returning({ id: batch.id })).id;

  const lotus = await mkItem({
    ownerId: golden, serialNumber: 'SN-LOTUS-0006', barcode: 'BC-LOTUS-0006',
    typeClass: 'Magic: The Gathering', description: '1993 Magic: The Gathering Alpha Black Lotus (Mono Artifact, rare) · BGS cert 0016647403, subgrades 9/9/9/9',
    conditionGrade: 'BGS 9', lifecycleState: 'stored', binId: binA2, sourceBatchId: goldenBatch,
  });
  await custody({ itemId: lotus, eventType: 'batch_split', newOwnerId: golden, newBinId: binA2, newState: 'stored', actorId: hermon, reason: 'batch_split' });
  await transfer(lotus, null, binA2, hermon, 'batch_split');
  await img(lotus, 'intake', 1, 'images/lotus-intake.jpg');
  await bill(golden, 'intake', INTAKE, lotus);

  const mantle = await mkItem({
    ownerId: golden, serialNumber: 'SN-MANTLE-0007', barcode: 'BC-MANTLE-0007',
    typeClass: 'Baseball Card', description: '1952 Topps Mickey Mantle #311 (New York Yankees) · PSA cert 04005319',
    conditionGrade: 'PSA 7', lifecycleState: 'stored', binId: binB1, sourceBatchId: goldenBatch,
  });
  await custody({ itemId: mantle, eventType: 'batch_split', newOwnerId: golden, newBinId: binB1, newState: 'stored', actorId: hermon, reason: 'batch_split' });
  await transfer(mantle, null, binB1, hermon, 'batch_split');
  await img(mantle, 'intake', 1, 'images/mantle-intake.jpg');
  await bill(golden, 'intake', INTAKE, mantle);
  // Graded (completed) — grade recorded onto the item + change history, closed with
  // the operator's structured fulfillment form (Requirement 5.4).
  await db.insert(itemChangeHistory).values({ itemId: mantle, actorId: hermon, field: 'conditionGrade', oldValue: null, newValue: 'PSA 7' });
  await db.insert(serviceRequest).values({
    code: prefixedId(ID_PREFIX.serviceRequest),
    type: 'third_party_grading', requesterId: golden, itemId: mantle, status: 'completed',
    typeFields: { gradingBody: 'PSA', receivedGrade: 'PSA 7', certificateNumber: '04005319' },
    fulfillment: { grade: 'PSA 7', gradingBody: 'PSA', certificateNumber: '04005319', itemVerified: true, notes: 'Returned from PSA, slab intact.' },
    fulfilledBy: hermon,
    fulfilledAt: new Date(),
  });
  await bill(golden, 'service', SERVICE, mantle);

  // (h) Bulbasaur — Golden DONATED it → platform custodian, terminal 'donated'.
  //     The donation is recorded as a transaction like any other (Requirement 13.1).
  const bulbasaur = await mkItem({
    ownerId: platform, serialNumber: 'SN-BULBA-0008', barcode: 'BC-BULBA-0008',
    typeClass: 'Pokémon Card', description: '1999 Pokémon Base Set Shadowless Bulbasaur #44/102 · PSA cert 53135338',
    conditionGrade: 'PSA 6', lifecycleState: 'donated', binId: binA2,
  });
  await custody({ itemId: bulbasaur, eventType: 'intake', newOwnerId: golden, newBinId: binA2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(bulbasaur, null, binA2, hermon, 'intake');
  await img(bulbasaur, 'intake', 1, 'images/bulbasaur-intake.jpg');
  await bill(golden, 'intake', INTAKE, bulbasaur);
  await custody({ itemId: bulbasaur, eventType: 'ownership_transfer', prevOwnerId: golden, newOwnerId: platform, actorId: golden, reason: 'donation' });
  await custody({ itemId: bulbasaur, eventType: 'state_change', prevState: 'stored', newState: 'donated', actorId: golden, reason: 'donated' });
  const donationTxn = one(
    await db
      .insert(transaction)
      .values({
        code: prefixedId(ID_PREFIX.transaction),
        type: 'transfer', itemIds: [bulbasaur], buyerId: platform, sellerId: golden,
        price: null, fee: 0, frozenPricing: { reason: 'donation' }, currency: CUR,
      })
      .returning({ id: transaction.id }),
  ).id;
  await db.insert(serviceRequest).values({
    code: prefixedId(ID_PREFIX.serviceRequest),
    type: 'donation', requesterId: golden, itemId: bulbasaur, status: 'completed',
    typeFields: { transactionId: donationTxn },
  });
  await bill(golden, 'service', SERVICE, bulbasaur);

  // (i) A LOT — Golden's sealed box, stored and treated as ONE item until an
  //     operator runs "Break Lot" (Requirement 10.5). Note the LOT- serial.
  const boosterLot = await mkItem({
    ownerId: golden, serialNumber: 'LOT-EVO-0009', barcode: 'LOT-EVO-0009',
    typeClass: 'Pokémon Card', description: '2016 Pokémon XY Evolutions sealed booster box — 36 packs × 10 cards, factory-sealed',
    conditionGrade: 'Sealed', lifecycleState: 'stored', binId: binB2,
    isLot: true, lotSize: 36,
  });
  await custody({ itemId: boosterLot, eventType: 'intake', newOwnerId: golden, newBinId: binB2, newState: 'stored', actorId: hermon, reason: 'intake' });
  await transfer(boosterLot, null, binB2, hermon, 'intake');
  await img(boosterLot, 'intake', 1, 'images/booster-lot-intake.jpg');
  await bill(golden, 'intake', INTAKE, boosterLot);

  // -------------------------------------------------------------------------
  // 7. A pending SWAP PROPOSAL: Red offers Pikachu for Golden's Black Lotus.
  // -------------------------------------------------------------------------
  await db.insert(swapProposal).values({
    proposerId: red, responderId: golden, offeredItemIds: [pikachu], requestedItemIds: [lotus],
    proposerApproved: true, responderApproved: false, status: 'pending',
  });

  // -------------------------------------------------------------------------
  // 8. A completed WITHDRAWAL by Golden (money out).
  // -------------------------------------------------------------------------
  const w = one(
    await db.insert(withdrawal).values({ userId: golden, destinationAccount: '••••1234', amount: WITHDRAW, currency: CUR, status: 'paid', confirmedAt: new Date() }).returning({ id: withdrawal.id }),
  ).id;
  await ledger(golden, 'withdrawal', WITHDRAW, 'debit', 'withdrawal', w);

  // -------------------------------------------------------------------------
  // 9. A DISPUTE against the real LeBron sale (Requirement 13.3 — disputes always
  //    reference an actual recorded transaction, never placeholder data).
  // -------------------------------------------------------------------------
  await db.insert(dispute).values({
    code: prefixedId(ID_PREFIX.dispute),
    transactionId: saleTxn,
    openedBy: eldar,
    assignedAdminId: eldar,
    status: 'investigating',
    note: 'Buyer reports the slab arrived with a scuffed case.',
  });

  // -------------------------------------------------------------------------
  // 10. A few AUDIT records + OUTBOX messages (normally interceptor/worker-driven).
  // -------------------------------------------------------------------------
  await db.insert(auditRecord).values([
    { actorId: hermon, action: 'POST /api/v1/intake/items', targetEntity: 'item', targetId: charizard },
    { actorId: red, action: 'POST /api/v1/marketplace/listings', targetEntity: 'listing', targetId: blueEyesListing },
    { actorId: red, action: 'POST /api/v1/marketplace/listings/:id/purchase', targetEntity: 'transaction', targetId: saleTxn },
  ]);
  await db.insert(outboxMessage).values([
    { aggregateType: 'item', aggregateId: charizard, eventType: 'item_received', payload: { itemId: charizard, ownerId: red, barcode: 'BC-CHAR-0001' } },
    {
      aggregateType: 'listing',
      aggregateId: blueEyesListing,
      eventType: 'offer_received',
      payload: { listingId: blueEyesListing, sellerId: red, amount: 700_000, itemId: blueEyes, barcode: 'BC-BEWD-0003', itemDescription: '2002 Yu-Gi-Oh! LOB Blue-Eyes White Dragon 1st Edition LOB-001' },
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
        itemId: charizard,
        barcode: 'BC-CHAR-0001',
        message: 'Item BC-CHAR-0001 was received into your vault and shelved.',
      },
    },
    {
      userId: red,
      eventType: 'offer_received',
      content: {
        listingId: blueEyesListing,
        amount: 700_000,
        itemDescription: '2002 Yu-Gi-Oh! LOB Blue-Eyes White Dragon 1st Edition LOB-001',
        message:
          'You received an offer of $7,000.00 on your listing for 2002 Yu-Gi-Oh! LOB Blue-Eyes White Dragon 1st Edition LOB-001.',
      },
    },
    {
      userId: golden,
      eventType: 'item_received',
      content: {
        itemId: lotus,
        barcode: 'BC-LOTUS-0006',
        message: 'Item BC-LOTUS-0006 was received into your vault and shelved.',
      },
    },
  ]);
  // Golden opts OUT of hold_placed notifications (worker skips them on dispatch).
  await db.insert(notificationPreference).values({ userId: golden, eventType: 'hold_placed', enabled: false });

  await db.insert(shippingAddress).values([
    { userId: red, label: 'Home', recipient: 'Red', line1: '1200 Market St', city: 'San Francisco', country: 'US', postalCode: '94102', isDefault: true },
    { userId: golden, label: 'Home', recipient: 'Golden', line1: '55 Wall St', city: 'New York', country: 'US', postalCode: '10005', isDefault: true },
  ]);

  await pool.end();
  // eslint-disable-next-line no-console
  console.log(
    '✔ seed complete: 5 users, 4 bins, 9 items (1 lot), 1 batch, 2 listings, 1 offer, 1 swap, ' +
      '2 transactions, 1 dispute, 4 service requests, 1 shipment, 1 withdrawal, 3 notifications, 2 addresses.',
  );
  // eslint-disable-next-line no-console
  console.log(`  owner IDs — Red ${redAcc.intakeId} · Golden ${goldenAcc.intakeId} · Hermon ${hermonAcc.intakeId}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed failed', err);
  process.exit(1);
});
