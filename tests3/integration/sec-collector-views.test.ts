import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, fundWallet, signIn, intakeFor } from '../../tests/integration/helpers/http';
import { closeDb, sql } from '../../tests/integration/helpers/db';

afterAll(closeDb);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      description: 'Views check: Base Set Charizard, PSA 6',
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
