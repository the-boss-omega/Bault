import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createUser, testPool } from './helpers/db';

/**
 * The ledger-invariant monitor has to be HEARD when it finds something.
 *
 * Nobody watches stderr; an alert that only exists in a log nobody reads is not
 * an alert. A violation goes out at error level in the same JSON as every other
 * log line, so a log alert can match on it, and to the error tracker.
 *
 * The error tracker is a local HTTP server standing in for Sentry's ingest, so
 * the suite sees exactly what the SDK would send, with no account and no network.
 */
const envelopes: string[] = [];
let sentry: Server;
let pool: Pool;
const saved = { ...process.env };

beforeAll(async () => {
  sentry = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      envelopes.push(`${req.url}\n${raw}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => sentry.listen(0, '127.0.0.1', resolve));
  const { port } = sentry.address() as AddressInfo;
  process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${port}/42`;
  // JSON lines, the way every deployed environment writes them.
  process.env.NODE_ENV = 'test';
  pool = testPool();
});

afterAll(async () => {
  process.env = saved;
  await pool.end();
  await new Promise<void>((resolve) => sentry.close(() => resolve()));
});

/** Everything the job writes to stdout and stderr while `fn` runs. */
async function captureOutput(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  // console.* in the job goes through the same streams.
  try {
    await fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return lines;
}

describe('ledger invariant violations', () => {
  it('are logged at error level as JSON and reported to the error tracker', async () => {
    const observability = await import('../../apps/worker/src/observability').catch(() => null);
    observability?.initErrorReporting();
    const { checkLedgerInvariants } = await import('../../apps/worker/src/jobs/ledger-invariant-check');

    // A settled charge with no ledger row behind it: money billed that never
    // reached anybody's balance.
    const user = await createUser(pool);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status)
       VALUES ($1, 'service', '{}'::jsonb, 100, 'USD', 'wallet', 'settled') RETURNING id`,
      [user],
    );
    try {
      const lines = await captureOutput(() => checkLedgerInvariants(pool));

      const parsed = lines.map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      });
      const alert = parsed.find((l) => l && l.level === 'error');
      expect(alert, `no JSON error line among: ${lines.join(' | ')}`).toBeTruthy();
      expect(alert!.message).toMatch(/ledger invariant/i);
      expect(alert!.orphanSettledCharges).toBeGreaterThanOrEqual(1);
      expect(typeof alert!.time).toBe('string');

      await observability?.flushErrorReporting(5_000);
      const report = envelopes.find((e) => e.includes('ledger invariant'));
      expect(report, 'nothing reached the error tracker').toBeTruthy();
      expect(report!.startsWith('/api/42/envelope/')).toBe(true);
    } finally {
      // `charge` is not append-only; leave the next suite a clean ledger.
      await pool.query(`DELETE FROM charge WHERE id = $1`, [rows[0]!.id]);
    }
  });
});
