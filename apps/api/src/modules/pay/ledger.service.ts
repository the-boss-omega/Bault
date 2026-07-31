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
  type: 'purchase' | 'sale_credit' | 'fee' | 'service_charge' | 'credit_topup' | 'withdrawal' | 'interest';
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

  async balanceOf(userId: string, tx?: Database): Promise<Money> {
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
