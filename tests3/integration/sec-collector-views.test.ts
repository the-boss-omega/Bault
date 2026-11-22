import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, fundWallet, signIn, intakeFor } from '../../tests/integration/helpers/http';
import { closeDb, sql } from '../../tests/integration/helpers/db';

afterAll(closeDb);

function keysIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysIn(v, out);
    }
  }
  return out;
}

function expectWithout(body: unknown, dropped: readonly string[]) {
  const present = keysIn(body);
  expect(dropped.filter((k) => present.has(k)), 'keys a collector must not receive').toEqual([]);
}

function expectWith(body: unknown, kept: readonly string[]) {
  const present = keysIn(body);
  expect(kept.filter((k) => !present.has(k)), 'keys a collector still needs').toEqual([]);
}

async function userIdOf(client: Client): Promise<string> {
  return (await client.get('/me/profile')).body.id as string;
}

describe('A1 the vault item card a collector reads', () => {
  it('carries the card, its pictures and only the custody events of the caller’s own holding', async () => {
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const red = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector2, { description: 'Passed from Golden to Red' });
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const otherBin = bins.find((b) => b.id !== item.binId)!.id;

    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: true })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: false })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { description: 'Corrected title' })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { binId: otherBin })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { ownerId: await userIdOf(red) })).status).toBe(200);

    const res = await red.get(`/vault/items/${item.id}`);
    expect(res.status).toBe(200);
    expectWithout(res.body, [
      'ownerId',
      'binId',
      'barcode',
      'sourceBatchId',
      'sourceParcelId',
      'weightGrams',
      'updatedAt',
      'objectKey',
      'contentHash',
      'itemId',
      'actorId',
      'reason',
      'metadata',
      'prevOwnerId',
      'newOwnerId',
      'prevBinId',
      'newBinId',
    ]);
    expectWith(res.body.item, ['id', 'serialNumber', 'description', 'typeClass', 'lifecycleState', 'holdFlag', 'isLot']);
    const history = res.body.history as { eventType: string }[];
    expect(history.map((e) => e.eventType)).toEqual(['ownership_transfer']);
    expect(Object.keys(history[0]!).sort()).toEqual(['eventType', 'newState', 'occurredAt', 'prevState']);
    expect(res.body.openRequests).toEqual([]);

    const staff = await operator.get(`/custody/items/${item.id}/history`);
    expect(staff.status).toBe(200);
    expectWith(staff.body, ['actorId', 'reason', 'prevOwnerId', 'newOwnerId', 'prevBinId', 'newBinId']);
    expect((staff.body as unknown[]).length).toBeGreaterThan(history.length);
  });
});

describe('A1b the vault list a collector reads', () => {
  it('names no shelf, bin or warehouse barcode', async () => {
    const red = await signIn(SEED.collector);
    const res = await red.get('/vault/items');
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeGreaterThan(0);
    expectWithout(res.body, ['binId', 'binBarcode', 'binZone', 'barcode', 'ownerId']);
    expectWith(res.body[0], ['id', 'serialNumber', 'description', 'typeClass', 'lifecycleState']);
    const history = await red.get('/vault/items?scope=history');
    expect(history.status).toBe(200);
    expectWithout(history.body, ['binId', 'binBarcode', 'binZone', 'barcode']);
  });
});

describe('A2 the vault item timeline a collector reads', () => {
  it('covers only the caller’s holding and leaves out shelves, corrections and moves', async () => {
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const item = await intakeFor(operator, SEED.collector2, { description: 'Timeline across owners' });
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const otherBin = bins.find((b) => b.id !== item.binId)!.id;

    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: true })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: false })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { conditionGrade: 'PSA 7' })).status).toBe(200);
    expect((await operator.post(`/custody/items/${item.id}/relocate`, { binId: otherBin })).status).toBe(201);
    expect((await admin.patch(`/admin/items/${item.id}`, { ownerId: await userIdOf(red) })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: true })).status).toBe(200);

    const mine = await red.get(`/vault/items/${item.id}/timeline`);
    expect(mine.status).toBe(200);
    expectWithout(mine.body, ['fromBin', 'toBin', 'ruling', 'field']);
    const kinds = (mine.body as { kind: string }[]).map((e) => e.kind).sort();
    expect(kinds).toEqual(['hold_placed', 'ownership_transfer']);

    const before = await golden.get(`/vault/items/${item.id}/timeline`);
    expect(before.status).toBe(200);
    const theirs = (before.body as { kind: string }[]).map((e) => e.kind);
    expect(theirs).toContain('intake');
    expect(theirs).toContain('hold_released');
    expect(theirs).toContain('ownership_transfer');
    expect(theirs.filter((k) => ['correction', 'bin_transfer', 'relocate'].includes(k))).toEqual([]);
    expect(theirs.filter((k) => k === 'hold_placed')).toHaveLength(1);

    const staff = await operator.get(`/custody/items/${item.id}/timeline`);
    const staffKinds = (staff.body as { kind: string }[]).map((e) => e.kind);
    expect(staffKinds).toEqual(expect.arrayContaining(['correction', 'bin_transfer', 'relocate', 'intake']));
    expectWith(staff.body, ['toBin', 'field']);
  });
});

