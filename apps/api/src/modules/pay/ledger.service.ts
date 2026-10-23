import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { ledgerRecord } from './pay.schema';
import { money, type Money } from '../../shared/money';

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
  amount: number;
  direction: 'debit' | 'credit';
  currency?: string;
  referenceType?: string;
  referenceId?: string;
}

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

  async lockWallet(userId: string, tx: Database): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'wallet:' + userId}, 0))`);
  }

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
