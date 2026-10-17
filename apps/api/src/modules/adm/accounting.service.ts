import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { AuditService } from '../sec/audit.service';
import {
  reconcile,
  type OrphanLedgerFacts,
  type PayoutFacts,
  type TopupFacts,
  type WithdrawalFacts,
} from './reconciliation';

/**
 * What an accountant needs from the ledger, and deliberately nothing more.
 *
 * `ledger_record` is a single-entry WALLET ledger: a fee comes off a customer
 * and is credited to no account of Bault's, so Bault's revenue is a sum of
 * rows, computed here. Alongside it: the ledger export, a monthly summary, and
 * a comparison with the money that actually moved through the provider.
 *
 * Read-only, admin-only, computed from the rows that exist. It does NOT apply
 * tax, issue invoices or decide which lines are taxable revenue: that depends
 * on the legal entity and where it trades, which is for an accountant.
 */

/** One calendar day, UTC: `2026-10-15`. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** One calendar month: `2026-10`. */
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The widest range one export may cover.
 *
 * The export streams, so memory is not the limit, but one request holding a
 * read open across years of ledger competes with every customer's for the
 * database. A year at a time is what an accountant asks for anyway.
 */
export const MAX_EXPORT_DAYS = 366;

/** Rows fetched per round trip while streaming. */
const EXPORT_BATCH = 2_000;

const DAY_MS = 86_400_000;

/** The platform's own custodian account: its balance is Bault's, not a customer's. */
const PLATFORM_EMAIL = 'platform@bault.dev';

/** Revenue lines, in the order they are reported. Every key is always present. */
export const REVENUE_LINES = [
  'service_charge',
  'marketplace_fee',
  'consignment_fee',
  'escrow_fee',
  'cash_out_fee',
  'chargeback_fee',
  'custom_request_fee',
  'other_fee',
  'interest',
] as const;

