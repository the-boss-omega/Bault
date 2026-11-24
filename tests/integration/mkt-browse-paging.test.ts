import { describe, it, expect, beforeAll } from 'vitest';
import { BASE, SEED, fundWallet, intakeFor, signIn } from './helpers/http';

interface Row {
  id: string;
  askingPrice: number;
}

async function browse(query: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}/marketplace/listings?${query}`);
  return { status: res.status, body: await res.json() };
}

describe('MKT Browse pages past the first 50 listings', () => {
  const tag = `BPAGE${Date.now()}`;
  const LISTINGS = 55;
  const listed: Row[] = [];

  beforeAll(async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 500_000);
    for (let i = 0; i < LISTINGS; i++) {
      const card = await intakeFor(operator, SEED.collector, { description: `${tag} card ${i}` });
      const askingPrice = 1_000 + (i % 7) * 100;
      const res = await seller.post('/marketplace/listings', { itemId: card.id, askingPrice });
      if (res.status !== 201) throw new Error(`listing failed: ${JSON.stringify(res.body)}`);
      listed.push({ id: res.body.id as string, askingPrice });
    }
  }, 180_000);

  async function walk(sort: string, size: number): Promise<{ rows: Row[]; sizes: number[] }> {
    const rows: Row[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const res = await browse(`q=${tag}&sort=${sort}&limit=${size}${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      const page = res.body as Row[];
      sizes.push(page.length);
      rows.push(...page);
      if (page.length < size) break;
      cursor = page[page.length - 1]!.id;
    }
    return { rows, sizes };
  }

  it('the first page holds 50 and the cursor reaches the rest, newest first', async () => {
    const { rows, sizes } = await walk('newest', 50);
    expect(sizes).toEqual([50, 5]);
    expect(rows.map((r) => r.id)).toEqual([...listed].reverse().map((r) => r.id));
  });

  it('keeps a price order across pages even when prices tie', async () => {
    for (const sort of ['price_asc', 'price_desc'] as const) {
      const { rows } = await walk(sort, 8);
      expect(rows).toHaveLength(LISTINGS);
      expect(new Set(rows.map((r) => r.id)).size).toBe(LISTINGS);
      const prices = rows.map((r) => r.askingPrice);
      const sorted = [...prices].sort((a, b) => (sort === 'price_asc' ? a - b : b - a));
      expect(prices).toEqual(sorted);
    }
  });

  it('refuses a cursor that is not a listing', async () => {
    expect((await browse(`cursor=not-an-id`)).status).toBe(400);
    expect((await browse(`cursor=00000000-0000-4000-8000-000000000000`)).status).toBe(400);
  });
});
