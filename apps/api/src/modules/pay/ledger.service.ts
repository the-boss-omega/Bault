import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { ledgerRecord } from './pay.schema';
import { money, type Money } from '../../shared/money';

/** Single settlement currency for the MVP (spec Assumption). */
export const DEFAULT_CURRENCY = 'USD';

export interface LedgerEntry {
  userId: string;
  type:
    | 'purchase'
    | 'sale_credit'
    | 'fee'
    | 'service_charge'
    | 'credit_topup'
    | 'withdrawal'
    | 'interest'
    | 'escrow_hold'
    | 'escrow_release'
    | 'escrow_refund'
    | 'chargeback'
    | 'shipping_refund'
    | 'service_refund'
    | 'payout_reversal';
  amount: number; // positive minor units
  direction: 'debit' | 'credit';
  currency?: string;
  referenceType?: string;
  referenceId?: string;
}

/**
 * Ledger service (T059/T066, Principles II & IV).
 *
 * `record` appends one immutable ledger row (INSERT only — the append-only DB
 * triggers forbid edits). `balanceOf` DERIVES the wallet balance as
 * sum(credits) − sum(debits); there is no stored balance to drift. Both take an
 * optional `tx` so a ledger write commits atomically with the operation causing it.
 *
 * A balance read inside a transaction LOCKS the wallet until that transaction
 * ends. Without it, two purchases by one buyer each read the same balance,
 * each found it sufficient, and both debited it — five parallel purchases
 * against a balance that covered one all succeeded. There is no balance row to
 * lock and no constraint that could refuse the overdraft (the balance is a
 * SUM), so the lock is per user and lives in Postgres: the second check waits
 * for the first spend to commit and then reads the balance it left behind.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async record(entry: LedgerEntry, tx?: Database): Promise<void> {
    const exec = tx ?? this.db;
    await exec.insert(ledgerRecord).values({
      userId: entry.userId,
      type: entry.type,
      amount: entry.amount,
      direction: entry.direction,
      currency: entry.currency ?? DEFAULT_CURRENCY,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
    });
  }

  /**
   * Serialize every balance-dependent decision for one user's wallet.
   *
   * A transaction-scoped advisory lock: released by COMMIT or ROLLBACK, so it
   * cannot leak, and it works through PgBouncer in transaction mode. Re-taking
   * it in the same transaction is a no-op.
   *
   * One lock order everywhere, so two operations can wait for each other but
   * never deadlock: the rows the operation is about (listing, item, request,
   * shipment, deal) first, then the wallet, then the same user's membership
   * period, which waivers and covers write to.
   */
  async lockWallet(userId: string, tx: Database): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'wallet:' + userId}, 0))`);
  }

  /**
   * The derived balance. Inside a transaction it first locks the wallet (see the
   * class comment), so a check made here holds until the debit it guards commits.
   * Without `tx` it is a plain read, fine for display and for early refusals that
   * are repeated under the lock before any money moves.
   */
  async balanceOf(userId: string, tx?: Database): Promise<Money> {
    if (tx) await this.lockWallet(userId, tx);
    const exec = tx ?? this.db;
    const [row] = await exec
      .select({
        bal: sql<string>`coalesce(sum(case when ${ledgerRecord.direction} = 'credit'
          then ${ledgerRecord.amount} else -${ledgerRecord.amount} end), 0)::text`,
      })
      .from(ledgerRecord)
      .where(eq(ledgerRecord.userId, userId));
    return money(Number(row?.bal ?? '0'), DEFAULT_CURRENCY);
  }

  list(userId: string) {
    return this.db
      .select()
      .from(ledgerRecord)
      .where(eq(ledgerRecord.userId, userId))
      .orderBy(sql`${ledgerRecord.occurredAt} desc`);
  }
}
