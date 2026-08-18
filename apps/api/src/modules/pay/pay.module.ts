import { Global, Module } from '@nestjs/common';
import { BILLING_PORT } from '../../shared/billing/billing.port';
import { LedgerService } from './ledger.service';
import { WalletService } from './wallet.service';
import { BillingService } from './billing.service';
import { TopupService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { WalletRequestService } from './wallet-request.service';
import { CheckoutService } from './checkout.service';
import { ChargebackService } from './chargeback.service';
import { PayController } from './pay.controller';
import { WalletRequestController } from './wallet-request.controller';

/**
 * PAY module (finance). Global because the ledger/wallet/billing primitives are
 * used by MKT, SHP, DIS. Crucially it provides BILLING_PORT via the REAL
 * BillingService — replacing the Phase-4 no-op adapter without touching callers.
 */
@Global()
@Module({
  controllers: [PayController, WalletRequestController],
  providers: [
    CheckoutService,
    ChargebackService,
    LedgerService,
    WalletService,
    BillingService,
    TopupService,
    WithdrawalService,
    WalletRequestService,
    { provide: BILLING_PORT, useExisting: BillingService },
  ],
  exports: [LedgerService, WalletService, WalletRequestService, BILLING_PORT],
})
export class PayModule {}