const REQUEST_DROPPED = [
  'requesterId',
  'batchId',
  'chargeId',
  'fulfilledBy',
  'fulfilledAt',
  'fulfillment',
  'quotedBy',
  'declinedBy',
  'completedBy',
  'approvalBy',
  'approvalReason',
  'rationale',
  'eventId',
  'transactionId',
  'deniedAt',
  'periodId',
  'allowance',
  'kind',
] as const;

describe('A3 service requests as a collector reads them', () => {
  it('lists and returns requests without staff or billing internals', async () => {
    await fundWallet(SEED.collector, 50_000);
    const operator = await signIn(SEED.operator);
    const red = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Service view card' });

    const photo = await red.post('/services/photography', { itemId: item.id });
    expect(photo.status).toBe(201);
    expectWithout(photo.body, REQUEST_DROPPED);
    expectWith(photo.body, ['id', 'code', 'type', 'status', 'itemId', 'createdAt', 'typeFields']);

    const asked = await red.post('/services/custom', {
      itemId: item.id,
      summary: 'Clean the case',
      detail: 'Please wipe the slab case and remove the sticker residue.',
    });
    expect(asked.status).toBe(201);
    expectWithout(asked.body, REQUEST_DROPPED);
    expect(asked.body.code).toBeTruthy();
    expect((await operator.post(`/services/requests/${asked.body.id}/accept`)).status).toBe(201);
    const quoted = await operator.post(`/services/custom/${asked.body.id}/quote`, {
      priceMinor: 12_00,
      scope: 'Wipe the case and lift the residue with a plastic blade.',
    });
    expect(quoted.status).toBe(201);
    expect(quoted.body.typeFields.quotedBy).toBeTruthy();

    const mine = await red.get('/services/mine');
    expect(mine.status).toBe(200);
    expectWithout(mine.body, REQUEST_DROPPED);
    const rows = mine.body as { id: string; typeFields: Record<string, unknown> }[];
    const custom = rows.find((r) => r.id === asked.body.id)!;
    expect(custom.typeFields).toMatchObject({ stage: 'quoted', priceMinor: 12_00, summary: 'Clean the case' });
    expect(custom.typeFields.scope).toMatch(/plastic blade/);
    const shoot = rows.find((r) => r.id === photo.body.id)!;
    if (shoot.typeFields.billed !== undefined) {
      expect(Object.keys(shoot.typeFields.billed as object).sort()).toEqual(['amountMinor', 'currency']);
    }

    const queue = await operator.get('/services/queue');
    const staffRow = (queue.body as { id: string; typeFields: Record<string, unknown> }[]).find(
      (r) => r.id === asked.body.id,
    )!;
    expect(staffRow.typeFields.quotedBy).toBeTruthy();
  });
});

const WALLET_REQUEST_DROPPED = [
  'userId',
  'documentKey',
  'payoutPaymentId',
  'payoutReference',
  'reviewedBy',
  'reviewedAt',
  'settledLedgerId',
  'payout',
  'username',
  'email',
  'customerName',
  'actorId',
  'actorRole',
  'metadata',
  'requestId',
] as const;

