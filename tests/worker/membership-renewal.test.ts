import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { renewMemberships } from '../../apps/worker/src/jobs/membership-renewal';
import { runScheduledJob } from '../../apps/worker/src/heartbeat';
import { JobName } from '../../apps/worker/src/jobs/registry';
import { log } from '../../apps/worker/src/log';
import { SEED, signIn } from '../integration/helpers/http';
import { count, createMembership, createUser, ledger, testPool, warm } from './helpers/db';

/**
 * Membership renewal.
 *
 * A cycle that has run out is renewed once: one new period row, one charge for
 * the fee. Never two, however many times or however many workers run the job.
 */
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

const periods = (pool: Pool, membershipId: string) =>
  count(pool, `SELECT 1 FROM membership_period WHERE membership_id = $1`, [membershipId]);
const fees = (pool: Pool, membershipId: string) =>
  count(pool, `SELECT 1 FROM charge WHERE action_type LIKE 'membership:%' AND reference_id = $1`, [
    membershipId,
  ]);
const statusOf = async (pool: Pool, membershipId: string) =>
  (
    await pool.query<{ status: string; live: boolean }>(
      `SELECT status, current_period_end > now() AS live FROM membership WHERE id = $1`,
      [membershipId],
    )
  ).rows[0]!;

describe('renewing a cycle that has run out', () => {
  it('renews once when run twice in a row', async () => {
    const m = await createMembership(pool, await createUser(pool), { endsInMinutes: -1 });
    await renewMemberships(pool);
    await renewMemberships(pool);
    expect(await periods(pool, m)).toBe(1);
    expect(await fees(pool, m)).toBe(1);
  });

  it('renews once when two runs overlap (N15)', async () => {
    const ms: string[] = [];
    for (let i = 0; i < 10; i += 1) ms.push(await createMembership(pool, await createUser(pool), { endsInMinutes: -1 }));
    await warm(pool);
    // If each run stamped its own `now()` as the new period start, the ON
    // CONFLICT on (membership_id, period_start) would never match and both runs
    // would open a period and charge the fee.
    await Promise.all([renewMemberships(pool), renewMemberships(pool)]);
    for (const m of ms) {
      expect(await periods(pool, m)).toBe(1);
      expect(await fees(pool, m)).toBe(1);
    }
  });
});

describe('an account that is no longer active (N9)', () => {
  it('does not renew or charge a closed account, and ends its membership', async () => {
    const m = await createMembership(pool, await createUser(pool, 'closed'), { endsInMinutes: -1 });
    await renewMemberships(pool);
    expect(await fees(pool, m)).toBe(0);
    expect(await periods(pool, m)).toBe(0);
    expect((await statusOf(pool, m)).status).toBe('ended');
  });

  it('does not renew or charge a suspended account, and leaves the cycle lapsed for when it is reinstated', async () => {
    const user = await createUser(pool, 'suspended');
    const m = await createMembership(pool, user, { endsInMinutes: -1 });
    await renewMemberships(pool);
    expect(await fees(pool, m)).toBe(0);
    expect(await statusOf(pool, m)).toEqual({ status: 'active', live: false });

    // Reinstated: the next run renews it like any other.
    await pool.query(`UPDATE user_account SET status = 'active' WHERE id = $1`, [user]);
    await renewMemberships(pool);
    expect(await fees(pool, m)).toBe(1);
    expect(await statusOf(pool, m)).toEqual({ status: 'active', live: true });
  });
});

/**
 * A member upgrading at the moment the renewal job reaches their membership.
 *
 * Both touch the membership row and the wallet, and the lock order everywhere
 * is the row the operation is about, then the wallet (`LedgerService.lockWallet`).
 * Renewal takes them in that order. If subscribe took the wallet first, the two
 * could each hold one and wait for the other.
 *
 * Made deterministic by holding `ledger_record` for a moment: subscribe stops
 * at its balance read, after whatever it locks first and before the next lock.
 * Renewal is started then, and allowed to block before the table is released,
 * for longer than `deadlock_timeout`, so that if the cycle forms it is
 * subscribe's own deadlock check, the later one, that finds it.
 *
 * Needs the API, and signs in as a seeded collector.
 */
