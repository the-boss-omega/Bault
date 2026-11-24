import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql } from '../integration/helpers/db';

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;

let showId: string | undefined;

afterAll(async () => {
  if (showId) await sql('update consignment_event set active = false where id = $1', [showId]);
  await closeDb();
});

async function sixAtOnce(path: string, body: Record<string, unknown>) {
  const operator = await signIn(SEED.operator);
  const collector = await signIn(SEED.collector);
  await fundWallet(SEED.collector, 10_000);
  const card = await intakeFor(operator, SEED.collector, { description: `Six at once: ${path}` });

  const res = await Promise.all(
    Array.from({ length: 6 }, () => collector.post(path, { itemId: card.id, ...body })),
  );

  const [requests] = await sql<{ n: number }>(
    `select count(*)::int as n from service_request where item_id = $1`,
    [card.id],
  );
  const [charges] = await sql<{ n: number }>(
    `select count(*)::int as n from charge where reference_id = $1 and action_type = 'service'`,
    [card.id],
  );
  return { res, requests: requests!.n, charges: charges!.n };
}

describe('concurrency: service capacity and one charge per job', () => {
  it('two collectors taking the last consignment place at a show: exactly one gets it', async () => {
    const day = 86_400_000;
    const [show] = await sql<{ id: string }>(
      `insert into consignment_event (name, venue, city, starts_at, ends_at, request_deadline, capacity)
       values ($1, 'Hall D', 'Secaucus', $2, $3, $4, 1) returning id`,
      [`Last table at the show ${Date.now()}`, new Date(Date.now() + 10 * day), new Date(Date.now() + 11 * day), new Date(Date.now() + 5 * day)],
    );
    showId = show!.id;

    const operator = await signIn(SEED.operator);
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    await fundWallet(SEED.collector, 5_000);
    await fundWallet(SEED.collector2, 5_000);
    const redCard = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Last table: Red' });
    const goldenCard = await intakeFor(operator, SEED.collector2, { typeClass: 'graded_slab', description: 'Last table: Golden' });

    const holdRed = await holdRowLock('item', redCard.id);
    const holdGolden = await holdRowLock('item', goldenCard.id);
    let requests: Promise<Res>[] = [];
    try {
      requests = [
        red.post('/services/consignment', { itemId: redCard.id, channel: 'card_show', askingMinor: 20_000, eventId: showId }),
        golden.post('/services/consignment', { itemId: goldenCard.id, channel: 'card_show', askingMinor: 20_000, eventId: showId }),
      ];
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      await Promise.all([holdRed.release(), holdGolden.release()]);
    }
    const res = await Promise.all(requests);

    expect(res.filter(ok)).toHaveLength(1);
    expect(res.filter((r) => !ok(r)).map((r) => r.status)).toEqual([409]);
    const [taken] = await sql<{ n: number }>(
      `select count(*)::int as n from service_request where type = 'consignment' and type_fields ->> 'eventId' = $1`,
      [showId],
    );
    expect(taken!.n).toBe(1);
  });

  it.each([
    ['photography', '/services/photography', {}],
    ['video', '/services/video', {}],
    ['inspection', '/services/inspection', { areas: ['corners', 'surface'] }],
  ])('six %s requests for one card at once: one is created and charged', async (_name, path, body) => {
    const { res, requests, charges } = await sixAtOnce(path, body);
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => !ok(r)).map((r) => r.status)).toEqual([409, 409, 409, 409, 409]);
    expect(requests).toBe(1);
    expect(charges).toBe(1);
  });
});