describe('A4 wallet requests as a collector reads them', () => {
  it('lists and details requests without reviewer, payout or staff-note internals', async () => {
    const golden = await signIn(SEED.collector2);
    const admin = await signIn(SEED.admin);
    const created = await golden.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 25_00,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `views-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    expectWithout(created.body, WALLET_REQUEST_DROPPED);
    const id = created.body.id as string;

    expect((await admin.post(`/admin/wallet-requests/${id}/review`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${id}/approve`, { note: 'Matched on the bank statement, row 14' })).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).status).toBe(201);

    const list = await golden.get('/finance/wallet-requests');
    expect(list.status).toBe(200);
    expectWithout(list.body, WALLET_REQUEST_DROPPED);
    expectWith(list.body, ['id', 'code', 'type', 'status', 'amount', 'reference', 'createdAt', 'updatedAt']);

    const detail = await golden.get(`/finance/wallet-requests/${id}`);
    expect(detail.status).toBe(200);
    expectWithout(detail.body, WALLET_REQUEST_DROPPED);
    const history = detail.body.history as { toStatus: string; byStaff: boolean; reason: string | null }[];
    expect(history.map((e) => e.toStatus)).toEqual(['submitted', 'pending_review', 'approved', 'completed']);
    expect(history.map((e) => e.byStaff)).toEqual([false, true, true, true]);
    expect(history.every((e) => e.reason === null)).toBe(true);
    expect(JSON.stringify(detail.body)).not.toMatch(/bank statement/);

    const staff = await admin.get(`/admin/wallet-requests/${id}`);
    expect(staff.status).toBe(200);
    expectWith(staff.body, ['userId', 'username', 'email', 'reviewedBy', 'settledLedgerId', 'actorId', 'metadata']);
    expect(JSON.stringify(staff.body)).toMatch(/bank statement/);
  });

  it('keeps the rejection reason and the collector’s own cancel reason', async () => {
    const golden = await signIn(SEED.collector2);
    const admin = await signIn(SEED.admin);
    const rejected = await golden.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 26_00,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `views-r-${Date.now()}`,
    });
    await admin.post(`/admin/wallet-requests/${rejected.body.id}/reject`, { reason: 'The transfer never arrived.' });
    const read = await golden.get(`/finance/wallet-requests/${rejected.body.id}`);
    const last = (read.body.history as { toStatus: string; reason: string | null }[]).at(-1)!;
    expect(last).toMatchObject({ toStatus: 'rejected', reason: 'The transfer never arrived.' });
    expect(read.body.rejectionReason).toBe('The transfer never arrived.');

    const other = await signIn(SEED.collector);
    expect((await other.get(`/finance/wallet-requests/${rejected.body.id}`)).status).toBe(404);
  });
});