describe('a member subscribing while their membership is being renewed', () => {
  const waitFor = async (what: string, check: () => Promise<boolean>, timeoutMs = 10_000) => {
    const until = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('never deadlocks: both take the membership row before the wallet', async () => {
    const member = await signIn(SEED.collector3);
    const { rows } = await pool.query<{ id: string }>(`SELECT id::text AS id FROM user_account WHERE email = $1`, [
      SEED.collector3,
    ]);
    const userId = rows[0]!.id;
    await ledger(pool, userId, 'credit', 100_000);

    // Nothing else due, so the run below reaches this membership and only it.
    await renewMemberships(pool);
    const existing = await pool.query<{ id: string }>(`SELECT id FROM membership WHERE user_id = $1`, [userId]);
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE membership
            SET tier = 'folio', status = 'active', scheduled_tier = NULL, cancelled_at = NULL, ended_at = NULL,
                current_period_start = now() - interval '30 days 1 minute', current_period_end = now() - interval '1 minute'
          WHERE user_id = $1`,
        [userId],
      );
    } else {
      await createMembership(pool, userId, { tier: 'folio', endsInMinutes: -1 });
    }
    const membershipId = (await pool.query<{ id: string }>(`SELECT id FROM membership WHERE user_id = $1`, [userId]))
      .rows[0]!.id;
    const feesBefore = await fees(pool, membershipId);

    const timeout = await pool.query<{ ms: string }>(
      `SELECT (EXTRACT(EPOCH FROM current_setting('deadlock_timeout')::interval) * 1000)::text AS ms`,
    );
    const deadlockTimeoutMs = Number(timeout.rows[0]!.ms);

    const holder = await pool.connect();
    let subscribing: Promise<{ status: number; body: unknown }> | undefined;
    let renewing: Promise<void> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE ledger_record IN ACCESS EXCLUSIVE MODE');

      subscribing = member.post('/membership/subscribe', { tier: 'registry' });
      await waitFor('subscribe to reach its balance read', async () => {
        const r = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE relation = 'ledger_record'::regclass AND NOT granted`,
        );
        return r.rows[0]!.n > 0;
      });

      let renewed = false;
      renewing = renewMemberships(pool).then(() => {
        renewed = true;
      });
      await waitFor('the renewal to finish or to wait for a wallet', async () => {
        if (renewed) return true;
        const r = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
        );
        return r.rows[0]!.n > 0;
      });
      await new Promise((r) => setTimeout(r, deadlockTimeoutMs + 500));
    } finally {
      await holder.query('COMMIT').catch(() => undefined);
      holder.release();
    }

    const res = await subscribing!;
    await renewing;

    // The upgrade went through, and the renewal left the membership to it
    // rather than renewing the old tier underneath it.
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const m = await pool.query<{ tier: string; live: boolean }>(
      `SELECT tier, current_period_end > now() AS live FROM membership WHERE id = $1`,
      [membershipId],
    );
    expect(m.rows[0]).toEqual({ tier: 'registry', live: true });
    expect(await fees(pool, membershipId)).toBe(feesBefore + 1);
  });
});

/**
 * One membership whose renewal throws must not stop the others, and must not
 * be reported as a run that went well: the heartbeat is what alerts somebody.
 */
