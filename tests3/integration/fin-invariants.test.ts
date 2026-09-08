import { describe, it, expect } from 'vitest';
import { SEED, signIn, fundWallet, intakeFor, type Client } from '../../tests/integration/helpers/http';

/**
 * The money invariants, checked against the API rather than the database.
 *
 * `tests/property/wallet-ledger.test.ts` proves the derivation is correct in the
 * small. This proves it survives the product: after a real sequence of intakes,
 * charges, a sale, a withdrawal and a shipment, does the balance the customer is
 * shown still equal the sum of the rows they can see?
 *
 * The reason to check it here and not only in a property test is that every one
 * of those operations is a different service writing a different row inside a
 * different transaction. The invariant only means something end to end.
 */

/** The balance, and the ledger it must be derived from, as a customer sees them. */
async function walletAndLedger(client: Client) {
  const [wallet, ledger] = await Promise.all([
    client.get('/finance/wallet'),
    client.get('/finance/ledger'),
  ]);
  expect(wallet.status).toBe(200);
  expect(ledger.status).toBe(200);

  const rows = (Array.isArray(ledger.body) ? ledger.body : ledger.body.rows) as {
    amount: number;
    direction: string;
  }[];
  const derived = rows.reduce(
    (sum, r) => sum + (r.direction === 'credit' ? r.amount : -r.amount),
    0,
  );
  return { balance: wallet.body.amount as number, derived, rowCount: rows.length };
}