describe('A5 the notification feed a collector reads', () => {
  it('shows only in-app rows, with the message, codes and amounts and no ids or delivery internals', async () => {
    const red = await signIn(SEED.collector);
    const redId = await userIdOf(red);
    const someone = '7f1c2a9e-1111-4222-8333-944455556666';
    const code = `WR-V${Date.now()}`;
    const content = {
      message: 'A payment of $12.00 was reversed by the bank.',
      requestCode: code,
      amount: 12_00,
      refundedMinor: 12_00,
      reason: 'Chargeback typed by an admin: cardholder disputed',
      buyerId: someone,
      sellerId: someone,
      itemId: someone,
      listingId: someone,
      transactionId: someone,
      requestId: someone,
      shipmentId: someone,
      counteredBy: someone,
      recipientIds: [someone],
    };
    await sql(
      `INSERT INTO notification (user_id, event_type, content, channel, status)
       VALUES ($1, 'payment_reversed', $2::jsonb, 'in_app', 'sent'),
              ($1, 'payment_reversed', $2::jsonb, 'email', 'failed')`,
      [redId, JSON.stringify(content)],
    );
    await sql(
      `UPDATE notification SET provider_ref = 'prov-123', failure_reason = 'SMTP 550 mailbox unavailable'
        WHERE user_id = $1 AND channel = 'email' AND content->>'requestCode' = $2`,
      [redId, code],
    );

    const feed = await red.get('/notifications');
    expect(feed.status).toBe(200);
    expectWithout(feed.body, [
      'userId',
      'channel',
      'status',
      'providerRef',
      'failureReason',
      'recipientIds',
      'buyerId',
      'sellerId',
      'itemId',
      'listingId',
      'transactionId',
      'requestId',
      'shipmentId',
      'counteredBy',
      'reason',
    ]);
    const rows = (feed.body as { eventType: string; content: Record<string, unknown> }[]).filter(
      (n) => n.content.requestCode === code,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toEqual({
      message: content.message,
      requestCode: code,
      amount: 12_00,
      refundedMinor: 12_00,
    });
    expect(JSON.stringify(feed.body)).not.toMatch(new RegExp(someone));
  });
});

const DEAL_DROPPED = [
  'raisedBy',
  'counterpartyUserId',
  'fundingAttestedBy',
  'inspectedBy',
  'buyerReleaseAttestedBy',
  'sellerReleaseAttestedBy',
  'buyerId',
  'sellerId',
  'itemId',
  'actorId',
  'metadata',
  'onBehalfOf',
  'configuredBps',
  'deals',
] as const;

describe('A6 escrow as a collector reads it', () => {
  it('names the caller’s side instead of sending either party’s id', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const operator = await signIn(SEED.operator);
    const raised = await red.post('/escrow', {
      raiserRole: 'seller',
      counterpartyUsername: 'golden',
      description: 'Views check: EX Deoxys Rayquaza, PSA 6',
      valueMinor: 300_000,
      settlement: 'buyer_vault',
    });
    expect(raised.status).toBe(201);
    expectWithout(raised.body, DEAL_DROPPED);
    expect(raised.body).toMatchObject({ myRole: 'seller', raisedByMe: true, counterpartyIsMember: true });
    expect((await golden.post(`/escrow/${raised.body.id}/agree`, { notes: 'Agreed at the show.' })).status).toBe(201);

    const mine = await golden.get('/escrow/mine');
    expectWithout(mine.body, DEAL_DROPPED);
    const theirs = (mine.body as { id: string; myRole: string; raisedByMe: boolean }[]).find(
      (d) => d.id === raised.body.id,
    )!;
    expect(theirs).toMatchObject({ myRole: 'buyer', raisedByMe: false });

    const detail = await golden.get(`/escrow/${raised.body.id}`);
    expect(detail.status).toBe(200);
    expectWithout(detail.body, DEAL_DROPPED);
    const events = detail.body.events as { eventType: string; byStaff: boolean; notes: string | null }[];
    expect(events.map((e) => e.eventType).sort()).toEqual(['agreed', 'raised']);
    expect(events.every((e) => e.byStaff === false)).toBe(true);
    expect(events.find((e) => e.eventType === 'agreed')?.notes).toBe('Agreed at the show.');

    const terms = await golden.get('/escrow/terms');
    expectWithout(terms.body, DEAL_DROPPED);
    expectWith(terms.body, ['feeBps', 'minimumFeeMinor', 'minimumValueMinor']);
    const held = await golden.get('/escrow/held');
    expect(Object.keys(held.body)).toEqual(['heldMinor']);

    const staff = await operator.get(`/escrow/${raised.body.id}`);
    expect(staff.status).toBe(200);
    expectWith(staff.body, ['raisedBy', 'counterpartyUserId', 'buyerId', 'sellerId', 'actorId', 'metadata']);
  });
});

const SHIPMENT_DROPPED = [
  'providerShipmentId',
  'providerRateId',
  'customerName',
  'serviceKey',
  'mergedIntoShipmentId',
  'barcode',
  'userId',
  'membershipCover',
  'labelObjectKey',
  'fulfillment',
  'fulfilledBy',
  'quotedBy',
  'handedOverBy',
  'packageWeightGrams',
  'destinationDetail',
] as const;

