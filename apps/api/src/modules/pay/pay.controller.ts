import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { CRYPTO_SIGNATURE_HEADER } from '@bault/adapters';
import { Public } from '../acc/public.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { WalletService } from './wallet.service';
import { TopupService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { WalletRequestService } from './wallet-request.service';
import { CheckoutService } from './checkout.service';
import { ChargebackService } from './chargeback.service';
import { PayPalCheckoutService } from './paypal-checkout.service';
import { CryptoCheckoutService } from './crypto-checkout.service';
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

class PayPalCheckoutDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsString() route!: string;
  @IsString() @MaxLength(120) idempotencyKey!: string;
}

class CryptoCheckoutDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsString() @MaxLength(120) idempotencyKey!: string;
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
    private readonly paypalCheckout: PayPalCheckoutService,
    private readonly cryptoCheckout: CryptoCheckoutService,
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

  @Post('finance/checkout/paypal')
  startPayPalCheckout(@CurrentUser() user: AuthUser, @Body() dto: PayPalCheckoutDto) {
    return this.paypalCheckout.start(user.id, dto);
  }

  @Post('finance/checkout/paypal/:paymentId/capture')
  capturePayPalCheckout(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string) {
    return this.paypalCheckout.capture(user.id, paymentId);
  }

  @Post('finance/checkout/paypal/:paymentId/cancel')
  cancelPayPalCheckout(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string) {
    return this.paypalCheckout.cancel(user.id, paymentId);
  }

  @Post('finance/checkout/crypto')
  startCryptoCheckout(@CurrentUser() user: AuthUser, @Body() dto: CryptoCheckoutDto) {
    return this.cryptoCheckout.start(user.id, dto);
  }

  @Get('finance/checkout/crypto/:paymentId')
  describeCryptoCheckout(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string) {
    return this.cryptoCheckout.describe(user.id, paymentId);
  }

  @Post('finance/checkout/crypto/:paymentId/cancel')
  cancelCryptoCheckout(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string) {
    return this.cryptoCheckout.cancel(user.id, paymentId);
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
  @Post('finance/chargebacks/wallet-requests/:requestId')
  recordCashInRecall(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() dto: ChargebackDto,
  ) {
    return this.chargebacks.recordCashInRecall(user.id, requestId, dto);
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

  @Public()
  @Post('webhooks/crypto')
  async cryptoWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers(CRYPTO_SIGNATURE_HEADER) signature?: string) {
    const { outcome } = await this.cryptoCheckout.handleWebhook(req.rawBody ? req.rawBody.toString('utf8') : null, signature);
    return { received: true, outcome };
  }
}
