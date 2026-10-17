import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';
import { activeAccount, passwordOnly } from './helpers/mfa';
import { closeDb } from './helpers/db';
import type { LabelResult, Rate, RateRequest, ShippingAdapter, ShippingCallOptions, TrackingStatus } from '@bault/adapters';
import { createDb, type Database } from '../../apps/api/src/db/client';
import { CustodyService } from '../../apps/api/src/modules/cst/custody.service';
import { OutboxService } from '../../apps/api/src/modules/not/outbox/outbox.service';
import { ParcelProfileService } from '../../apps/api/src/modules/shp/parcel-profile.service';
import { ShipmentService } from '../../apps/api/src/modules/shp/shipment.service';
import { DispatchService } from '../../apps/api/src/modules/shp/dispatch.service';

/**
 * Buying a label is a call to somebody else's computer, and it costs money that
 * cannot be rolled back.
 *
 * So dispatch buys the label OUTSIDE the transaction that holds the shipment and
 * every card in it `FOR UPDATE`, with a timeout. Both reasons are driven here:
 *
 *   - rows locked across the purchase would stay locked for as long as the
 *     carrier took to answer, so other work on those cards would queue behind a
 *     network call;
 *   - anything that fails AFTER the purchase (a card that changed state, a
 *     failed commit) must not roll back the tracking number while the label
 *     stays bought, or a retry would buy a second one.
 *
 * The carrier here is a fake, because the only way to make a purchase succeed
 * and then fail what follows is to control the carrier. Everything else is the
 * real thing: the real `DispatchService` and custody kernel in this process,
 * against the same database the running API uses, with the shipment set up
 * through the API exactly as a collector and an operator would.
 *
 * Requires a running API + a freshly seeded DB.
 */

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
// Resolved from the API's own dependencies, the same copy its services use.
const { sql } = apiRequire('drizzle-orm') as typeof import('drizzle-orm');

/** What the fake carrier is told to do when asked for a label. */
type Behaviour = 'sell' | 'refuse' | 'lose-the-answer';

class FakeCarrier implements ShippingAdapter {
  purchases = 0;
  keys: (string | undefined)[] = [];
  signals: (AbortSignal | undefined)[] = [];
  /** Run during the purchase, while dispatch is waiting on the carrier. */
  duringPurchase: () => Promise<void> = async () => {};

  constructor(public behaviour: Behaviour = 'sell') {}

  async getRates(): Promise<Rate[]> {
    return [];
  }

  async buyLabel(rate: Rate, _req: RateRequest, opts: ShippingCallOptions = {}): Promise<LabelResult> {
    this.purchases += 1;
    this.keys.push(opts.idempotencyKey);
    this.signals.push(opts.signal);
    await this.duringPurchase();
    if (this.behaviour === 'refuse') {
      const { LabelNotPurchasedError } = apiRequire('@bault/adapters') as typeof import('@bault/adapters');
      throw new LabelNotPurchasedError('EasyPost 422: rate expired');
    }
    if (this.behaviour === 'lose-the-answer') throw new Error('socket hang up');
    return { trackingNumber: `FAKE-${opts.idempotencyKey?.slice(0, 8)}`, labelObjectKey: 'labels/fake.pdf', costMinor: rate.costMinor, currency: 'USD' };
  }

  async getTracking(trackingNumber: string): Promise<TrackingStatus> {
    return { trackingNumber, status: 'unknown' };
  }
}

let db: Database;
let close: () => Promise<void>;
let operator: Client;
let operatorId: string;

beforeAll(async () => {
  const made = createDb();
  db = made.db;
  close = () => made.pool.end();
  operator = await signIn(SEED.operator);
  operatorId = (await operator.get('/me/profile')).body.id as string;
});

afterAll(async () => {
  await close();
  await closeDb();
});

/** The services dispatch uses, built the way Nest builds them, with this carrier. */
function dispatchWith(carrier: ShippingAdapter) {
  const outbox = new OutboxService(db);
  const custody = new CustodyService(db, outbox);
  const profiles = new ParcelProfileService(db);
  const shipments = new ShipmentService(
    db,
    carrier,
    undefined as never,
    undefined as never,
    undefined as never,
    profiles,
    outbox,
    undefined as never,
  );
  return { dispatch: new DispatchService(db, carrier, custody, outbox, shipments), custody };
}