describe('A7 shipping as a collector reads it', () => {
  it('quotes, lists and tracks without provider ids or other internals', async () => {
    const operator = await signIn(SEED.operator);
    await fundWallet(SEED.collector, 50_000);
    const red = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Shipping view card' });
    const order = {
      itemIds: [item.id],
      destinationAddress: 'Red Ashwood, 1200 Market St, San Francisco 94102, US',
      destinationCountry: 'US',
      destinationPostalCode: '94102',
      recipientName: 'Red Ashwood',
    };

    const quote = await red.post('/shipping/quote', order);
    expect(quote.status).toBe(201);
    expect((quote.body.rates as unknown[]).length).toBeGreaterThan(0);
    expectWithout(quote.body, ['providerShipmentId', 'providerRateId']);
    expectWith(quote.body.rates, ['carrier', 'serviceLevel', 'serviceKey', 'totalMinor']);

    const created = await red.post('/shipping/shipments', order);
    expect(created.status).toBe(201);
    expectWithout(created.body, SHIPMENT_DROPPED);
    expectWith(created.body, ['id', 'code', 'status', 'itemIds']);

    const rates = await red.get(`/shipping/shipments/${created.body.id}/rates`);
    expectWithout(rates.body, ['providerShipmentId', 'providerRateId']);

    const list = await red.get('/shipping/shipments');
    expectWithout(list.body, SHIPMENT_DROPPED);
    const row = (list.body as { id: string; itemIds: string[]; items: unknown[] }[]).find((s) => s.id === created.body.id)!;
    expect(row.itemIds).toEqual([item.id]);
    expect(row.items).toEqual([{ id: item.id, serialNumber: item.serialNumber, description: 'Shipping view card' }]);

    const tracked = await red.get(`/shipping/shipments/${created.body.id}`);
    expectWithout(tracked.body, SHIPMENT_DROPPED);
    expectWith(tracked.body, ['code', 'trackingNumber', 'carrier', 'serviceLevel', 'itemIds', 'cancelReason']);

    const staff = await operator.get(`/shipping/shipments/${created.body.id}`);
    expectWith(staff.body, ['customerName', 'serviceKey', 'mergedIntoShipmentId', 'barcode']);
  });
});

describe('A8 marketplace reads as a collector receives them', () => {
  it('sends offers, collectors, tradable items and listings without other people’s ids or names', async () => {
    const operator = await signIn(SEED.operator);
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const item = await intakeFor(operator, SEED.collector, { description: 'Market view card' });
    const listed = await red.post('/marketplace/listings', { itemId: item.id, askingPrice: 90_00 });
    expect(listed.status).toBe(201);
    await fundWallet(SEED.collector2, 20_000);
    const offered = await golden.post(`/marketplace/listings/${listed.body.id}/offers`, { amount: 70_00 });
    expect(offered.status).toBe(201);

    for (const reader of [red, golden]) {
      const offers = await reader.get('/marketplace/offers/mine');
      expect(offers.status).toBe(200);
      expectWithout(offers.body, ['buyerId', 'sellerId', 'parentOfferId', 'itemId']);
      const row = (offers.body as { id: string }[]).find((o) => o.id === offered.body.id);
      expectWith(row, ['id', 'listingId', 'amount', 'status', 'listingStatus', 'side', 'yourTurn', 'direction']);
    }

    const collector = await golden.get('/marketplace/collectors/red');
    expect(collector.status).toBe(200);
    expect(collector.body).toEqual({ username: 'red' });

    const kept = await intakeFor(operator, SEED.collector, { description: 'Tradable view card' });
    const tradable = await golden.get(`/marketplace/collectors/red/items/${encodeURIComponent(kept.serialNumber)}`);
    expect(tradable.status).toBe(200);
    expectWithout(tradable.body, ['ownerUsername', 'ownerId']);
    expect(tradable.body.id).toBe(kept.id);

    const browse = await golden.get('/marketplace/listings?limit=200');
    expectWithout(browse.body, ['itemId', 'sellerId', 'ownerId']);
    expectWith(browse.body, ['id', 'imageUrl', 'sellerUsername']);

    const store = await golden.get('/marketplace/sellers/red');
    expectWithout(store.body, ['itemId', 'sellerId', 'ownerId']);
    expectWith(store.body, ['username', 'listings']);
  });
});

describe('A9 the pricing rule table', () => {
  it('is for admins only, while the public price list stays open', async () => {
    const red = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    expect((await red.get('/pricing/rules')).status).toBe(403);
    expect((await operator.get('/pricing/rules')).status).toBe(403);
    expect((await new Client().get('/pricing/rules')).status).toBe(401);
    const rules = await admin.get('/pricing/rules');
    expect(rules.status).toBe(200);
    expectWith(rules.body, ['actionType', 'parameters', 'effectiveFrom']);
    expect((await red.get('/pricing/list')).status).toBe(200);
  });
});

