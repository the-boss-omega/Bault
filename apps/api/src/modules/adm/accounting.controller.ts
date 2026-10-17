import { once } from 'node:events';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { AccountingService, parseDayRange, parseMonth } from './accounting.service';

/**
 * The accountant's exports, admin only. Read-only, no tax logic: see
 * `AccountingService` for what each one reports and what it leaves to people.
 */
@ApiTags('ADM')
@Roles('admin')
@Controller('admin/accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  /**
   * Every ledger row in a range of days, as CSV, streamed.
   *
   * Written to the socket a batch at a time and paced by the socket's own
   * back-pressure, so a year of ledger never sits in this process's memory.
   * The range is validated BEFORE the first byte: once the header row is out
   * the status is 200 and cannot be taken back.
   */
  @Get('ledger.csv')
  async ledgerCsv(
    @CurrentUser() actor: AuthUser,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const range = parseDayRange(from, to);
    await this.accounting.recordExport(actor.id, range);

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bault-ledger-${range.from}-to-${range.to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      for await (const chunk of this.accounting.ledgerCsv(range)) {
        if (!res.write(chunk)) await once(res, 'drain');
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) throw e;
      // Half a file that ends cleanly reads as the whole ledger. Cutting the
      // connection instead makes the download visibly fail.
      res.destroy(e instanceof Error ? e : new Error('ledger export failed'));
    }
  }

  /** One month's totals: by type, Bault's revenue, customer money, balances held. */
  @Get('summary')
  summary(@Query('month') month: string | undefined) {
    return this.accounting.summary(parseMonth(month));
  }

  /**
   * External payments reconciled against the ledger. Every payment ever, unless
   * a `from`/`to` day range narrows it.
   */
  @Get('reconciliation')
  reconciliation(@Query('from') from: string | undefined, @Query('to') to: string | undefined) {
    return this.accounting.reconciliation(from || to ? parseDayRange(from, to) : null);
  }
}
