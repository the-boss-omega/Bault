import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
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
 */
export async function accrueInterest(pool: Pool): Promise<void> {
  const env = loadEnv();
  const graceDays = env.WALLET_DEBT_GRACE_DAYS;
  const bps = env.WALLET_DEBT_INTEREST_BPS;

  if (bps === 0) {
    // eslint-disable-next-line no-console
    console.log('[job:interest] interest rate is 0 bps — nothing to accrue');
    return;
  }

  const positions = await negativeAccounts(pool);
  const due = positions.filter((p) => p.negativeDays >= graceDays);

  for (const position of due) {
    // At least one cent, so a debt too small to round to a charge still costs
    // something rather than sitting free forever.
    const amount = Math.max(1, Math.floor((position.debtMinor * bps) / 10_000));
    await pool.query(
      `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type)
       VALUES ($1, 'interest', $2::bigint, 'debit', 'USD', 'interest')`,
      [position.userId, amount],
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[job:interest] ${positions.length} negative account(s), ${due.length} past the ${graceDays}-day grace period and charged`,
  );
}
