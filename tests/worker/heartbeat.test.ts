import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { BASE } from '../integration/helpers/http';
import { testPool } from './helpers/db';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

const probe = async () => {
  const res = await fetch(`${BASE}/readyz/worker`);
  return { status: res.status, text: await res.text() };
};

describe('GET /readyz/worker', () => {
  it('answers 503 while outbox dispatch has never succeeded', async () => {
    await pool.query(`DELETE FROM worker_heartbeat WHERE job_name = 'outbox.dispatch'`).catch(() => undefined);
    expect((await probe()).status).toBe(503);
  });

  it('answers 200 with each job\'s last success once dispatch has run, and 503 when that goes stale', async () => {
    const { runScheduledJob } = await import('../../apps/worker/src/heartbeat');
    const { dispatchOutbox } = await import('../../apps/worker/src/jobs/outbox-dispatch');

    await runScheduledJob(pool, 'outbox.dispatch', () => dispatchOutbox(pool));

    const fresh = await probe();
    expect(fresh.status).toBe(200);
    const body = JSON.parse(fresh.text) as { status: string; jobs: Record<string, { lastSuccessAt: string | null }> };
    expect(body.status).toBe('ok');
    const at = Date.parse(body.jobs['outbox.dispatch']!.lastSuccessAt!);
    expect(Date.now() - at).toBeLessThan(60_000);

    await pool.query(
      `UPDATE worker_heartbeat SET last_success_at = now() - interval '6 minutes' WHERE job_name = 'outbox.dispatch'`,
    );
    expect((await probe()).status).toBe(503);
  });

  it('records a failure without touching the last success, and never shows the error text', async () => {
    const { runScheduledJob } = await import('../../apps/worker/src/heartbeat');
    await runScheduledJob(pool, 'outbox.dispatch', async () => undefined);

    const secretish = 'connect ECONNREFUSED smtp.example.invalid:587 user=someone@example.invalid';
    await expect(
      runScheduledJob(pool, 'outbox.dispatch', async () => {
        throw new Error(secretish);
      }),
    ).rejects.toThrow(secretish);

    const { rows } = await pool.query<{ fresh: boolean; last_error: string }>(
      `SELECT last_success_at > now() - interval '1 minute' AS fresh, last_error
         FROM worker_heartbeat WHERE job_name = 'outbox.dispatch'`,
    );
    expect(rows[0]!.fresh).toBe(true);
    expect(rows[0]!.last_error).toContain('ECONNREFUSED');

    const res = await probe();
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('ECONNREFUSED');
    expect(res.text).not.toContain('example.invalid');
  });
});
