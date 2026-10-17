import { Injectable } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';

/**
 * What is left of direct withdrawal: the answer its retired route gives.
 *
 * A cash-out is a reviewed request, and the money moves in
 * `WalletRequestService.complete`. The old two-step `request`/`confirm` pair
 * had no caller left; `confirm` paid out from inside the transaction that
 * debited the wallet and recorded the debit whatever the provider answered,
 * so it was removed rather than kept as a trap for the next caller.
 */
@Injectable()
export class WithdrawalService {
  /**
   * The error the retired `/finance/withdrawals/confirm` route answers with:
   * a 410 that names what replaced it.
   */
  retiredConfirmEndpoint(): AppError {
    return AppError.tokenExpired(
      'Direct withdrawal confirmation has been retired. Cash-out is now a reviewed request: POST /finance/wallet-requests with type "cash_out".',
    );
  }
}
