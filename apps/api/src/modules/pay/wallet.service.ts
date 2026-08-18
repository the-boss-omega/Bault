import { Injectable } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';
import {
  CASHOUT_BAND_MINOR,
  CASHOUT_LARGE_BPS,
  CASHOUT_LARGE_FIXED_MINOR,
  CASHOUT_SMALL_BPS,
  CASHOUT_SMALL_MINIMUM_MINOR,
  cashOutFeeMinor,
  cashOutNetMinor,
} from './money-terms';
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

  /**
   * What a cash-out of this size actually lands.
   *
   * Cashing out was free and no figure was quoted anywhere, which reads as
   * generous and is really an omission: the provider fee was being absorbed
   * silently, and a collector planning a $40 withdrawal could not find out what
   * would arrive until after they had asked for it.
   *
   * The same function the completion path uses, so the quote and the charge
   * cannot disagree.
   */
  cashOutQuote(amountMinor: number) {
    const feeMinor = cashOutFeeMinor(amountMinor);
    return {
      amountMinor,
      feeMinor,
      netMinor: cashOutNetMinor(amountMinor),
      /** The schedule itself, so the SPA can show the bands, not just a number. */
      schedule: {
        bandMinor: CASHOUT_BAND_MINOR,
        smallBps: CASHOUT_SMALL_BPS,
        smallMinimumMinor: CASHOUT_SMALL_MINIMUM_MINOR,
        largeFixedMinor: CASHOUT_LARGE_FIXED_MINOR,
        largeBps: CASHOUT_LARGE_BPS,
      },
    };
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