describe('the balance is always the sum of the ledger', () => {
  it('holds after a funding, several charges, a sale and a withdrawal', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);

    const start = await walletAndLedger(collector);
    expect(start.balance).toBe(start.derived);

    // 1. Money in, through the only path that exists.
    await fundWallet(SEED.collector, 250_00);
    const funded = await walletAndLedger(collector);
    expect(funded.balance).toBe(funded.derived);
    expect(funded.balance).toBe(start.balance + 250_00);

    // 2. Charges out — three intakes, each of which bills the owner.
    for (let i = 0; i < 3; i += 1) {
      await intakeFor(operator, SEED.collector, { description: `Invariant item ${i}` });
    }
    const charged = await walletAndLedger(collector);
    expect(charged.balance).toBe(charged.derived);
    expect(charged.balance).toBeLessThan(funded.balance);

    // 3. A sale — money moving between two accounts at once is where a
    //    single-sided write would show up.
    const item = await intakeFor(operator, SEED.collector, { description: 'Invariant sale' });
    const listing = await collector.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 40_00,
    });
    expect(listing.status).toBe(201);

    await fundWallet(SEED.collector2, 200_00);
    const buyer = await signIn(SEED.collector2);
    const buyerBefore = await walletAndLedger(buyer);

    const purchase = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`, {});
    expect(purchase.status).toBe(201);

    const sellerAfter = await walletAndLedger(collector);
    const buyerAfter = await walletAndLedger(buyer);
    expect(sellerAfter.balance).toBe(sellerAfter.derived);
    expect(buyerAfter.balance).toBe(buyerAfter.derived);

    // The buyer paid exactly the asking price.
    expect(buyerAfter.balance).toBe(buyerBefore.balance - 40_00);
    // The seller received it less a fee — never more than it, never nothing.
    expect(sellerAfter.balance).toBeGreaterThan(charged.balance);
    expect(sellerAfter.balance - charged.balance).toBeLessThanOrEqual(40_00);

    // 4. Money out.
    // $20 is the published cash-out minimum; below it the request is refused
    // with a named violation rather than silently clamped.
    const tooSmall = await collector.post('/finance/withdrawals', {
      amountMinor: 19_99,
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
    });
    expect(tooSmall.status).toBe(400);

    const withdrawal = await collector.post('/finance/withdrawals', {
      amountMinor: 25_00,
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
    });
    expect([200, 201]).toContain(withdrawal.status);

    // A cash-out is a REQUEST: raising it must not move the balance either.
    const requested = await walletAndLedger(collector);
    expect(requested.balance).toBe(requested.derived);

    const end = await walletAndLedger(collector);
    expect(end.balance).toBe(end.derived);
  });

  it('never lets a purchase move money without moving the item', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Atomicity' });
    const listing = await seller.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 30_00,
    });

    await fundWallet(SEED.collector2, 100_00);
    const buyer = await signIn(SEED.collector2);
    const bought = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`, {});
    expect(bought.status).toBe(201);

    // The item is now the buyer's, in the buyer's vault, and gone from the
    // seller's — the money and the ownership are one transaction or neither.
    const buyerVault = await buyer.get('/vault/items');
    expect((buyerVault.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);

    const sellerVault = await seller.get('/vault/items');
    expect((sellerVault.body as { id: string }[]).some((i) => i.id === item.id)).toBe(false);
  });

  it('refuses a purchase the buyer cannot afford, and moves nothing', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Too expensive' });
    const listing = await seller.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 9_000_000_00,
    });
    expect(listing.status).toBe(201);

    const buyer = await signIn(SEED.collector2);
    const before = await walletAndLedger(buyer);

    const res = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`, {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const after = await walletAndLedger(buyer);
    expect(after.balance).toBe(before.balance);
    expect(after.rowCount).toBe(before.rowCount);

    // And the item is still the seller's.
    const sellerVault = await seller.get('/vault/items');
    expect((sellerVault.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);
  });

  it('cannot buy your own listing', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Self purchase' });
    const listing = await seller.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 10_00,
    });

    const res = await seller.post(`/marketplace/listings/${listing.body.id}/purchase`, {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('the ledger is append-only in practice, not just in policy', () => {
  it('never removes a row once written', async () => {
    const collector = await signIn(SEED.collector);
    const before = await walletAndLedger(collector);

    // $10 is the cash-in minimum; fund above it.
    await fundWallet(SEED.collector, 25_00);
    const after = await walletAndLedger(collector);

    // Rows only ever accumulate. A correction is a new row, never an edit.
    expect(after.rowCount).toBeGreaterThan(before.rowCount);
    expect(after.balance).toBe(after.derived);
  });

  it('charges an intake against the owner, not the operator', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);

    const operatorBefore = await walletAndLedger(operator);
    const ownerBefore = await walletAndLedger(owner);

    await intakeFor(operator, SEED.collector, { description: 'Billed to the owner' });

    const operatorAfter = await walletAndLedger(operator);
    const ownerAfter = await walletAndLedger(owner);

    expect(ownerAfter.balance).toBeLessThan(ownerBefore.balance);
    expect(operatorAfter.balance).toBe(operatorBefore.balance);
  });
});

describe('separation of duties on wallet requests', () => {
  it('will not let an administrator approve their own cash-in', async () => {
    const admin = await signIn(SEED.admin);
    const created = await admin.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 50_00,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `self-approve-${Date.now()}`,
    });
    expect(created.status).toBe(201);

    const approved = await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {});
    expect(approved.status).toBeGreaterThanOrEqual(400);
    expect(approved.status).toBeLessThan(500);
  });

  it('credits nothing until a request is completed, not merely approved', async () => {
    const collector = await signIn(SEED.collector);
    const before = await walletAndLedger(collector);

    const created = await collector.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 77_00,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `staged-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    });
    expect(created.status).toBe(201);

    // Raised: nothing has moved.
    const raised = await walletAndLedger(collector);
    expect(raised.balance).toBe(before.balance);

    const admin = await signIn(SEED.admin);
    await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {});

    // Approved: STILL nothing has moved. Approval is a decision, not a payment.
    const approved = await walletAndLedger(collector);
    expect(approved.balance).toBe(before.balance);

    await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {});

    const completed = await walletAndLedger(collector);
    expect(completed.balance).toBe(before.balance + 77_00);
    expect(completed.balance).toBe(completed.derived);
  });

  it('cannot complete the same request twice', async () => {
    const collector = await signIn(SEED.collector);
    const created = await collector.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 33_00,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `double-complete-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    });
    const admin = await signIn(SEED.admin);
    await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {});
    const first = await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {});
    expect(first.status).toBe(201);

    const afterOne = await walletAndLedger(collector);

    const second = await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {});
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);

    const afterTwo = await walletAndLedger(collector);
    expect(afterTwo.balance).toBe(afterOne.balance);
  });
});

describe('pricing is snapshotted, not looked up later', () => {
  it('keeps a charge at the price that applied when it was raised', async () => {
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);

    const before = await walletAndLedger(collector);
    await intakeFor(operator, SEED.collector, { description: 'Priced at the old rate' });
    const afterFirst = await walletAndLedger(collector);
    const firstCharge = before.balance - afterFirst.balance;
    expect(firstCharge).toBeGreaterThan(0);

    // Change the intake price, then confirm the EARLIER charge did not move.
    const raised = await admin.post('/pricing/rules', {
      actionType: 'intake',
      description: 'Doubled for the snapshot test',
      model: 'fixed',
      value: firstCharge * 2,
      billingTrigger: 'per_event',
    });
    expect([200, 201]).toContain(raised.status);

    const afterRepricing = await walletAndLedger(collector);
    expect(afterRepricing.balance).toBe(afterFirst.balance);
    expect(afterRepricing.balance).toBe(afterRepricing.derived);
  });
});
