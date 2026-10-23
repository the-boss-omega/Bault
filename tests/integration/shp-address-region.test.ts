import { afterAll, describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

const TRENTON = {
  label: 'Trenton',
  recipient: 'Red Ashwood',
  line1: '12 Vine St',
  city: 'Trenton',
  region: 'NJ',
  country: 'US',
  postalCode: '08608',
};

describe('SHP a destination carries its state or province to the carrier', () => {
  it('stores the state with the shipment, where the label purchase reads it', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const collector = await signIn(SEED.collector);
    const addressId = (await collector.post('/me/addresses', TRENTON)).body.id as string;

    const created = await collector.post('/shipping/shipments', { itemIds: [card.id], addressId });
    expect(created.status).toBe(201);

    const [row] = await sql<{ detail: { region?: string }; formatted: string }>(
      'SELECT destination_detail AS detail, destination_address AS formatted FROM shipment WHERE id = $1',
      [created.body.id],
    );
    expect(row?.detail.region).toBe('NJ');
    expect(row?.formatted).toContain('Trenton, NJ 08608');
  });

  it('refuses to quote or ship to a saved US address with no state, naming the address to fix', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const collector = await signIn(SEED.collector);
    const addressId = (await collector.post('/me/addresses', { ...TRENTON, label: 'Saved before states' })).body
      .id as string;
    await sql('UPDATE shipping_address SET region = NULL WHERE id = $1', [addressId]);
    const before = ((await collector.get('/shipping/shipments')).body as unknown[]).length;

    const quote = await collector.post('/shipping/quote', { itemIds: [card.id], addressId });
    expect(quote.status).toBe(422);
    expect(quote.body.error.code).toBe('address_region_required');
    expect(quote.body.error.details).toMatchObject({ addressId });
    expect(quote.body.error.message).toMatch(/Saved before states/);

    const ship = await collector.post('/shipping/shipments', { itemIds: [card.id], addressId });
    expect(ship.status).toBe(422);
    expect(ship.body.error.code).toBe('address_region_required');
    expect(((await collector.get('/shipping/shipments')).body as unknown[]).length).toBe(before);
  });
});
