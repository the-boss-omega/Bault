import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn, type Client } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import { createDb, type Database } from '../../apps/api/src/db/client';
import { LedgerService } from '../../apps/api/src/modules/pay/ledger.service';
import { WalletService } from '../../apps/api/src/modules/pay/wallet.service';
import { OutboxService } from '../../apps/api/src/modules/not/outbox/outbox.service';
import { ParcelProfileService } from '../../apps/api/src/modules/shp/parcel-profile.service';
import { ShipmentService } from '../../apps/api/src/modules/shp/shipment.service';
import { HumanFulfilmentService } from '../../apps/api/src/modules/shp/human-fulfilment.service';

/**
 * A hand-delivery request and the event that tells the collector it arrived.
 *
 * The event is written to the outbox, and the worker turns it into the
 * notification. Written in a transaction of its own after the shipment, a
 * failure there left a request nobody was told about: the shipment committed,
 * the event never did. Written in the same transaction, the two exist
 * together or not at all.
 *
 * The failure is forced with the real service in this process and an outbox
 * that refuses to write, against the database the running API uses.
 *
 * Requires a running API + a freshly seeded DB.
 */

let db: Database;
let close: () => Promise<void>;
let operator: Client;
let collector: Client;
let collectorId: string;

beforeAll(async () => {
  const made = createDb();
  db = made.db;
  close = () => made.pool.end();
  operator = await signIn(SEED.operator);
  collector = await signIn(SEED.collector);
  collectorId = (await collector.get('/me/profile')).body.id as string;
});

afterAll(async () => {
  await close();
  await closeDb();
});

const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const request = (itemId: string) => ({
  itemIds: [itemId],
  pickupAddress: 'Bault NJ vault',
  pickupFrom: soon(5),
  pickupTo: soon(6),
  deliveryAddress: 'The Langham, Boston MA',
  deliverFrom: soon(6),
  deliverTo: soon(7),
  destinationCountry: 'US',
});

/** The hand-delivery shipments carrying the item, each with its `white_glove_requested` count. */
const requestsFor = (itemId: string) =>
  sql<{ id: string; events: number }>(
    `select s.id,
            (select count(*)::int from outbox_message o
              where o.event_type = 'white_glove_requested' and o.aggregate_id = s.id::text) as events
       from shipment s
      where s.item_ids ? $1 and s.fulfilment_method = 'hand_delivery'`,
    [itemId],
  );

describe('a hand-delivery request is recorded with its event', () => {
  it('records the request and its event together', async () => {
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Hand delivery event' });
    expect((await collector.post('/shipping/white-glove', request(card.id))).status).toBe(201);
    expect(await requestsFor(card.id)).toEqual([expect.objectContaining({ events: 1 })]);
  });

  it('records neither when the event cannot be written', async () => {
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Hand delivery, outbox down' });

    const outbox = new OutboxService(db);
    outbox.emit = async () => {
      throw new Error('outbox unavailable');
    };
    const ledger = new LedgerService(db);
    const profiles = new ParcelProfileService(db);
    const shipments = new ShipmentService(
      db,
      undefined as never,
      undefined as never,
      ledger,
      undefined as never,
      profiles,
      outbox,
      undefined as never,
    );
    const service = new HumanFulfilmentService(
      db,
      undefined as never,
      ledger,
      new WalletService(ledger),
      undefined as never,
      outbox,
      profiles,
      shipments,
      undefined as never,
    );

    await expect(service.requestHandDelivery(collectorId, request(card.id))).rejects.toThrow('outbox unavailable');
    // No request without its event: the shipment went with the event that failed.
    expect(await requestsFor(card.id)).toEqual([]);
  });
});
