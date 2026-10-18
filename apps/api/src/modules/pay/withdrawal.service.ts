import { Injectable } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';

@Injectable()
export class WithdrawalService {
  retiredConfirmEndpoint(): AppError {
    return AppError.tokenExpired(
      'Direct withdrawal confirmation has been retired. Cash-out is now a reviewed request: POST /finance/wallet-requests with type "cash_out".',
    );
  }
}
