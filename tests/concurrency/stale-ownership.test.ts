import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';

/**
 * Ownership must not move on a stale check.
 *
 * Every path that hands a card to somebody is decided EARLIER: when a transfer
 * is confirmed, a listing created, a pickup booked, a split asked for or a card
 * booked into an escrow deal. If the card changes hands in between, moving it
 * from whoever owns it NOW would give it to the wrong person and pay the one who
 * no longer owns it.
 *
 * Each move re-checks the owner (and state, and hold) under the row lock at the
 * moment of the move, and refuses with 409 when it no longer holds. The tests
 * assert on who owns the card and who was paid, not only the status.
 *
 * Requires a running API + a freshly seeded DB (`pnpm --filter @bault/api db:seed`).
 */

type Res = Awaited<ReturnType<Client['post']>>;

const ok = (r: Res) => r.status >= 200 && r.status < 300;
const wins = (rs: Res[]) => rs.filter(ok).length;
const losersAre4xx = (rs: Res[]) => rs.filter((r) => !ok(r)).every((r) => r.status >= 400 && r.status < 500);

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

/** Fund `email` until its balance is at least `min` (cash-ins are $10 … $20,000 each). */
async function ensureBalance(email: string, min: number): Promise<number> {
  const c = await signIn(email);
  let cur = await balanceOf(c);
  while (cur < min) {
    await fundWallet(email, Math.min(Math.max(min - cur, 1_000), 2_000_000));
    cur = await balanceOf(c);
  }
  return cur;
}

/** Whether `c` owns the card: the owner-scoped vault drawer answers 404 to anybody else. */
const owns = async (c: Client, itemId: string) => (await c.get(`/vault/items/${itemId}`)).status === 200;