describe('a renewal that fails for one membership', () => {
  it('renews the rest, logs the one that failed, and reports the run as failed', async () => {
    const good = await createMembership(pool, await createUser(pool), { endsInMinutes: -1 });
    const bad = await createMembership(pool, await createUser(pool), { endsInMinutes: -1 });

    // Its new period cannot be written: any error inside its transaction will do.
    await pool.query(`
      CREATE OR REPLACE FUNCTION wk_fail_period_for() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.membership_id::text = '${bad}' THEN
          RAISE EXCEPTION 'simulated failure renewing one membership';
        END IF;
        RETURN NEW;
      END $fn$`);
    await pool.query(`DROP TRIGGER IF EXISTS wk_fail_period ON membership_period`);
    await pool.query(
      `CREATE TRIGGER wk_fail_period BEFORE INSERT ON membership_period
         FOR EACH ROW EXECUTE FUNCTION wk_fail_period_for()`,
    );
    const errors = vi.spyOn(log, 'error');
    let outcome: unknown;
    let logged: unknown[][] = [];
    try {
      outcome = await runScheduledJob(pool, JobName.MEMBERSHIP_RENEWAL, () => renewMemberships(pool)).then(
        () => 'succeeded',
        (err: Error) => err,
      );
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS wk_fail_period ON membership_period`);
      await pool.query(`DROP FUNCTION IF EXISTS wk_fail_period_for()`);
      logged = [...errors.mock.calls];
      errors.mockRestore();
    }

    // The good one is renewed regardless.
    expect(await periods(pool, good)).toBe(1);
    expect(await fees(pool, good)).toBe(1);
    expect(await periods(pool, bad)).toBe(0);

    // The bad one is logged at error level by id, and the run is a failure
    // that names it, which is what the heartbeat records.
    expect(logged.some(([, fields]) => (fields as { membershipId?: string } | undefined)?.membershipId === bad)).toBe(true);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(bad);
    const { rows } = await pool.query<{ last_error: string | null; failed_recently: boolean }>(
      `SELECT last_error, last_error_at > now() - interval '1 minute' AS failed_recently
         FROM worker_heartbeat WHERE job_name = $1`,
      [JobName.MEMBERSHIP_RENEWAL],
    );
    expect(rows[0]?.failed_recently).toBe(true);
    expect(rows[0]?.last_error).toContain(bad);
  });
});

/**
 * A collector's very first subscribe, sent twice at once (a double click).
 *
 * Subscribe locks the membership row before the wallet, but a collector who
 * has never subscribed has no row to lock, so both requests get past that
 * read and meet at the wallet lock. The second must be told the membership was
 * just started, not fail on the unique user_id with a 500.
 *
 * Made deterministic by holding the collector's wallet lock from here until
 * both requests are waiting on it. Needs the API.
 */
describe('two first subscribes at once', () => {
  it('starts one membership, charges it once, and answers the other with a 409', async () => {
    const userId = await createUser(pool);
    const { rows } = await pool.query<{ email: string }>(
      `UPDATE user_account u
          SET password_hash = s.password_hash, terms_version = s.terms_version, terms_accepted_at = s.terms_accepted_at
         FROM user_account s
        WHERE u.id = $1 AND s.email = $2
       RETURNING u.email`,
      [userId, SEED.collector],
    );
    const member = await signIn(rows[0]!.email);
    await ledger(pool, userId, 'credit', 100_000);

    const holder = await pool.connect();
    let results: { status: number; body: unknown }[] = [];
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wallet:${userId}`]);
      const both = Promise.all([
        member.post('/membership/subscribe', { tier: 'folio' }),
        member.post('/membership/subscribe', { tier: 'folio' }),
      ]);
      const until = Date.now() + 10_000;
      for (;;) {
        const waiting = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
        );
        if (waiting.rows[0]!.n >= 2) break;
        if (Date.now() > until) throw new Error('timed out waiting for both subscribes to reach the wallet lock');
        await new Promise((r) => setTimeout(r, 25));
      }
      await holder.query('COMMIT');
      results = await both;
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }

    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    const memberships = await pool.query<{ id: string }>(`SELECT id FROM membership WHERE user_id = $1`, [userId]);
    expect(memberships.rows).toHaveLength(1);
    const membershipId = memberships.rows[0]!.id;
    expect(await periods(pool, membershipId)).toBe(1);
    expect(await fees(pool, membershipId)).toBe(1);
  });
});
