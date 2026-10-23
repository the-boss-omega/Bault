import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createUser, testPool } from './helpers/db';

const calls: { code: string; auth: string | undefined }[] = [];
const answers: Record<string, { status: number; body: unknown }> = {};
let server: Server;
let pool: Pool;
const saved = { ...process.env };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const code = (JSON.parse(raw || '{}') as { tracker?: { tracking_code?: string } }).tracker?.tracking_code ?? '';
      calls.push({ code, auth: req.headers.authorization });
      const answer = answers[code] ?? { status: 200, body: { status: 'in_transit' } };
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  process.env.SHIPPING_PROVIDER = 'easypost';
  process.env.EASYPOST_API_KEY = 'EZTK_worker_suite_not_a_real_key';
  process.env.EASYPOST_BASE_URL = `http://127.0.0.1:${port}/v2`;
  pool = testPool();
});

afterAll(async () => {
  process.env = saved;
  await pool.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function shipment(pool: Pool, tracking: string, status = 'shipped'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO shipment (user_id, item_ids, destination_address, status, tracking_number)
     VALUES ($1, '[]'::jsonb, 'Worker suite, 1 Test Street', $2, $3) RETURNING id`,
    [await createUser(pool), status, tracking],
  );
  return rows[0]!.id;
}

const statusOf = async (pool: Pool, id: string) =>
  (await pool.query<{ status: string }>(`SELECT status FROM shipment WHERE id = $1`, [id])).rows[0]!.status;

describe('tracking refresh', () => {
  it('asks EasyPost when SHIPPING_PROVIDER=easypost, and records a delivery', async () => {
    const { refreshTracking } = await import('../../apps/worker/src/jobs/tracking-refresh');
    const code = `EZ${Date.now()}DELIVERED`;
    answers[code] = { status: 200, body: { status: 'delivered' } };
    const id = await shipment(pool, code);

    await refreshTracking(pool);

    expect(calls.some((c) => c.code === code)).toBe(true);
    expect(calls.find((c) => c.code === code)!.auth).toBe(
      `Basic ${Buffer.from('EZTK_worker_suite_not_a_real_key:').toString('base64')}`,
    );
    expect(await statusOf(pool, id)).toBe('delivered');

    const before = calls.length;
    await refreshTracking(pool);
    expect(calls.filter((c) => c.code === code).length).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(before);
    expect(await statusOf(pool, id)).toBe('delivered');
  });

  it('keeps going past a parcel the carrier errors on (F050)', async () => {
    const { refreshTracking } = await import('../../apps/worker/src/jobs/tracking-refresh');
    const broken = `EZ${Date.now()}BROKEN`;
    const fine = `EZ${Date.now()}FINE`;
    answers[broken] = { status: 500, body: { error: { message: 'carrier timeout' } } };
    answers[fine] = { status: 200, body: { status: 'delivered' } };
    const brokenId = await shipment(pool, broken);
    const fineId = await shipment(pool, fine);

    await refreshTracking(pool);

    expect(await statusOf(pool, fineId)).toBe('delivered');
    expect(await statusOf(pool, brokenId)).toBe('shipped');
  });

  const eventsFor = async (id: string) =>
    (
      await pool.query<{ event_type: string; user_id: string | null }>(
        `SELECT event_type, payload ->> 'userId' AS user_id FROM outbox_message WHERE aggregate_id = $1 ORDER BY created_at`,
        [id],
      )
    ).rows;
  const ownerOf = async (id: string) =>
    (await pool.query<{ user_id: string }>(`SELECT user_id FROM shipment WHERE id = $1`, [id])).rows[0]!.user_id;

  it('tells the collector once when the carrier says the parcel was delivered', async () => {
    const { refreshTracking } = await import('../../apps/worker/src/jobs/tracking-refresh');
    const code = `EZ${Date.now()}TOLDDELIVERED`;
    answers[code] = { status: 200, body: { status: 'delivered' } };
    const id = await shipment(pool, code);

    await refreshTracking(pool);
    await refreshTracking(pool);

    expect(await statusOf(pool, id)).toBe('delivered');
    expect(await eventsFor(id)).toEqual([{ event_type: 'shipment_delivered', user_id: await ownerOf(id) }]);
  });

  it('tells the collector once when the carrier reports a problem', async () => {
    const { refreshTracking } = await import('../../apps/worker/src/jobs/tracking-refresh');
    const code = `EZ${Date.now()}TOLDFAILURE`;
    answers[code] = { status: 200, body: { status: 'return_to_sender' } };
    const id = await shipment(pool, code, 'in_transit');

    await refreshTracking(pool);
    await refreshTracking(pool);

    expect(await statusOf(pool, id)).toBe('exception');
    expect(await eventsFor(id)).toEqual([{ event_type: 'shipment_exception', user_id: await ownerOf(id) }]);
  });

  it('writes no event for a parcel that is merely still on its way', async () => {
    const { refreshTracking } = await import('../../apps/worker/src/jobs/tracking-refresh');
    const code = `EZ${Date.now()}STILLMOVING`;
    answers[code] = { status: 200, body: { status: 'in_transit' } };
    const id = await shipment(pool, code, 'in_transit');
    await refreshTracking(pool);
    expect(await eventsFor(id)).toEqual([]);
  });

  it('does not touch a parcel whose status the carrier does not recognise', async () => {
    const { refreshTracking } = await import('../../apps/worker/src/jobs/tracking-refresh');
    const code = `EZ${Date.now()}UNKNOWN`;
    answers[code] = { status: 200, body: { status: 'something_new' } };
    const id = await shipment(pool, code);
    await refreshTracking(pool);
    expect(await statusOf(pool, id)).toBe('shipped');
  });
});
