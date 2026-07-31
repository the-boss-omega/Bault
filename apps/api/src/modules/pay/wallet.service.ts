import { Injectable } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { isNegative } from '../../shared/money';
import { LedgerService } from './ledger.service';
import type { Database } from '../../db/client';

/**
 * Wallet (T066, Principle IV) — a thin, API-facing view over the ledger. The
 * balance is always derived (LedgerService.balanceOf); nothing is stored.
 * `assertNotBlocked` enforces "a negative balance blocks defined services".
 */
@Injectable()
export class WalletService {
  constructor(private readonly ledger: LedgerService) {}

  balance(userId: string) {
    return this.ledger.balanceOf(userId);
  }

  ledgerList(userId: string) {
    return this.ledger.list(userId);
  }

  async assertNotBlocked(userId: string, tx?: Database): Promise<void> {
    const bal = await this.ledger.balanceOf(userId, tx);
    if (isNegative(bal)) {
      throw new AppError(
        ErrorCode.NEGATIVE_BALANCE_BLOCKED,
        'This action is blocked while your balance is negative.',
        409,
      );
    }
  }
}
