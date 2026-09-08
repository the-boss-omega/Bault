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
}
class WithdrawConfirmDto {
  @IsString() confirmationToken!: string;
}

class CheckoutDto {
  @IsInt() @Min(1) amountMinor!: number;
  /** A route the provider settles. A manual one is refused with the reason. */
  @IsString() route!: string;
  /** The caller's own key. What makes a double-clicked button harmless. */
  @IsString() @MaxLength(120) idempotencyKey!: string;
  /** A provider-side token. NEVER a card number (Principle IX). */
  @IsOptional() @IsString() @MaxLength(200) paymentMethodToken?: string;
}

class ChargebackDto {
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(140) providerCaseRef?: string;
  /** False when Bault won the dispute and the provider charged no fee. */
  @IsOptional() @IsBoolean() chargeFee?: boolean;
}

/**
 * PAY endpoints (T071). `/finance/*` + `/webhooks/payment`.
 *
 * BACKWARD COMPATIBILITY, deliberate and documented:
 *
 * `POST /finance/wallet/topups` and `POST /finance/withdrawals` used to move money
 * directly — the top-up credited the ledger on the spot, and the withdrawal
 * debited it after a confirmation challenge. Under the request workflow no path
 * may change a balance without an approved, completed request, so both routes
 * survive at the same URL with the same request body but NEW semantics: each now
 * RAISES a wallet request and returns it. Their responses carry
 * `status: 'pending_approval'` plus the request id and code, so an older client
 * that ignores the extra fields still gets a 2xx and a truthful `status`, and one
 * that reads `status` sees plainly that nothing settled.
 *
 * `POST /finance/withdrawals/confirm` is the one route that could not be kept
 * honest: consuming a confirmation token used to pay money out immediately.
 * There is no longer any such capability for a customer to invoke, so the route
 * refuses with a clear pointer to the request workflow rather than pretending.
 *
 * `TopupService` and `WithdrawalService` remain wired: the payment-provider and
 * confirmation plumbing they own is what a completed request will use when a real
 * provider is connected, and `handleWebhook` is still the provider's callback.
 */
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

  /**
   * How money can come in, with the account details for the manual routes.
   *
   * `bank_transfer` was one of five strings on a form and no particulars were
   * published anywhere, so choosing it told Bault how the money would arrive
   * and told the customer nothing about how to send it.
   */
  @Get('finance/funding-routes')
  fundingRoutes() {
    return this.checkout.routes();
  }

  /**
   * Take a payment now, on a route the provider settles.
   *
   * Distinct from a cash-in REQUEST on purpose: a card payment is confirmed by
   * the provider, so making it wait on a reviewer adds a delay that protects
   * nobody. A route nothing confirms still goes through the request workflow.
   */
  @Post('finance/checkout')
  pay(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.checkout.checkout(user.id, dto);
  }

  @Get('finance/payments')
  myPayments(@CurrentUser() user: AuthUser) {
    return this.checkout.listMine(user.id);
  }

  /**
   * What a cash-out of this size costs, before asking for one.
   *
   * Cashing out was free and no figure was quoted anywhere, which reads as
   * generous and is really an omission — the provider fee was being absorbed
   * silently and the collector could not find out what would land.
   */
  @Get('finance/cash-out-quote')
  cashOutQuote(@Query('amountMinor') amountMinor: string) {
    const amount = Number.parseInt(amountMinor ?? '0', 10);
    return this.wallet.cashOutQuote(Number.isFinite(amount) ? amount : 0);
  }

  /* ---- Chargebacks. Operator-only: a provider tells us out of band. ---- */

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

  /** Money in the wallet that is spoken for by open requests, for the summary. */
  @Get('finance/wallet/pending')
  pending(@CurrentUser() user: AuthUser) {
    return this.requests.openTotals(user.id);
  }

  /**
   * LEGACY SHIM — raises a cash-in request instead of crediting the wallet.
   * The balance does not move here; only an approved, completed request moves it.
   */
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

  /**
   * LEGACY SHIM — raises a cash-out request instead of issuing a confirmation
   * challenge. Returns no `confirmationToken`, because there is nothing a token
   * could confirm: a reviewer decides this now.
   */
  @Post('finance/withdrawals')
  async requestWithdrawal(@CurrentUser() user: AuthUser, @Body() dto: WithdrawRequestDto) {
    const created = await this.requests.submit(user.id, {
      type: 'cash_out',
      amountMinor: dto.amountMinor,
      currency: 'USD',
      destinationAccount: dto.destinationAccount,
      beneficiaryName: dto.destinationAccount,
      notes: 'Raised through the legacy /finance/withdrawals endpoint.',
    });
    return {
      status: 'pending_approval',
      requestId: created.id,
      code: created.code,
      requestStatus: created.status,
    };
  }

  /**
   * RETIRED. Confirming a token used to pay out immediately; no customer-invokable
   * path may do that any more. Answered with a 410 naming its replacement rather
   * than a silent success that moves nothing.
   */
  @Post('finance/withdrawals/confirm')
  confirmWithdrawal(@CurrentUser() _user: AuthUser, @Body() _dto: WithdrawConfirmDto) {
    throw this.withdrawals.retiredConfirmEndpoint();
  }

  @Public()
  /**
   * A provider telling us something happened.
   *
   * Public, because a provider has no session — which is exactly why the
   * verification behind it is the only thing standing between this route and
   * anyone on the internet. The WHOLE delivery is handed to the adapter: real
   * verification needs the headers, not one signature string, and PayPal's is a
   * call rather than a compare.
   *
   * An unverifiable delivery throws, which the global filter renders as a 4xx.
   * That is deliberate — a provider that gets a 4xx retries and eventually
   * alerts a human, whereas a 200 for a body we could not authenticate is a
   * silent acceptance of whatever it said.
   */
  @Post('webhooks/payment')
  async webhook(@Req() req: Request) {
    await this.topups.handleWebhook({
      rawBody: JSON.stringify(req.body ?? {}),
      headers: req.headers as Record<string, string | undefined>,
    });
    return { received: true };
  }
}
