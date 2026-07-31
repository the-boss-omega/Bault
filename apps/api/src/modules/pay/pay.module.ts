import { Global, Module } from '@nestjs/common';
import { BILLING_PORT } from '../../shared/billing/billing.port';
import { LedgerService } from './ledger.service';
import { WalletService } from './wallet.service';
import { BillingService } from './billing.service';
import { TopupService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { PayController } from './pay.controller';

/**
 * PAY module (finance). Global because the ledger/wallet/billing primitives are
 * used by MKT, SHP, DIS. Crucially it provides BILLING_PORT via the REAL
 * BillingService — replacing the Phase-4 no-op adapter without touching callers.
 */
@Global()
@Module({
  controllers: [PayController],
  providers: [
    LedgerService,
    WalletService,
    BillingService,
    TopupService,
    WithdrawalService,
    { provide: BILLING_PORT, useExisting: BillingService },
  ],
  exports: [LedgerService, WalletService, BILLING_PORT],
})
export class PayModule {}
