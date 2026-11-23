import { afterAll, describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import { assertTransition } from '../../apps/api/src/modules/cst/lifecycle';

afterAll(closeDb);

describe('a code that matches more than one item', () => {
  it('is refused instead of acting on whichever row the database returns first', async () => {
    const operator = await signIn(SEED.operator);
    const red = await intakeFor(operator, SEED.collector, { description: 'Red’s card' });
    const golden = await intakeFor(operator, SEED.collector2, { description: 'Golden’s card' });
    await sql(`UPDATE item SET barcode = $1 WHERE id = $2`, [`${golden.serialNumber}-LABEL`, golden.id]);
    await sql(`UPDATE item SET barcode = $1 WHERE id = $2`, [golden.serialNumber, red.id]);

    const held = await operator.post(`/custody/items/${encodeURIComponent(golden.serialNumber as string)}/hold`);
    expect(held.status).toBe(409);
    expect(held.body.error.message).toBe('That code matches more than one item; scan the barcode');
    const rows = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM item WHERE id = any($1) AND hold_flag`, [
      [red.id, golden.id],
    ]);
    expect(rows[0]!.n).toBe(0);
  });
});

describe('relocating', () => {
  it('refuses an item that has left the building, a split lot and a retired shelf', async () => {
    const operator = await signIn(SEED.operator);
    const shelves = (await operator.get('/custody/bins')).body as { id: string; active: boolean; oversized: boolean }[];
    const shelf = shelves.find((b) => b.active && !b.oversized)!;

    const gone = await intakeFor(operator, SEED.collector, { description: 'Shipped already' });
    await sql(`UPDATE item SET lifecycle_state = 'shipped', bin_id = NULL WHERE id = $1`, [gone.id]);
    const moved = await operator.post(`/custody/items/${gone.id}/relocate`, { binId: shelf.id });
    expect(moved.status).toBe(409);
    expect(moved.body.error.message).toBe('This item is shipped, so it is not on a shelf here to move');

    const lot = await intakeFor(operator, SEED.collector, { typeClass: 'sealed_box', isLot: true, lotSize: 2 });
    expect((await operator.post(`/intake/items/${lot.id}/break-lot`)).status).toBe(201);
    expect((await operator.post(`/custody/items/${lot.id}/relocate`, { binId: shelf.id })).status).toBe(409);

    const card = await intakeFor(operator, SEED.collector, { description: 'Still here' });
    const retired = await operator.post('/custody/bins', { zone: `ZZ-RETIRED-${Date.now()}` });
    expect(retired.status).toBe(201);
    expect((await operator.patch(`/custody/bins/${retired.body.id}`, { active: false })).status).toBe(200);
    const toRetired = await operator.post(`/custody/items/${card.id}/relocate`, { binId: retired.body.id });
    expect(toRetired.status).toBe(400);
    expect(toRetired.body.error.message).toMatch(/out of service/);
  });
});

describe('history and timeline by scan', () => {
  it('take the serial or barcode as hold and relocate do', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'History by scan' });
    const history = await operator.get(`/custody/items/${encodeURIComponent(item.serialNumber as string)}/history`);
    expect(history.status).toBe(200);
    expect((history.body as { eventType: string }[]).some((e) => e.eventType === 'intake')).toBe(true);
    const timeline = await operator.get(`/custody/items/${encodeURIComponent(item.barcode as string)}/timeline`);
    expect(timeline.status).toBe(200);
    expect((timeline.body as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('an item move that is not allowed', () => {
  it('is refused in plain words, with both states kept in the details', () => {
    let caught: unknown;
    try {
      assertTransition('shipped', 'stored');
    } catch (e) {
      caught = e;
    }
    const body = (caught as { getResponse(): { message: string; details: Record<string, string> } }).getResponse();
    expect(body.message).toBe('This item is shipped, so it cannot be stored now');
    expect(body.details).toEqual({ from: 'shipped', to: 'stored' });
  });
});

describe('the inventory report PDF', () => {
  it('prints its title without question marks for characters the font cannot show', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.getText('/custody/report.pdf');
    expect(res.status).toBe(200);
    expect(res.text).toContain('(Card Embassy - Inventory Report)');
    expect(res.text).not.toMatch(/\([^()]*\?[^()]*\) Tj/);
  });
});
