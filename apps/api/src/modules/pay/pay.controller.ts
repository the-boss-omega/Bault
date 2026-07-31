import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../acc/public.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { WalletService } from './wallet.service';
import { TopupService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';

class TopupDto {
  @IsInt() @IsPositive() amountMinor!: number;
}
class WithdrawRequestDto {
  @IsInt() @IsPositive() amountMinor!: number;
  @IsString() destinationAccount!: string;
}
class WithdrawConfirmDto {
  @IsString() confirmationToken!: string;
}

/** PAY endpoints (T071). `/finance/*` + `/webhooks/payment`. */
@ApiTags('PAY')
@Controller()
export class PayController {
  constructor(
    private readonly wallet: WalletService,
    private readonly topups: TopupService,
    private readonly withdrawals: WithdrawalService,
  ) {}

  @Get('finance/wallet')
  balance(@CurrentUser() user: AuthUser) {
    return this.wallet.balance(user.id);
  }

  @Get('finance/ledger')
  ledger(@CurrentUser() user: AuthUser) {
    return this.wallet.ledgerList(user.id);
  }

  @Post('finance/wallet/topups')
  topup(
    @CurrentUser() user: AuthUser,
    @Body() dto: TopupDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.topups.topup(user.id, dto.amountMinor, key ?? `topup-${user.id}-${dto.amountMinor}`);
  }

  @Post('finance/withdrawals')
  requestWithdrawal(@CurrentUser() user: AuthUser, @Body() dto: WithdrawRequestDto) {
    // Returns a confirmation challenge; the transfer executes only on /confirm (Principle VII).
    return this.withdrawals.request(user.id, dto.amountMinor, dto.destinationAccount);
  }

  @Post('finance/withdrawals/confirm')
  confirmWithdrawal(
    @CurrentUser() user: AuthUser,
    @Body() dto: WithdrawConfirmDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.withdrawals.confirm(user.id, dto.confirmationToken, key ?? dto.confirmationToken);
  }

  @Public()
  @Post('webhooks/payment')
  async webhook(@Req() req: Request, @Headers('x-signature') signature: string) {
    await this.topups.handleWebhook(JSON.stringify(req.body ?? {}), signature ?? '');
    return { received: true };
  }
}
