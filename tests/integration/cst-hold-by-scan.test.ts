import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

/**
 * Placing and lifting a hold from a scan.
 *
 * The warehouse hold panel asks the operator to scan the card, and a scan
 * produces the printed BARCODE; a person reading the label by eye types the
 * serial. The internal id is on no label. The hold routes take all three, as
 * the relocate route beside them does.
 *
 * Requires a running API + a freshly seeded DB.
 */
describe('a hold by whatever the scanner produced', () => {
  it('places a hold by barcode and lifts it by serial', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Hold by scan' });
    expect(item.barcode).toBeTruthy();

    const placed = await operator.post(`/custody/items/${encodeURIComponent(item.barcode)}/hold`);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body).toMatchObject({ status: 'hold_placed', changed: true, itemId: item.id });

    // Lower case, as a person types it.
    const lifted = await operator.del(`/custody/items/${encodeURIComponent(String(item.serialNumber).toLowerCase())}/hold`);
    expect(lifted.status, JSON.stringify(lifted.body)).toBe(200);
    expect(lifted.body).toMatchObject({ status: 'hold_released', changed: true, itemId: item.id });

    // One event each, on the right card.
    const history = (await operator.get(`/custody/items/${item.id}/history`)).body as { eventType: string }[];
    expect(history.filter((e) => e.eventType === 'hold_placed')).toHaveLength(1);
    expect(history.filter((e) => e.eventType === 'hold_released')).toHaveLength(1);
  });

  it('still takes the internal id', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Hold by id' });
    const placed = await operator.post(`/custody/items/${item.id}/hold`);
    expect(placed.body).toMatchObject({ status: 'hold_placed', changed: true });
  });

  it('says plainly when nothing matches the scan, and never 5xx on rubbish', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post(`/custody/items/NO-SUCH-LABEL/hold`);
    expect(res.status).toBe(404);
    for (const id of ['00000000-0000-0000-0000-000000000000', '1 OR 1=1', '../../etc/passwd']) {
      const placed = await operator.post(`/custody/items/${encodeURIComponent(id)}/hold`);
      const lifted = await operator.del(`/custody/items/${encodeURIComponent(id)}/hold`);
      expect([placed.status, lifted.status], id).toEqual([404, 404]);
    }
  });
});