/** List `itemId` as `seller` and have `buyerEmail` buy it. */
async function listAndSell(seller: Client, itemId: string, buyerEmail: string, price = 5_000) {
  const listing = await seller.post('/marketplace/listings', { itemId, askingPrice: price });
  expect(listing.status).toBe(201);
  await ensureBalance(buyerEmail, price);
  const buyer = await signIn(buyerEmail);
  expect((await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`)).status).toBe(201);
  return buyer;
}

/**
 * Move `itemId` to `toEmail` behind the seller's back, the one way a card already
 * promised elsewhere can still change hands: an administrator reassigning it. A
 * card in an open pickup or escrow deal cannot be listed (item_committed), so
 * that route is asserted closed first; the reassignment then tests the re-check
 * that settlement and hand-over make.
 */
async function reassignBehindTheirBack(seller: Client, itemId: string, toEmail: string) {
  const refused = await seller.post('/marketplace/listings', { itemId, askingPrice: 5_000 });
  expect(refused.status).toBe(409);
  expect(refused.body.error.code).toBe('item_committed');
  const admin = await signIn(SEED.admin);
  const to = await signIn(toEmail);
  const toId = (await to.get('/me/profile')).body.id as string;
  const patched = await admin.patch(`/admin/items/${itemId}`, { ownerId: toId });
  expect(patched.status).toBeLessThan(300);
  expect(await owns(to, itemId)).toBe(true);
  return to;
}

/** Book a show pickup of one fresh card for Red, paid on the spot. */
async function bookedPickup(description: string) {
  const operator = await signIn(SEED.operator);
  const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description });
  const owner = await signIn(SEED.collector);
  await ensureBalance(SEED.collector, 10_000);
  const shows = (await owner.get('/shipping/pickup/shows')).body as Array<{ id: string; open: boolean }>;
  const show = shows.find((s) => s.open);
  expect(show).toBeTruthy();
  const booked = await owner.post('/shipping/pickup', { itemIds: [card.id], eventId: show!.id });
  expect(booked.status).toBe(201);
  expect(booked.body.status).toBe('rates_selected');
  return { operator, owner, card, shipmentId: booked.body.id as string };
}

/** A lot of eight cards for Red, tagged so its children can be found by search. */
async function lotWithAcceptedSplit(tag: string) {
  const operator = await signIn(SEED.operator);
  const lot = await intakeFor(operator, SEED.collector, {
    typeClass: 'trading_card',
    isLot: true,
    // Above the trading-card threshold, so it is received as a lot.
    lotSize: 8,
    description: tag,
  });
  expect(lot.isLot).toBe(true);
  const owner = await signIn(SEED.collector);
  // A split request is billed and needs a wallet in credit.
  await ensureBalance(SEED.collector, 50_000);
  const req = await owner.post('/services/lot-split', { itemId: lot.id });
  expect(req.status).toBe(201);
  expect((await operator.post(`/services/requests/${req.body.id}/accept`)).status).toBe(201);
  return { operator, owner, lot, requestId: req.body.id as string };
}

/** Children of a tagged lot: every non-lot item in the owner's vault carrying the tag. */
async function childrenOf(owner: Client, tag: string) {
  const res = await owner.get(`/vault/items?q=${encodeURIComponent(tag)}`);
  expect(res.status).toBe(200);
  return (res.body as Array<{ isLot: boolean }>).filter((i) => !i.isLot).length;
}

const SPLIT_FORM = { itemVerified: true, notes: 'Separated, sleeved and re-binned.' };
const HAND_OVER = (itemId: string) => ({
  scannedItemIds: [itemId],
  handedToName: 'Red Ashwood',
  notes: 'Collected from the Bault table, ID checked.',
});

describe('concurrency: stale ownership', () => {
  it('a gift transfer approved after the card was sold is refused', async () => {
    // Ownership checked only when the gift is proposed would move the card from
    // its CURRENT owner, the buyer, to the gift's recipient.
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'E4' });
    const t = await owner.post('/marketplace/transfers', { itemId: item.id, toUsername: 'veteran' });
    expect(t.status).toBe(201);
    const c = await owner.post('/marketplace/transfers/confirm', { confirmationToken: t.body.confirmationToken });
    expect(c.status).toBe(201);

    const buyer = await listAndSell(owner, item.id, SEED.collector2, 100);

    const recipient = await signIn(SEED.collector3);
    const approved = await recipient.post(`/marketplace/swaps/${c.body.swapId}/approve`);
    expect({
      status: approved.status,
      buyerOwns: await owns(buyer, item.id),
      recipientOwns: await owns(recipient, item.id),
    }).toEqual({ status: 409, buyerOwns: true, recipientOwns: false });
  }, 60_000);

  it('a listing left behind by an admin reassignment cannot be bought', async () => {
    // The old owner's listing must not stay live: a buyer would buy the NEW
    // owner's card and the OLD owner would be paid for it.
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const oldOwner = await signIn(SEED.collector);
    const newOwner = await signIn(SEED.collector2);
    const item = await intakeFor(operator, SEED.collector, { description: 'F177' });
    const listing = await oldOwner.post('/marketplace/listings', { itemId: item.id, askingPrice: 5_000 });
    expect(listing.status).toBe(201);

    const newOwnerId = (await newOwner.get('/me/profile')).body.id as string;
    const patched = await admin.patch(`/admin/items/${item.id}`, { ownerId: newOwnerId });
    expect(patched.status).toBeLessThan(300);
    expect(await owns(newOwner, item.id)).toBe(true);

    await ensureBalance(SEED.collector3, 5_000);
    const buyer = await signIn(SEED.collector3);
    const oldOwnerBefore = await balanceOf(oldOwner);
    const buyerBefore = await balanceOf(buyer);
    const res = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`);

    expect({
      status: res.status,
      oldOwnerCredited: (await balanceOf(oldOwner)) - oldOwnerBefore,
      buyerCharged: buyerBefore - (await balanceOf(buyer)),
      newOwnerOwns: await owns(newOwner, item.id),
    }).toEqual({ status: 409, oldOwnerCredited: 0, buyerCharged: 0, newOwnerOwns: true });
  }, 60_000);

  it('a pickup is not handed over after the card was sold to somebody else', async () => {
    // Hand-over re-checks the card, so one that changed owner after the pickup
    // was booked is not handed at the show to the person who no longer owns it.
    const { operator, owner, card, shipmentId } = await bookedPickup('N4 sold');
    const buyer = await reassignBehindTheirBack(owner, card.id, SEED.collector2);

    const handed = await operator.post(`/shipping/shipments/${shipmentId}/hand-over`, HAND_OVER(card.id));
    const held = (await buyer.get(`/vault/items/${card.id}`)).body as { item: { lifecycleState: string } };
    expect({ status: handed.status, buyerOwns: await owns(buyer, card.id), state: held.item?.lifecycleState }).toEqual({
      status: 409,
      buyerOwns: true,
      state: 'stored',
    });
  }, 60_000);

  it('a pickup is not handed over while the card is on hold', async () => {
    // A card frozen by an operator after the pickup was booked must not go out.
    const { operator, owner, card, shipmentId } = await bookedPickup('N4 hold');
    const hold = await operator.post(`/custody/items/${card.id}/hold`);
    expect(hold.status).toBe(201);
    expect(hold.body.changed).toBe(true);

    const handed = await operator.post(`/shipping/shipments/${shipmentId}/hand-over`, HAND_OVER(card.id));
    const after = (await owner.get(`/vault/items/${card.id}`)).body as {
      item: { lifecycleState: string; holdFlag: boolean };
    };
    expect({ status: handed.status, state: after.item?.lifecycleState, held: after.item?.holdFlag }).toEqual({
      status: 409,
      state: 'stored',
      held: true,
    });
  }, 60_000);

  it('a lot listed for sale after its split was accepted is not split', async () => {
    // Splitting a lot its owner has put on sale would let the lot and its cards
    // both be sold.
    const tag = `F117-${Date.now().toString(36)}`;
    const { operator, owner, lot, requestId } = await lotWithAcceptedSplit(tag);
    const listing = await owner.post('/marketplace/listings', { itemId: lot.id, askingPrice: 10_000 });
    expect(listing.status).toBe(201);

    const done = await operator.post(`/services/lot-split/${requestId}/complete`, SPLIT_FORM);
    const parent = (await owner.get(`/vault/items/${lot.id}`)).body as { item: { lotBroken: boolean } };
    expect({ status: done.status, children: await childrenOf(owner, tag), lotBroken: parent.item?.lotBroken }).toEqual({
      status: 409,
      children: 0,
      lotBroken: false,
    });
  }, 60_000);

  it('completing one lot split twice produces its cards once', async () => {
    // An unlocked read of the lot, with each child intaken in its own
    // transaction, would let a second Complete split the lot again.
    const tag = `SPLITx2-${Date.now().toString(36)}`;
    const { operator, owner, requestId } = await lotWithAcceptedSplit(tag);

    const res = await Promise.all(
      Array.from({ length: 5 }, () => operator.post(`/services/lot-split/${requestId}/complete`, SPLIT_FORM)),
    );

    expect({ wins: wins(res), children: await childrenOf(owner, tag) }).toEqual({ wins: 1, children: 8 });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('one confirmation token creates one transfer proposal', async () => {
    // A token checked and then marked used by id alone would let parallel
    // submissions of one token each create a proposal.
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Token reuse' });
    const t = await owner.post('/marketplace/transfers', { itemId: item.id, toUsername: 'veteran' });
    expect(t.status).toBe(201);

    const res = await Promise.all(
      Array.from({ length: 6 }, () =>
        owner.post('/marketplace/transfers/confirm', { confirmationToken: t.body.confirmationToken }),
      ),
    );
    const swaps = (await owner.get('/marketplace/swaps')).body as Array<{
      status: string;
      offeredItems: Array<{ id: string }>;
    }>;
    const proposals = swaps.filter((s) => s.status === 'pending' && s.offeredItems.some((i) => i.id === item.id));

    expect({ wins: wins(res), proposals: proposals.length }).toEqual({ wins: 1, proposals: 1 });
    // A reused token is gone (410) or unknown (400), never a second success.
    expect(res.filter((r) => !ok(r)).every((r) => r.status === 410 || r.status === 400)).toBe(true);
  }, 60_000);

  it('an offer accepted while it is being withdrawn ends one way only', async () => {
    // Accept and reject race on one offer. Exactly one may win, and a completed
    // sale must never carry the label of a withdrawn offer.
    const ROUNDS = 4;
    const PRICE = 10_000;
    const OFFER = 8_000;
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const buyer = await signIn(SEED.collector2);
    await ensureBalance(SEED.collector2, ROUNDS * OFFER);

    const rounds: Array<{ itemId: string; offerId: string }> = [];
    for (let i = 0; i < ROUNDS; i++) {
      const item = await intakeFor(operator, SEED.collector, { description: `Offer race ${i}` });
      const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: PRICE });
      expect(listing.status).toBe(201);
      const offer = await buyer.post(`/marketplace/listings/${listing.body.id}/offers`, { amount: OFFER });
      expect(offer.status).toBe(201);
      rounds.push({ itemId: item.id, offerId: offer.body.id });
    }

    const raced = await Promise.all(
      rounds.map((r) =>
        Promise.all([
          seller.post(`/marketplace/offers/${r.offerId}/respond`, { action: 'accept' }),
          buyer.post(`/marketplace/offers/${r.offerId}/respond`, { action: 'reject' }),
        ]),
      ),
    );

    const offers = (await buyer.get('/marketplace/offers/mine')).body as Array<{ id: string; status: string }>;
    const outcomes = await Promise.all(
      rounds.map(async (r, i) => ({
        wins: wins(raced[i]!),
        sold: await owns(buyer, r.itemId),
        offer: offers.find((o) => o.id === r.offerId)?.status,
      })),
    );
    const sale = { wins: 1, sold: true, offer: 'accepted' };
    const withdrawn = { wins: 1, sold: false, offer: 'rejected' };
    const inconsistent = outcomes.filter(
      (o) => JSON.stringify(o) !== JSON.stringify(sale) && JSON.stringify(o) !== JSON.stringify(withdrawn),
    );
    expect(inconsistent).toEqual([]);
    expect(raced.every(losersAre4xx)).toBe(true);
  }, 60_000);

  it('an escrow deal does not settle after the seller sold the card elsewhere', async () => {
    // Settlement re-checks the owner, so a card that has passed to a third person
    // is not taken from them and the seller is not paid.
    const VALUE = 100_000;
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const buyer = await signIn(SEED.collector2);

    const raised = await seller.post('/escrow', {
      raiserRole: 'seller',
      counterpartyUsername: 'golden',
      description: 'Escrow card sold elsewhere',
      valueMinor: VALUE,
      settlement: 'buyer_vault',
    });
    expect(raised.status).toBe(201);
    const dealId = raised.body.id as string;
    expect((await buyer.post(`/escrow/${dealId}/agree`, {})).status).toBe(201);
    await ensureBalance(SEED.collector2, VALUE);
    expect((await buyer.post(`/escrow/${dealId}/fund`, {})).status).toBe(201);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Escrow card' });
    expect((await operator.post(`/escrow/${dealId}/receive-item`, { itemId: card.id })).status).toBe(201);
    expect(
      (await operator.post(`/escrow/${dealId}/inspect`, { matches: true, notes: 'Slab intact, cert matches.' })).status,
    ).toBe(201);

    // The card is still on the seller's shelf. It can no longer be listed while
    // the deal is open, but it can still change hands another way.
    const third = await reassignBehindTheirBack(seller, card.id, SEED.collector3);

    const sellerBefore = await balanceOf(seller);
    const buyerRelease = await buyer.post(`/escrow/${dealId}/release`, {});
    expect(buyerRelease.status).toBe(201);
    expect(buyerRelease.body.status).toBe('awaiting_release');
    const sellerRelease = await seller.post(`/escrow/${dealId}/release`, {});

    expect({
      status: sellerRelease.status,
      sellerCredited: (await balanceOf(seller)) - sellerBefore,
      deal: ((await seller.get(`/escrow/${dealId}`)).body as { deal: { status: string } }).deal.status,
      thirdOwns: await owns(third, card.id),
      buyerOwns: await owns(buyer, card.id),
    }).toEqual({ status: 409, sellerCredited: 0, deal: 'awaiting_release', thirdOwns: true, buyerOwns: false });
  }, 60_000);
});