function parseDay(value: string | undefined, name: string): Date {
  const m = DAY.exec(value ?? '');
  if (!m) throw AppError.validation(`${name} must be a date written YYYY-MM-DD`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Date.UTC rolls 2026-02-31 over into March; a date that does not survive the
  // round trip was not a date.
  if (d.toISOString().slice(0, 10) !== value) throw AppError.validation(`${name} is not a real date`);
  return d;
}

/**
 * `from` and `to` are whole UTC days and BOTH are included: `from=2026-10-01
 * &to=2026-10-31` is October, as a person would write it. Internally the range
 * is half-open, ending at midnight after `to`.
 */
export function parseDayRange(from: string | undefined, to: string | undefined) {
  const start = parseDay(from, 'from');
  const endDay = parseDay(to, 'to');
  if (endDay < start) throw AppError.validation('from must not be after to');
  const days = Math.round((endDay.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > MAX_EXPORT_DAYS) {
    throw AppError.validation(`One export covers at most ${MAX_EXPORT_DAYS} days; ask for a shorter range`);
  }
  return { from: from!, to: to!, start, end: new Date(endDay.getTime() + DAY_MS) };
}

export function parseMonth(month: string | undefined) {
  const m = MONTH.exec(month ?? '');
  if (!m) throw AppError.validation('month must be written YYYY-MM');
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  return { month: month!, start, end };
}

/**
 * One CSV field, RFC 4180, with formula injection defused.
 *
 * A username may begin with `-`, and a spreadsheet opening this file treats a
 * cell starting `=`, `+`, `-` or `@` as a formula. A leading apostrophe makes it
 * text.
 */
export function csvField(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minor units as a decimal amount: 1234 → "12.34". Integer arithmetic only. */
export function decimalAmount(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const LEDGER_CSV_HEADER = [
  'occurred_at',
  'ledger_id',
  'user_id',
  'username',
  'type',
  'direction',
  'amount',
  'currency',
  'reference_type',
  'reference_id',
].join(',');

interface LedgerExportRow extends Record<string, unknown> {
  id: string;
  occurred_at: string;
  cursor_at: string;
  user_id: string;
  username: string | null;
  type: string;
  direction: string;
  amount: string;
  currency: string;
  reference_type: string | null;
  reference_id: string | null;
}

@Injectable()
export class AccountingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every ledger row in the range, as CSV lines, a batch at a time.
   *
   * Keyset-paginated on (occurred_at, id) rather than OFFSET, so the thousandth
   * batch costs what the first does, and a row written while the export runs
   * cannot shift a page boundary and be emitted twice. The cursor carries the
   * timestamp as Postgres TEXT: a JavaScript Date would drop the microseconds
   * and re-read every row that shares the last millisecond.
   */
  async *ledgerCsv(range: { start: Date; end: Date }): AsyncGenerator<string> {
    yield `${LEDGER_CSV_HEADER}\r\n`;
    let cursor: { at: string; id: string } | null = null;
    for (;;) {
      const after: SQL = cursor
        ? sql`AND (l.occurred_at, l.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
        : sql``;
      const result: { rows: LedgerExportRow[] } = await this.db.execute<LedgerExportRow>(sql`
        SELECT l.id::text AS id,
               to_char(l.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
               l.occurred_at::text AS cursor_at,
               l.user_id, u.username, l.type::text AS type, l.direction::text AS direction,
               l.amount::text AS amount, l.currency, l.reference_type, l.reference_id
          FROM ledger_record l
          LEFT JOIN user_account u ON u.id::text = l.user_id
         WHERE l.occurred_at >= ${range.start.toISOString()}::timestamptz
           AND l.occurred_at <  ${range.end.toISOString()}::timestamptz
           ${after}
         ORDER BY l.occurred_at, l.id
         LIMIT ${EXPORT_BATCH}`);
      const rows: LedgerExportRow[] = result.rows;
      if (rows.length === 0) return;
      yield rows
        .map(
          (r) =>
            [
              csvField(r.occurred_at),
              csvField(r.id),
              csvField(r.user_id),
              csvField(r.username),
              csvField(r.type),
              csvField(r.direction),
              csvField(decimalAmount(Number(r.amount))),
              csvField(r.currency),
              csvField(r.reference_type),
              csvField(r.reference_id),
            ].join(',') + '\r\n',
        )
        .join('');
      if (rows.length < EXPORT_BATCH) return;
      const last: LedgerExportRow = rows[rows.length - 1]!;
      cursor = { at: last.cursor_at, id: last.id };
    }
  }

  /**
   * Who exported which part of the ledger.
   *
   * GETs are not audited by the interceptor, and this one hands every customer's
   * money movements, by username, to whoever asked. That is worth a row.
   */
  recordExport(actorId: string, range: { from: string; to: string }) {
    return this.audit.record({
      actorId,
      action: 'accounting.ledger_export',
      targetEntity: 'ledger_record',
      metadata: { from: range.from, to: range.to },
    });
  }

  /**
   * A month's totals, with Bault's revenue kept apart from customer money.
   *
   * Three things an accountant must never add together:
   *
   *   REVENUE: what Bault charged (fees, service charges, escrow and cash-out
   *     fees, interest). Debits net of any credit of the same type.
   *   CUSTOMER MONEY IN AND OUT: top-ups and cash-ins, cash-outs, and payments
   *     the cardholder took back. Money passing through, not earned.
   *   BALANCES HELD: what every customer wallet adds up to at the end of the
   *     month: money Bault holds that belongs to somebody else, net of what
   *     customers in debt owe it.
   *
   * Movements between customers (a purchase and the matching sale credit, an
   * escrow hold and its release) appear in `byType` and in none of the three.
   *
   * A cash-out the provider refused or returned is credited back in full by a
   * `payout_reversal` (see `WalletRequestService.recordPayoutOutcome`). Nothing
   * left Bault and Bault kept no fee, so in the month of the reversal its
   * withdrawal comes off money out and its fee off the cash-out fee line.
   */
  async summary(month: { month: string; start: Date; end: Date }) {
    const from = month.start.toISOString();
    const to = month.end.toISOString();

    const byType = (
      await this.db.execute<{ type: string; direction: string; count: number; total: string }>(sql`
        SELECT type::text AS type, direction::text AS direction, count(*)::int AS count, sum(amount)::text AS total
          FROM ledger_record
         WHERE occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
         GROUP BY type, direction
         ORDER BY type, direction`)
    ).rows.map((r) => ({ type: r.type, direction: r.direction, count: r.count, totalMinor: Number(r.total) }));

    /**
     * Revenue, split by what was charged for.
     *
     * The ledger type alone cannot tell an escrow fee from a cash-out fee
     * (both are `fee`), but every fee written through a charge carries its
     * reason in the charge's snapshot, and the marketplace and consignment
     * commissions name the listing or the request they came from.
     */
    const revenueRows = (
      await this.db.execute<{ key: string; total: string }>(sql`
        SELECT CASE
                 WHEN l.type = 'interest' THEN 'interest'
                 WHEN l.type = 'service_charge' THEN 'service_charge'
                 WHEN c.pricing_rule_snapshot ? 'escrowFeeBps' THEN 'escrow_fee'
                 WHEN c.pricing_rule_snapshot ->> 'cashOutFee' = 'true' THEN 'cash_out_fee'
                 WHEN c.pricing_rule_snapshot ->> 'chargebackFee' = 'true' THEN 'chargeback_fee'
                 WHEN l.reference_type = 'listing' THEN 'marketplace_fee'
                 WHEN s.type::text = 'consignment' THEN 'consignment_fee'
                 WHEN s.type::text = 'custom' THEN 'custom_request_fee'
                 ELSE 'other_fee'
               END AS key,
               sum(CASE WHEN l.direction = 'debit' THEN l.amount ELSE -l.amount END)::text AS total
          FROM ledger_record l
          LEFT JOIN charge c ON l.reference_type = 'charge' AND c.id::text = l.reference_id
          LEFT JOIN service_request s ON l.reference_type = 'service_request' AND s.id::text = l.reference_id
         WHERE l.type IN ('fee', 'service_charge', 'interest')
           AND l.occurred_at >= ${from}::timestamptz AND l.occurred_at < ${to}::timestamptz
         GROUP BY 1`)
    ).rows;
    /**
     * Cash-outs credited back, split into the fee they carried and the payout.
     * The fee is the cash-out fee charge on the same request, if there was one
     * (a membership may have waived it).
     */
    const [returned] = (
      await this.db.execute<{ total: string; fee: string }>(sql`
        SELECT COALESCE(sum(l.amount), 0)::text AS total,
               COALESCE(sum(LEAST(l.amount, COALESCE(f.amount, 0))), 0)::text AS fee
          FROM ledger_record l
          LEFT JOIN LATERAL (
            SELECT sum(c.amount) AS amount
              FROM charge c
             WHERE c.reference_id = l.reference_id
               AND c.pricing_rule_snapshot ->> 'cashOutFee' = 'true'
          ) f ON TRUE
         WHERE l.type = 'payout_reversal' AND l.direction = 'credit'
           AND l.reference_type = 'wallet_request'
           AND l.occurred_at >= ${from}::timestamptz AND l.occurred_at < ${to}::timestamptz`)
    ).rows;
    const returnedFeeMinor = Number(returned?.fee ?? 0);
    const returnedPayoutMinor = Number(returned?.total ?? 0) - returnedFeeMinor;

    const revenueBy = new Map(revenueRows.map((r) => [r.key, Number(r.total)]));
    revenueBy.set('cash_out_fee', (revenueBy.get('cash_out_fee') ?? 0) - returnedFeeMinor);
    const lines = REVENUE_LINES.map((key) => ({ key, totalMinor: revenueBy.get(key) ?? 0 }));

    /**
     * Postage inside the shipping charges.
     *
     * A shipping charge is one line to the customer and one `service_charge` on
     * the ledger, but most of it is the carrier's rate, which Bault pays on.
     * Reported beside the revenue, not subtracted from it, because whether it
     * is revenue and a cost, or a pass-through, is the accountant's call.
     */
    const [carrier] = (
      await this.db.execute<{ total: string }>(sql`
        SELECT COALESCE(sum((c.pricing_rule_snapshot ->> 'carrierCost')::bigint), 0)::text AS total
          FROM ledger_record l
          JOIN charge c ON l.reference_type = 'charge' AND c.id::text = l.reference_id
         WHERE l.type = 'service_charge' AND l.direction = 'debit'
           AND c.pricing_rule_snapshot ? 'carrierCost'
           AND l.occurred_at >= ${from}::timestamptz AND l.occurred_at < ${to}::timestamptz`)
    ).rows;

    const sumOf = (type: string, direction: string) =>
      byType.filter((r) => r.type === type && r.direction === direction).reduce((a, r) => a + r.totalMinor, 0);
    const inMinor = sumOf('credit_topup', 'credit');
    const outMinor = sumOf('withdrawal', 'debit') - returnedPayoutMinor;
    const reversedMinor = sumOf('chargeback', 'debit');

    /**
     * Every wallet as it stood at the end of the month (or now, for the month
     * still running), the platform's own account apart. The platform account
     * is the custodian that buys cards outright and sells from the house store;
     * its balance is Bault's money, and counting it as a customer's would
     * overstate what Bault owes.
     */
    const asOf = month.end.getTime() > Date.now() ? new Date() : month.end;
    const [platform] = (
      await this.db.execute<{ id: string }>(sql`SELECT id::text AS id FROM user_account WHERE email = ${PLATFORM_EMAIL} LIMIT 1`)
    ).rows;
    const platformId = platform?.id ?? null;
    const [held] = (
      await this.db.execute<{
        customer_total: string;
        owed_to: string;
        owed_by: string;
        accounts: number;
        platform: string;
      }>(sql`
        WITH b AS (
          SELECT user_id, sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS bal
            FROM ledger_record
           WHERE occurred_at < ${asOf.toISOString()}::timestamptz
           GROUP BY user_id
        )
        SELECT COALESCE(sum(bal) FILTER (WHERE user_id IS DISTINCT FROM ${platformId}), 0)::text AS customer_total,
               COALESCE(sum(bal) FILTER (WHERE user_id IS DISTINCT FROM ${platformId} AND bal > 0), 0)::text AS owed_to,
               COALESCE(-sum(bal) FILTER (WHERE user_id IS DISTINCT FROM ${platformId} AND bal < 0), 0)::text AS owed_by,
               (count(*) FILTER (WHERE user_id IS DISTINCT FROM ${platformId} AND bal <> 0))::int AS accounts,
               COALESCE(sum(bal) FILTER (WHERE user_id = ${platformId}), 0)::text AS platform
          FROM b`)
    ).rows;

    return {
      month: month.month,
      from,
      to,
      currency: 'USD',
      byType,
      revenue: {
        totalMinor: lines.reduce((a, l) => a + l.totalMinor, 0),
        lines,
        /** Already taken off `cash_out_fee`: fees given back with a returned cash-out. */
        cashOutFeesReturnedMinor: returnedFeeMinor,
        carrierCostOnShippingChargesMinor: Number(carrier?.total ?? 0),
      },
      customerMoney: {
        inMinor,
        outMinor,
        /** Already taken off `outMinor`: cash-outs the provider refused or returned. */
        payoutsReturnedMinor: returnedPayoutMinor,
        reversedMinor,
        netMinor: inMinor - outMinor - reversedMinor,
      },
      balancesHeld: {
        asOf: asOf.toISOString(),
        customerTotalMinor: Number(held?.customer_total ?? 0),
        owedToCustomersMinor: Number(held?.owed_to ?? 0),
        owedByCustomersMinor: Number(held?.owed_by ?? 0),
        accountsWithBalance: held?.accounts ?? 0,
        platformAccountMinor: Number(held?.platform ?? 0),
      },
      note:
        'Single-entry wallet ledger: revenue is the net of fee, service_charge and interest rows, ' +
        'less the cash-out fees given back when a payout was refused or returned. ' +
        'No tax has been applied or separated; which lines are taxable is for the accountant.',
    };
  }

  /** External payments against the ledger rows that cite them. See `reconciliation.ts`. */
  async reconciliation(range: { start: Date; end: Date } | null) {
    const epWindow = range
      ? sql`AND ep.created_at >= ${range.start.toISOString()}::timestamptz AND ep.created_at < ${range.end.toISOString()}::timestamptz`
      : sql``;
    const ledgerWindow = range
      ? sql`AND l.occurred_at >= ${range.start.toISOString()}::timestamptz AND l.occurred_at < ${range.end.toISOString()}::timestamptz`
      : sql``;

    const topups = (
      await this.db.execute<Record<string, unknown>>(sql`
        WITH refs AS (
          SELECT reference_id,
                 count(*) FILTER (WHERE type = 'credit_topup' AND direction = 'credit')::int AS credit_count,
                 COALESCE(sum(amount) FILTER (WHERE type = 'credit_topup' AND direction = 'credit'), 0)::text AS credit_sum,
                 count(*) FILTER (WHERE type = 'chargeback' AND direction = 'debit')::int AS chargeback_count,
                 COALESCE(sum(amount) FILTER (WHERE type = 'chargeback' AND direction = 'debit'), 0)::text AS chargeback_sum,
                 count(*) FILTER (WHERE NOT ((type = 'credit_topup' AND direction = 'credit')
                                          OR (type = 'chargeback' AND direction = 'debit')))::int AS other_count
            FROM ledger_record
           WHERE reference_type = 'external_payment'
           GROUP BY reference_id
        )
        SELECT ep.id::text AS id, ep.user_id, u.username, ep.provider, ep.status, ep.amount::text AS amount,
               ep.created_at,
               COALESCE(r.credit_count, 0) AS credit_count, COALESCE(r.credit_sum, '0') AS credit_sum,
               COALESCE(r.chargeback_count, 0) AS chargeback_count, COALESCE(r.chargeback_sum, '0') AS chargeback_sum,
               COALESCE(r.other_count, 0) AS other_count
          FROM external_payment ep
          LEFT JOIN refs r ON r.reference_id = ep.id::text
          LEFT JOIN user_account u ON u.id::text = ep.user_id
         WHERE ep.purpose = 'topup' ${epWindow}`)
    ).rows.map(
      (r): TopupFacts => ({
        id: String(r.id),
        userId: String(r.user_id),
        username: (r.username as string | null) ?? null,
        provider: String(r.provider),
        status: String(r.status),
        amount: Number(r.amount),
        createdAt: r.created_at as Date,
        creditCount: Number(r.credit_count),
        creditSum: Number(r.credit_sum),
        chargebackCount: Number(r.chargeback_count),
        chargebackSum: Number(r.chargeback_sum),
        otherCount: Number(r.other_count),
      }),
    );

    const payouts = (
      await this.db.execute<Record<string, unknown>>(sql`
        SELECT ep.id::text AS id, ep.user_id, u.username, ep.status, ep.amount::text AS amount,
               ep.provider_ref, ep.created_at
          FROM external_payment ep
          LEFT JOIN user_account u ON u.id::text = ep.user_id
         WHERE ep.purpose = 'payout' ${epWindow}`)
    ).rows.map(
      (r): PayoutFacts => ({
        id: String(r.id),
        userId: String(r.user_id),
        username: (r.username as string | null) ?? null,
        status: String(r.status),
        amount: Number(r.amount),
        providerRef: String(r.provider_ref),
        createdAt: r.created_at as Date,
      }),
    );

    /**
     * Every debit that sent money out of a wallet, with the payout it belongs to.
     *
     * Two shapes. A cash-out completed through the payout flow links its
     * request to its payment (`wallet_request.payout_payment_id`), and its
     * withdrawal row is the NET, the fee being a row of its own. An older one
     * recorded the reference and the fee in its `completed` event, and its
     * withdrawal row is the gross. A debit with neither has no payout to point at.
     *
     * `debited_minor` is everything the cash-out took (the net and its own fee
     * row, or the gross), and `reversed_minor` what `payout_reversal` credits on
     * the same request gave back, so a refused payout can be checked against it.
     */
    const withdrawals = (
      await this.db.execute<Record<string, unknown>>(sql`
        SELECT l.id::text AS ledger_id, l.user_id, u.username, l.amount::text AS amount, l.occurred_at,
               CASE WHEN l.reference_type = 'wallet_request' THEN l.reference_id END AS wallet_request_id,
               COALESCE(pp.provider_ref, ev.metadata ->> 'payoutRef') AS payout_ref,
               CASE WHEN pp.id IS NOT NULL THEN '0' ELSE COALESCE(ev.metadata ->> 'feeMinor', '0') END AS fee_minor,
               (l.amount + CASE WHEN pp.id IS NOT NULL THEN COALESCE(fee.amount, 0) ELSE 0 END)::text AS debited_minor,
               COALESCE(rv.amount, 0)::text AS reversed_minor
          FROM ledger_record l
          LEFT JOIN user_account u ON u.id::text = l.user_id
          LEFT JOIN wallet_request wr
            ON l.reference_type = 'wallet_request' AND wr.id::text = l.reference_id
          LEFT JOIN external_payment pp ON pp.id::text = wr.payout_payment_id::text
          LEFT JOIN LATERAL (
            SELECT e.metadata
              FROM wallet_request_event e
             WHERE l.reference_type = 'wallet_request'
               AND e.request_id = l.reference_id
               AND e.to_status = 'completed'
             ORDER BY e.occurred_at DESC
             LIMIT 1
          ) ev ON TRUE
          LEFT JOIN LATERAL (
            SELECT sum(c.amount) AS amount
              FROM charge c
             WHERE c.reference_id = wr.id::text
               AND c.pricing_rule_snapshot ->> 'cashOutFee' = 'true'
          ) fee ON TRUE
          LEFT JOIN LATERAL (
            SELECT sum(r.amount) AS amount
              FROM ledger_record r
             WHERE l.reference_type = 'wallet_request'
               AND r.type = 'payout_reversal' AND r.direction = 'credit'
               AND r.reference_type = 'wallet_request' AND r.reference_id = l.reference_id
          ) rv ON TRUE
         WHERE l.type = 'withdrawal' AND l.direction = 'debit' ${ledgerWindow}`)
    ).rows.map(
      (r): WithdrawalFacts => ({
        ledgerId: String(r.ledger_id),
        userId: String(r.user_id),
        username: (r.username as string | null) ?? null,
        amount: Number(r.amount),
        occurredAt: r.occurred_at as Date,
        walletRequestId: (r.wallet_request_id as string | null) ?? null,
        payoutRef: (r.payout_ref as string | null) ?? null,
        feeMinor: Number(r.fee_minor),
        debitedMinor: Number(r.debited_minor),
        reversedMinor: Number(r.reversed_minor),
      }),
    );

    const orphans = (
      await this.db.execute<Record<string, unknown>>(sql`
        SELECT l.id::text AS ledger_id, l.user_id, u.username, l.type::text AS type, l.direction::text AS direction,
               l.amount::text AS amount, l.reference_id, l.occurred_at
          FROM ledger_record l
          LEFT JOIN external_payment ep ON ep.id::text = l.reference_id
          LEFT JOIN user_account u ON u.id::text = l.user_id
         WHERE l.reference_type = 'external_payment' AND ep.id IS NULL ${ledgerWindow}`)
    ).rows.map(
      (r): OrphanLedgerFacts => ({
        ledgerId: String(r.ledger_id),
        userId: String(r.user_id),
        username: (r.username as string | null) ?? null,
        type: String(r.type),
        direction: String(r.direction),
        amount: Number(r.amount),
        referenceId: (r.reference_id as string | null) ?? null,
        occurredAt: r.occurred_at as Date,
      }),
    );

    const [manual] = (
      await this.db.execute<{ count: number; total: string }>(sql`
        SELECT count(*)::int AS count, COALESCE(sum(amount), 0)::text AS total
          FROM ledger_record l
         WHERE l.type = 'credit_topup' AND l.direction = 'credit' AND l.reference_type = 'wallet_request'
               ${ledgerWindow}`)
    ).rows;

    const report = reconcile({ topups, payouts, withdrawals, orphans });
    return {
      from: range?.start.toISOString() ?? null,
      to: range?.end.toISOString() ?? null,
      ...report,
      /**
       * Credited by a person against a bank statement, through a reviewed
       * wallet request. No provider reports them, so nothing here can check
       * them; they are counted so their absence is not mistaken for a pass.
       */
      manualCashIns: {
        count: manual?.count ?? 0,
        totalMinor: Number(manual?.total ?? 0),
        reconcileAgainst: 'the bank and PayPal account statements',
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
