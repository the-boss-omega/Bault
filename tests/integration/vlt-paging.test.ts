import { describe, it, expect, beforeAll } from 'vitest';
import { SEED, intakeFor, signIn, type Client } from './helpers/http';

interface Row {
  id: string;
  createdAt: string;
}

describe('VLT pages a vault larger than one page', () => {
  const tag = `VPAGE-${Date.now()}`;
  const CARDS = 56;
  const ids: string[] = [];
  let collector: Client;

  beforeAll(async () => {
    const operator = await signIn(SEED.operator);
    for (let i = 0; i < CARDS; i++) {
      const card = await intakeFor(operator, SEED.collector, { description: `${tag} card ${i}` });
      ids.push(card.id as string);
    }
    collector = await signIn(SEED.collector);
  }, 120_000);

  it('returns every card when the limit allows it, not only the newest 50', async () => {
    const res = await collector.get(`/vault/items?scope=active&q=${tag}&limit=500`);
    expect(res.status).toBe(200);
    const rows = res.body as Row[];
    expect(rows).toHaveLength(CARDS);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(ids));
  });

  it('walks the vault page by page with a cursor, newest first, with no card twice or missing', async () => {
    const seen: Row[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const res = await collector.get(
        `/vault/items?scope=active&q=${tag}&limit=20${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      const page = res.body as Row[];
      sizes.push(page.length);
      seen.push(...page);
      if (page.length < 20) break;
      cursor = page[page.length - 1]!.id;
    }
    expect(sizes).toEqual([20, 20, 16]);
    expect(seen.map((r) => r.id)).toEqual([...ids].reverse());
    const times = seen.map((r) => Date.parse(r.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('counts every card in the scope pills, past the old 200 cap of a page', async () => {
    const res = await collector.get(`/vault/counts?q=${tag}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: CARDS, hold: 0, history: 0 });
  });

  it('refuses a limit that is not a whole number and a cursor that is not one of the reader\'s cards', async () => {
    expect((await collector.get(`/vault/items?limit=abc`)).status).toBe(400);
    expect((await collector.get(`/vault/items?limit=0`)).status).toBe(400);
    expect((await collector.get(`/vault/items?cursor=not-an-id`)).status).toBe(400);
    const other = await signIn(SEED.collector2);
    expect((await other.get(`/vault/items?cursor=${ids[0]}`)).status).toBe(400);
  });

  it('walks History with the same cursor and matches its count', async () => {
    const all = (await collector.get('/vault/items?scope=history&limit=500')).body as Row[];
    expect(all.length).toBeGreaterThan(1);
    const walked: Row[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < all.length + 2; guard++) {
      const res = await collector.get(`/vault/items?scope=history&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      const page = res.body as Row[];
      walked.push(...page);
      if (page.length < 1) break;
      cursor = page[0]!.id;
    }
    expect(walked.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(((await collector.get('/vault/counts')).body as { history: number }).history).toBe(all.length);
  });

  it('caps a page at 500', async () => {
    const res = await collector.get(`/vault/items?scope=active&q=${tag}&limit=100000`);
    expect(res.status).toBe(200);
    expect((res.body as Row[]).length).toBe(CARDS);
  });
});
