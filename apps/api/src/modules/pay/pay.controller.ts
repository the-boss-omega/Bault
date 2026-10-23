import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../acc/public.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { WalletService } from './wallet.service';
import { TopupService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { WalletRequestService } from './wallet-request.service';
import { CheckoutService } from './checkout.service';
import { ChargebackService } from './chargeback.service';
import { Roles } from '../sec/roles.decorator';

class TopupDto {
  @IsInt() @IsPositive() amountMinor!: number;
}
class WithdrawRequestDto {
  @IsInt() @IsPositive() amountMinor!: number;
  @IsString() destinationAccount!: string;
  @IsOptional() @IsString() @MaxLength(140) beneficiaryName?: string;
}
class WithdrawConfirmDto {
  @IsString() confirmationToken!: string;
}

class CheckoutDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsString() route!: string;
  @IsString() @MaxLength(120) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(200) paymentMethodToken?: string;
}

class ChargebackDto {
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(140) providerCaseRef?: string;
  @IsOptional() @IsBoolean() chargeFee?: boolean;
}

@ApiTags('PAY')
@Controller()
export class PayController {
  constructor(
    private readonly wallet: WalletService,
    private readonly topups: TopupService,
    private readonly withdrawals: WithdrawalService,
    private readonly requests: WalletRequestService,
    private readonly checkout: CheckoutService,
    private readonly chargebacks: ChargebackService,
  ) {}

  @Get('finance/funding-routes')
  fundingRoutes() {
    return this.checkout.routes();
  }

  @Post('finance/checkout')
  pay(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.checkout.checkout(user.id, dto);
  }

  @Get('finance/payments')
  myPayments(@CurrentUser() user: AuthUser) {
    return this.checkout.listMine(user.id);
  }

  @Get('finance/cash-out-quote')
  cashOutQuote(@Query('amountMinor') amountMinor: string) {
    const amount = Number.parseInt(amountMinor ?? '0', 10);
    return this.wallet.cashOutQuote(Number.isFinite(amount) ? amount : 0);
  }

  @Roles('admin')
  @Get('finance/chargebacks/reversible')
  reversible() {
    return this.chargebacks.reversible();
  }

  @Roles('admin')
  @Post('finance/chargebacks/:paymentId')
  recordChargeback(
    @CurrentUser() user: AuthUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: ChargebackDto,
  ) {
    return this.chargebacks.record(user.id, paymentId, dto);
  }

  @Get('finance/wallet')
  balance(@CurrentUser() user: AuthUser) {
    return this.wallet.balance(user.id);
  }

  @Get('finance/ledger')
  ledger(@CurrentUser() user: AuthUser) {
    return this.wallet.ledgerList(user.id);
  }

  @Get('finance/wallet/pending')
  pending(@CurrentUser() user: AuthUser) {
    return this.requests.openTotals(user.id);
  }

  @Post('finance/wallet/topups')
  async topup(@CurrentUser() user: AuthUser, @Body() dto: TopupDto) {
    const created = await this.requests.submit(user.id, {
      type: 'cash_in',
      amountMinor: dto.amountMinor,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      notes: 'Raised through the legacy /finance/wallet/topups endpoint.',
    });
    return {
      status: 'pending_approval',
      requestId: created.id,
      code: created.code,
      requestStatus: created.status,
    };
  }

  @Post('finance/withdrawals')
  async requestWithdrawal(@CurrentUser() user: AuthUser, @Body() dto: WithdrawRequestDto) {
    const beneficiaryName = dto.beneficiaryName?.trim() || (await this.requests.accountHolderName(user.id));
    const created = await this.requests.submit(user.id, {
      type: 'cash_out',
      amountMinor: dto.amountMinor,
      currency: 'USD',
      destinationAccount: dto.destinationAccount,
      beneficiaryName,
      notes: 'Raised through the legacy /finance/withdrawals endpoint.',
    });
    return {
      status: 'pending_approval',
      requestId: created.id,
      code: created.code,
      requestStatus: created.status,
    };
  }

  @Post('finance/withdrawals/confirm')
  confirmWithdrawal(@CurrentUser() _user: AuthUser, @Body() _dto: WithdrawConfirmDto) {
    throw this.withdrawals.retiredConfirmEndpoint();
  }

  @Public()
  @Post('webhooks/payment')
  async webhook(@Req() req: Request) {
    const { outcome } = await this.topups.handleWebhook({
      rawBody: JSON.stringify(req.body ?? {}),
      headers: req.headers as Record<string, string | undefined>,
    });
    return { received: true, outcome };
  }
}
