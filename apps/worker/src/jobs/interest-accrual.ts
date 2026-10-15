import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { log } from '../log';
import { negativeAccounts } from './debt';

/**
 * Interest accrual (T069, Principle: negative balance accrues interest).
 *
 * For every account whose derived balance (Σ ledger) has been negative for
 * longer than the GRACE PERIOD, append an `interest` DEBIT proportional to the
 * debt. This increases the debt until the customer settles, and is expressed
 * purely as new append-only ledger rows — never as an edit.
 *
 * The grace period is the change from the original behaviour. Interest used to
 * start the instant a balance went negative, which charged a customer for the
 * hours between a fee posting and their noticing it. `WALLET_DEBT_GRACE_DAYS`
 * (default 14, matching the reference service) is how long a debt may sit
 * before it starts costing anything; the rate is `WALLET_DEBT_INTEREST_BPS`
 * basis points per day.
 *
 * Both are configuration rather than constants because they are a commercial
 * policy, not an implementation detail — see `packages/config/src/env.ts`.
 *
 * ONE DAY OF INTEREST PER DAY, HOWEVER OFTEN THIS RUNS (F051). Every insert was
 * autocommitted with no key, and the job was written as if it ran once a day,
 * exactly. It does not: pg-boss retries a failed job straight away, so a failure
 * half way through charged everybody before it a second time, and a run left
 * over from a lease that expired, or a second replica, did the same. Each row
 * now carries the UTC day it is for in `reference_id`, and a unique index on
 * (account, day) for interest rows makes a repeat insert a no-op.
 *
 * Each account is charged in its own transaction, holding the same wallet lock
 * the API takes before it reads a balance and moves money, and the debt is read
 * again under that lock — a debt that was settled between the sweep's scan and
 * its turn accrues nothing. One account that fails is logged and skipped rather
 * than stopping everybody after it.
 *
 * Not on a CLOSED account (N9). Closing an account is the end of the
 * relationship; a debt it was closed with is a matter for a person, not
 * something to keep growing by the day. Nor on a `pending` one, which cannot
 * have spent anything. A SUSPENDED account keeps accruing: the debt sweep
 * suspends exactly the accounts deepest in debt, and exempting them would turn
 * suspension into a way to stop the interest.
 */
export async function accrueInterest(pool: Pool): Promise<void> {
  const env = loadEnv();
  const graceDays = env.WALLET_DEBT_GRACE_DAYS;
  const bps = env.WALLET_DEBT_INTEREST_BPS;

  if (bps === 0) {
    log.info('interest rate is 0 bps — nothing to accrue', { job: 'interest.accrual' });
    return;
  }

  // The day this run accrues for, fixed once and taken from the database clock,
  // so a run that straddles midnight is still one day's accrual.
  const { rows: today } = await pool.query<{ day: string }>(
    `SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day`,
  );
  const key = `interest:${today[0]!.day}`;

  const positions = await negativeAccounts(pool);
  const due = positions.filter((p) => p.negativeDays >= graceDays);

  let charged = 0;
  let skipped = 0;
  let errored = 0;
  for (const position of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wallet:${position.userId}`]);

      const { rows } = await client.query<{ status: string | null; balance: string }>(
        `SELECT (SELECT status::text FROM user_account WHERE id::text = $1) AS status,
                coalesce(sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS balance
           FROM ledger_record
          WHERE user_id = $1`,
        [position.userId],
      );
      const status = rows[0]?.status;
      const balance = Number(rows[0]?.balance ?? 0);
      if (status === 'closed' || status === 'pending' || balance >= 0) {
        await client.query('ROLLBACK');
        skipped += 1;
        continue;
      }

      // At least one cent, so a debt too small to round to a charge still costs
      // something rather than sitting free forever.
      const amount = Math.max(1, Math.floor((-balance * bps) / 10_000));
      const inserted = await client.query(
        `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type, reference_id)
         VALUES ($1, 'interest', $2::bigint, 'debit', 'USD', 'interest', $3)
         ON CONFLICT (user_id, reference_id) WHERE type = 'interest' DO NOTHING`,
        [position.userId, amount, key],
      );
      await client.query('COMMIT');
      if ((inserted.rowCount ?? 0) > 0) charged += 1;
      else skipped += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      errored += 1;
      log.error('interest accrual failed for one account', {
        job: 'interest.accrual',
        userId: position.userId,
        error: err,
      });
    } finally {
      client.release();
    }
  }

  log.info('interest accrued', {
    job: 'interest.accrual',
    day: key,
    negative_accounts: positions.length,
    past_grace: due.length,
    grace_days: graceDays,
    charged,
    skipped,
    errored,
  });
  // A run where some accounts could not be charged is a failed run, so the
  // heartbeat records it and pg-boss retries — safely, because of the key.
  if (errored > 0) throw new Error(`interest accrual failed for ${errored} account(s)`);
}