/** A paid, ready-to-dispatch shipment of one fresh card. */
async function readyShipment(label: string) {
  const card = await intakeFor(operator, SEED.collector, { description: `F049: ${label}` });
  const collector = await signIn(SEED.collector);
  await fundWallet(SEED.collector, 50_000);
  const s = (
    await collector.post('/shipping/shipments', {
      itemIds: [card.id],
      destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
      destinationCountry: 'US',
      destinationPostalCode: '94102',
    })
  ).body;
  const rates = (await collector.get(`/shipping/shipments/${s.id}/rates`)).body as {
    carrier: string;
    serviceLevel: string;
    eligible: boolean;
  }[];
  const pick = rates.find((r) => r.eligible)!;
  const selected = await collector.post(`/shipping/shipments/${s.id}/select-rate`, {
    carrier: pick.carrier,
    serviceLevel: pick.serviceLevel,
  });
  expect(selected.body.status).toBe('rates_selected');
  return { shipmentId: s.id as string, itemId: card.id as string, collector };
}

const FORM = (itemId: string) => ({
  scannedItemIds: [itemId],
  carrier: 'USPS',
  packageWeightGrams: 220,
  fulfillmentNotes: 'Top-loader in a rigid mailer.',
});

describe('dispatch buys the label outside the transaction (F049)', () => {
  it('keeps the tracking number of a label bought before a card changed, and does not buy it twice', async () => {
    const { shipmentId, itemId, collector } = await readyShipment('held mid-purchase');
    const carrier = new FakeCarrier('sell');
    const { dispatch, custody } = dispatchWith(carrier);

    // While the carrier is selling the label, somebody puts a hold on the card.
    // With the rows locked across the purchase this waits for the dispatch and
    // gives up; without the lock it simply happens.
    let heldDuringPurchase = false;
    carrier.duringPurchase = async () => {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '1500ms'`);
          await custody.setHold(tx, itemId, true, operatorId);
        });
        heldDuringPurchase = true;
      } catch {
        heldDuringPurchase = false;
      }
    };

    const first = await dispatch.dispatch(operatorId, shipmentId, FORM(itemId)).catch((e: unknown) => e);
    expect(heldDuringPurchase, 'the card was locked for as long as the carrier took').toBe(true);

    // The card is on hold now, so it must not leave — but the label was paid
    // for, and its tracking number is on the shipment rather than lost.
    expect((first as { getStatus?: () => number }).getStatus?.()).toBe(409);
    const kept = (await collector.get(`/shipping/shipments/${shipmentId}`)).body;
    expect(kept.status).toBe('labeled');
    expect(kept.trackingNumber).toBe(`FAKE-${shipmentId.slice(0, 8)}`);

    // Hold lifted, dispatch again: it completes with the label already bought.
    carrier.duringPurchase = async () => {};
    expect((await operator.del(`/custody/items/${itemId}/hold`)).status).toBe(200);
    const second = await dispatch.dispatch(operatorId, shipmentId, FORM(itemId));
    expect(second).toMatchObject({ status: 'shipped', trackingNumber: `FAKE-${shipmentId.slice(0, 8)}` });
    expect(carrier.purchases).toBe(1);

    const card = (await collector.get(`/vault/items/${itemId}`)).body;
    expect(card.item.lifecycleState).toBe('shipped');
  });

  it('bounds the purchase and names it by the shipment, so a retry is the same purchase', async () => {
    const { shipmentId, itemId, collector } = await readyShipment('answer lost');
    const carrier = new FakeCarrier('lose-the-answer');
    const { dispatch } = dispatchWith(carrier);

    const lost = await dispatch.dispatch(operatorId, shipmentId, FORM(itemId)).catch((e: unknown) => e);
    expect((lost as { getStatus?: () => number }).getStatus?.()).toBe(502);
    // Nobody knows whether the carrier sold it, so the shipment is not handed
    // back as if nothing happened: it stays claimed, and cannot be cancelled.
    expect((await collector.get(`/shipping/shipments/${shipmentId}`)).body.status).toBe('labeled');
    expect((await collector.post(`/shipping/shipments/${shipmentId}/cancel`, { reason: 'changed my mind' })).status).toBe(409);

    carrier.behaviour = 'sell';
    const done = await dispatch.dispatch(operatorId, shipmentId, FORM(itemId));
    expect(done.status).toBe('shipped');
    // Both attempts asked for the same purchase, each with a deadline.
    expect(carrier.keys).toEqual([shipmentId, shipmentId]);
    expect(carrier.signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it('hands the shipment back when the carrier refuses, because nothing was bought', async () => {
    const { shipmentId, itemId, collector } = await readyShipment('refused');
    const carrier = new FakeCarrier('refuse');
    const { dispatch } = dispatchWith(carrier);

    const refused = await dispatch.dispatch(operatorId, shipmentId, FORM(itemId)).catch((e: unknown) => e);
    expect((refused as { getStatus?: () => number }).getStatus?.()).toBe(502);
    const back = (await collector.get(`/shipping/shipments/${shipmentId}`)).body;
    expect(back.status).toBe('rates_selected');
    expect(back.trackingNumber).toBeNull();
  });

  it('refuses a second dispatch while the first is still buying', { timeout: 15_000 }, async () => {
    const { shipmentId, itemId } = await readyShipment('two operators');
    const carrier = new FakeCarrier('sell');
    const { dispatch } = dispatchWith(carrier);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    carrier.duringPurchase = async () => {
      entered();
      await gate;
    };

    const first = dispatch.dispatch(operatorId, shipmentId, FORM(itemId));
    await inside;
    // Answered at once — not left queueing behind the first operator's lock
    // until the carrier replies.
    const attempt = dispatch.dispatch(operatorId, shipmentId, FORM(itemId)).catch((e: unknown) => e);
    const second = await Promise.race([
      attempt,
      new Promise((r) => setTimeout(() => r('still waiting behind the first purchase'), 3_000)),
    ]);
    release();
    await attempt;
    expect((second as { getStatus?: () => number }).getStatus?.()).toBe(409);
    expect((await first).status).toBe('shipped');
    expect(carrier.purchases).toBe(1);
  });
});

/**
 * A label the carrier refuses at dispatch.
 *
 * Nothing was bought, so the shipment goes back to `rates_selected`, paid for.
 * The rate it holds is the one the carrier just turned down, so dispatching it
 * again buys nothing either. The way forward is a fresh rate, chosen by the
 * collector or by an operator, with the difference settled against what was
 * already paid: a cheaper rate's difference comes back, a dearer one's is
 * charged, and neither leaves the cancellation (and its fee) as the only exit.
 */
describe('a label refused at dispatch', () => {
  const walletOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

  /** A paid shipment whose label the carrier has just refused. */
  async function refusedShipment(label: string, pick: 'cheapest' | 'dearest', ownerEmail: string = SEED.collector) {
    const card = await intakeFor(operator, ownerEmail, { description: `Refused label: ${label}` });
    const owner = await signIn(ownerEmail);
    await fundWallet(ownerEmail, 20_000);
    const s = (
      await owner.post('/shipping/shipments', {
        itemIds: [card.id],
        destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
        destinationCountry: 'US',
        destinationPostalCode: '94102',
      })
    ).body;
    const eligible = ((await owner.get(`/shipping/shipments/${s.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
      eligible: boolean;
      totalMinor: number;
    }[])
      .filter((r) => r.eligible)
      .sort((a, b) => a.totalMinor - b.totalMinor);
    expect(eligible.length).toBeGreaterThan(1);
    const chosen = pick === 'cheapest' ? eligible[0]! : eligible[eligible.length - 1]!;

    const beforePaying = await walletOf(owner);
    const selected = await owner.post(`/shipping/shipments/${s.id}/select-rate`, {
      carrier: chosen.carrier,
      serviceLevel: chosen.serviceLevel,
    });
    expect(selected.body.status).toBe('rates_selected');

    const { dispatch } = dispatchWith(new FakeCarrier('refuse'));
    const refused = await dispatch.dispatch(operatorId, s.id, FORM(card.id)).catch((e: unknown) => e);
    expect((refused as { getStatus?: () => number }).getStatus?.()).toBe(502);
    const back = (await owner.get(`/shipping/shipments/${s.id}`)).body;
    expect(back.status).toBe('rates_selected');

    return { shipmentId: s.id as string, itemId: card.id as string, owner, chosen, eligible, beforePaying };
  }

  it('takes a cheaper rate and gives the difference back, once', async () => {
    const { shipmentId, owner, chosen, eligible, beforePaying } = await refusedShipment('cheaper', 'dearest');
    const cheaper = eligible[0]!;
    expect(cheaper.totalMinor).toBeLessThan(chosen.totalMinor);
    const refusedView = (await owner.get(`/shipping/shipments/${shipmentId}`)).body;

    const before = await walletOf(owner);
    const again = await owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: cheaper.carrier,
      serviceLevel: cheaper.serviceLevel,
    });
    expect(again.status).toBe(201);
    // The collector was shown why: the refusal is on the shipment until a new rate replaces it.
    expect(refusedView.labelRefused).toMatchObject({ reason: expect.stringContaining('rate expired') });
    expect(again.body).toMatchObject({ status: 'rates_selected', cost: cheaper.totalMinor });
    expect((await walletOf(owner)) - before).toBe(chosen.totalMinor - cheaper.totalMinor);

    const after = (await owner.get(`/shipping/shipments/${shipmentId}`)).body;
    expect(after).toMatchObject({ status: 'rates_selected', cost: cheaper.totalMinor, carrier: cheaper.carrier });
    expect(after.labelRefused).toBeNull();

    // Paid for again, so a further change is refused as on any paid shipment.
    const third = await owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: chosen.carrier,
      serviceLevel: chosen.serviceLevel,
    });
    expect(third.status).toBe(409);

    // A cancellation now refunds what is actually paid, not the first charge:
    // the collector ends up out the restocking fee and nothing else.
    const cancelled = await owner.post(`/shipping/shipments/${shipmentId}/cancel`, { reason: 'Changed my mind.' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.refundedMinor).toBe(cheaper.totalMinor);
    expect(await walletOf(owner)).toBe(beforePaying - (cancelled.body.restockingFeeMinor as number));
  });

  it('takes the same rate again for nothing, chosen by an operator, and then dispatches', async () => {
    const { shipmentId, itemId, owner, chosen } = await refusedShipment('same', 'cheapest');
    const before = await walletOf(owner);

    const again = await operator.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: chosen.carrier,
      serviceLevel: chosen.serviceLevel,
    });
    expect(again.status).toBe(201);
    expect(again.body.cost).toBe(chosen.totalMinor);
    expect(await walletOf(owner)).toBe(before);

    const { dispatch } = dispatchWith(new FakeCarrier('sell'));
    const shipped = await dispatch.dispatch(operatorId, shipmentId, FORM(itemId));
    expect(shipped.status).toBe('shipped');
  });

  it('takes a dearer rate and charges the difference', async () => {
    const { shipmentId, owner, chosen, eligible } = await refusedShipment('dearer', 'cheapest');
    const dearer = eligible[eligible.length - 1]!;
    expect(dearer.totalMinor).toBeGreaterThan(chosen.totalMinor);

    const before = await walletOf(owner);
    const again = await owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: dearer.carrier,
      serviceLevel: dearer.serviceLevel,
    });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ status: 'rates_selected', cost: dearer.totalMinor });
    expect(before - (await walletOf(owner))).toBe(dearer.totalMinor - chosen.totalMinor);
  });

  it('refuses a dearer rate the wallet cannot cover, and changes nothing', async () => {
    const { shipmentId, owner, chosen, eligible } = await refusedShipment('dearer, short', 'cheapest', SEED.collector3);
    const dearer = eligible[eligible.length - 1]!;

    // Spend whatever is left, so the difference cannot be covered.
    const left = await walletOf(owner);
    if (left > 0) {
      const seller = await signIn(SEED.collector);
      const card = await intakeFor(operator, SEED.collector, { description: 'Refused label: wallet drain' });
      const listing = await seller.post('/marketplace/listings', { itemId: card.id, askingPrice: left });
      expect((await owner.post(`/marketplace/listings/${listing.body.id}/purchase`)).status).toBe(201);
    }
    expect(await walletOf(owner)).toBe(0);

    const short = await owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: dearer.carrier,
      serviceLevel: dearer.serviceLevel,
    });
    expect(short.status).toBe(409);
    expect(await walletOf(owner)).toBe(0);
    const still = (await owner.get(`/shipping/shipments/${shipmentId}`)).body;
    expect(still).toMatchObject({ status: 'rates_selected', cost: chosen.totalMinor, carrier: chosen.carrier });
    expect(still.labelRefused).toBeTruthy();
  });

  it('prices a member the same after a refusal, and spends the allowance once', async () => {
    // A fresh account, so becoming a member changes nobody else's prices.
    const account = await activeAccount('relabel');
    const member = await passwordOnly(account);
    const admin = await signIn(SEED.admin);
    const cashIn = await member.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 30_000,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `relabel-${Date.now()}`,
    });
    expect(cashIn.status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/approve`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/complete`, {})).status).toBe(201);
    expect([200, 201]).toContain((await member.post('/membership/subscribe', { tier: 'folio' })).status);

    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const card = await operator.post('/intake/items', {
      ownerUsername: account.username,
      typeClass: 'trading_card',
      binId: bins[0]!.id,
      description: 'Refused label: member',
    });
    expect(card.status).toBe(201);
    const s = (
      await member.post('/shipping/shipments', {
        itemIds: [card.body.id],
        destinationAddress: 'Two Factor, 1200 Market St, San Francisco 94102, US',
        destinationCountry: 'US',
        destinationPostalCode: '94102',
      })
    ).body;
    type Quoted = { serviceKey: string; carrier: string; serviceLevel: string; eligible: boolean; totalMinor: number; membershipCover: { postageMinor: number } | null };
    const quoted = async () =>
      ((await member.get(`/shipping/shipments/${s.id}/rates`)).body as Quoted[]).filter((r) => r.eligible);
    const fresh = await quoted();
    const covered = fresh.filter((r) => (r.membershipCover?.postageMinor ?? 0) > 0).sort((a, b) => b.totalMinor - a.totalMinor);
    expect(covered.length).toBeGreaterThan(1);
    const first = covered[0]!;
    const second = covered[covered.length - 1]!;
    const usedOf = async () => (await member.get('/membership/me')).body.membership.postage.usedMinor as number;
    const usedBefore = await usedOf();

    expect((await member.post(`/shipping/shipments/${s.id}/select-rate`, { carrier: first.carrier, serviceLevel: first.serviceLevel })).body.status).toBe('rates_selected');
    expect(await usedOf()).toBe(usedBefore + first.membershipCover!.postageMinor);
    const { dispatch } = dispatchWith(new FakeCarrier('refuse'));
    await dispatch.dispatch(operatorId, s.id, FORM(card.body.id)).catch(() => undefined);

    // Quoted as if this parcel had never spent the allowance.
    const again = await quoted();
    expect(again.map((r) => [r.serviceKey, r.totalMinor])).toEqual(fresh.map((r) => [r.serviceKey, r.totalMinor]));

    const before = await walletOf(member);
    const reselected = await member.post(`/shipping/shipments/${s.id}/select-rate`, {
      carrier: second.carrier,
      serviceLevel: second.serviceLevel,
    });
    expect(reselected.status).toBe(201);
    expect((await walletOf(member)) - before).toBe(first.totalMinor - second.totalMinor);
    // The refused rate's cover went back; only the new rate's is spent.
    expect(await usedOf()).toBe(usedBefore + second.membershipCover!.postageMinor);
  });
});