describe('A10 inbound parcels, addresses and show calendars as a collector reads them', () => {
  it('leaves out warehouse queue, facility and show internals', async () => {
    const red = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);

    const workflow = await red.get('/parcels/workflow/status');
    expect(workflow.status).toBe(200);
    expectWithout(workflow.body, ['unclaimed']);
    expectWith(workflow.body, ['awaitingOpen', 'awaitingProcessing']);
    expectWith((await operator.get('/parcels/workflow/status')).body, ['unclaimed']);

    const addresses = await red.get('/me/inbound-addresses');
    expectWithout(addresses.body, ['facilityId', 'phone']);
    expectWith(addresses.body, ['code', 'name', 'careOf', 'lines']);
    const registered = await red.post('/me/parcels', {
      facilityCode: (addresses.body as { code: string }[])[0]!.code,
      trackingNumber: `VIEWS-${Date.now()}`,
    });
    expect(registered.status).toBe(201);

    const parcels = await red.get('/me/parcels');
    expectWithout(parcels.body, ['facilityCode', 'facilityId', 'ownerId']);
    expectWith(parcels.body, ['code', 'status', 'facilityName']);

    const SHOW_DROPPED = ['capacity', 'booked', 'notes', 'active', 'pickupEnabled', 'pickupCapacity', 'partnerFeeNote', 'updatedAt'];
    const shows = await red.get('/shipping/pickup/shows');
    expect(shows.status).toBe(200);
    expectWithout(shows.body, SHOW_DROPPED);
    if ((shows.body as unknown[]).length > 0) {
      expectWith(shows.body, ['id', 'name', 'venue', 'startsAt', 'requestDeadline', 'feeMinor', 'remaining', 'open']);
    }
    const channels = await red.get('/services/consignment/channels');
    expect(channels.status).toBe(200);
    expectWithout(channels.body, [...SHOW_DROPPED, 'createdAt']);
    expectWith(channels.body.channels, ['key', 'label', 'minAskingMinor', 'requiresEvent']);
  });
});

describe('A11 support tickets as a collector reads them', () => {
  it('marks staff messages without naming staff and leaves out assignment and resolution ids', async () => {
    const red = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);
    const opened = await red.post('/support/tickets', {
      category: 'item',
      subject: 'Views: a scuff on my slab',
      body: 'There is a scuff on the case that was not there before.',
      relatedType: 'item',
      relatedId: '7f1c2a9e-1111-4222-8333-944455556666',
    });
    expect(opened.status).toBe(201);
    expectWithout(opened.body, ['userId', 'assignedTo', 'resolvedBy', 'relatedType', 'relatedId']);
    expect((await operator.post(`/support/tickets/${opened.body.id}/messages`, { body: 'We will look at it today.' })).status).toBe(201);

    const list = await red.get('/support/tickets');
    expectWithout(list.body, ['userId', 'assignedTo', 'resolvedBy', 'relatedType', 'relatedId']);
    expectWith(list.body, ['id', 'code', 'subject', 'status', 'lastMessageAt']);

    const thread = await red.get(`/support/tickets/${opened.body.id}`);
    expect(thread.status).toBe(200);
    expectWithout(thread.body, ['userId', 'assignedTo', 'resolvedBy', 'relatedId']);
    const messages = thread.body.messages as { fromStaff: boolean; authorUsername?: string; body: string }[];
    expect(messages.map((m) => m.fromStaff)).toEqual([false, true]);
    expect(messages[0]!.authorUsername).toBe('red');
    expect(messages[1]).not.toHaveProperty('authorUsername');
    expect(JSON.stringify(thread.body)).not.toMatch(/hermon/);

    const staff = await operator.get(`/support/tickets/${opened.body.id}`);
    expectWith(staff.body, ['userId', 'assignedTo', 'authorUsername']);
    expect(JSON.stringify(staff.body)).toMatch(/hermon/);
  });
});

describe('A12 saved addresses as a collector reads them', () => {
  it('leaves out the owner id and the creation time', async () => {
    const red = await signIn(SEED.collector);
    const added = await red.post('/me/addresses', {
      label: 'Views',
      recipient: 'Red Ashwood',
      line1: '3 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });
    expect(added.status).toBe(201);
    expectWithout(added.body, ['userId', 'createdAt']);
    const edited = await red.patch(`/me/addresses/${added.body.id}`, { city: 'Princeton' });
    expectWithout(edited.body, ['userId', 'createdAt']);
    const list = await red.get('/me/addresses');
    expectWithout(list.body, ['userId', 'createdAt']);
    expectWith(list.body, ['id', 'label', 'recipient', 'line1', 'city', 'region', 'country', 'postalCode', 'isDefault']);
    expect((await red.del(`/me/addresses/${added.body.id}`)).status).toBeLessThan(300);
  });
});
