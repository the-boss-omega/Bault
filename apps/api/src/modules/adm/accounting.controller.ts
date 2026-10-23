import { once } from 'node:events';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { AccountingService, parseDayRange, parseMonth } from './accounting.service';

@ApiTags('ADM')
@Roles('admin')
@Controller('admin/accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

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
      res.destroy(e instanceof Error ? e : new Error('ledger export failed'));
    }
  }

  @Get('summary')
  summary(@Query('month') month: string | undefined) {
    return this.accounting.summary(parseMonth(month));
  }

  @Get('reconciliation')
  reconciliation(@Query('from') from: string | undefined, @Query('to') to: string | undefined) {
    return this.accounting.reconciliation(from || to ? parseDayRange(from, to) : null);
  }
}
