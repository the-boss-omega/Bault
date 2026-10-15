import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createUser, testPool } from './helpers/db';

/**
 * Tracking refresh with the carrier the deployment is configured for (E17,
 * F039, F050).
 *
 * The job built `new SandboxShippingAdapter()` itself, whatever
 * `SHIPPING_PROVIDER` said. The sandbox answers `in_transit` for every parcel
 * forever, so in production no shipment would ever have reached `delivered`.
 *
 * EasyPost is stood up locally — `EASYPOST_BASE_URL` exists for exactly this —
 * and answers per tracking code, so the suite can see which adapter the job
 * really asked.
 */
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

  // Set BEFORE the config is first read in this file: `loadEnv` caches, and
  // dotenv never overrides a variable that is already set.
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
    // EasyPost's own scheme: the key as the Basic username, no password.
    expect(calls.find((c) => c.code === code)!.auth).toBe(
      `Basic ${Buffer.from('EZTK_worker_suite_not_a_real_key:').toString('base64')}`,
    );
    expect(await statusOf(pool, id)).toBe('delivered');

    // Twice is the same as once: a delivered parcel is no longer polled.
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

    // Before: one carrier error escaped the loop and every parcel after it
    // went unrefreshed, every half hour, for as long as that one kept failing.
    await refreshTracking(pool);

    expect(await statusOf(pool, fineId)).toBe('delivered');
    expect(await statusOf(pool, brokenId)).toBe('shipped');
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
