import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { hashToken } from '../../shared/tokens';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount, verificationToken } from './acc.schema';
import { SessionService } from './session.service';

/**
 * The outbox event a reset request becomes. The worker's
 * `password-reset-mail.ts` handles it and is matched to this string by value.
 */
export const PASSWORD_RESET_REQUESTED = 'password_reset_requested';

/**
 * Password change & reset.
 *  - change: verify the CURRENT password, then set the new one (effective immediately).
 *  - requestReset: record the request; the worker mails a single-use, time-limited link.
 *  - reset: consume that link and set a new password.
 *
 * BOTH PATHS END EVERY OTHER SESSION. A session is an opaque cookie with a
 * seven-day life, checked against its own table, so without that a stolen one
 * would keep working after the owner changed their password, the moment they
 * believe they have locked the attacker out.
 */
@Injectable()
export class PasswordService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * `currentSessionToken` is the raw cookie the caller is holding, so their own
   * session survives. Everything else the account has open ends here.
   */
  async change(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionToken?: string,
  ): Promise<{ otherSessionsEnded: number }> {
    const [u] = await this.db
      .select({ passwordHash: userAccount.passwordHash })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u || !(await argon2.verify(u.passwordHash, currentPassword))) {
      throw AppError.validation('Current password is incorrect');
    }
    await this.db
      .update(userAccount)
      .set({ passwordHash: await argon2.hash(newPassword) })
      .where(eq(userAccount.id, userId));

    // After the write, not inside it: a revocation that rolled back with a
    // failed password update would report sessions ended that are still live.
    const otherSessionsEnded = await this.sessions.revokeAllFor(userId, currentSessionToken);
    return { otherSessionsEnded };
  }

  /**
   * Ask for a reset link, and do exactly the same thing for any address.
   *
   * The request records that a reset was asked for, by address, and nothing
   * else: no lookup, no token, no mail. So neither the status code nor the time
   * taken can tell a caller whether the address has an account. The worker
   * resolves the address, mints the token and sends the link after the caller
   * has had their answer, and an address with no account is dropped there. The
   * raw token never sits in the outbox: it is minted where it is mailed, and
   * only its hash is stored, as for every other token.
   *
   * Not inside a transaction with a state change, because there is none: the
   * outbox row IS the whole effect of this request.
   */
  async requestReset(email: string): Promise<void> {
    const address = email.trim().toLowerCase();
    await this.outbox.emit(this.db, {
      aggregateType: 'password_reset',
      aggregateId: address,
      eventType: PASSWORD_RESET_REQUESTED,
      payload: { email: address },
    });
  }

  async reset(rawToken: string, newPassword: string): Promise<void> {
    const [tok] = await this.db
      .select()
      .from(verificationToken)
      .where(
        and(
          eq(verificationToken.type, 'password_reset'),
          eq(verificationToken.tokenHash, hashToken(rawToken)),
        ),
      )
      .limit(1);

    if (!tok) throw AppError.tokenExpired('Invalid reset link');
    if (tok.consumedAt || tok.expiresAt.getTime() < Date.now()) {
      throw AppError.tokenExpired('Reset link expired or already used');
    }

    // Hashed before the transaction, so the token row is not held locked for
    // the length of an argon2 run.
    const passwordHash = await argon2.hash(newPassword);
    await this.db.transaction(async (tx) => {
      // Single use under concurrency too: the check above is a read, and two
      // requests with one link both passed it and both set a password. Only the
      // request whose update consumes the token sets one.
      const [consumed] = await tx
        .update(verificationToken)
        .set({ consumedAt: new Date() })
        .where(and(eq(verificationToken.id, tok.id), isNull(verificationToken.consumedAt)))
        .returning({ id: verificationToken.id });
      if (!consumed) throw AppError.tokenExpired('Reset link expired or already used');
      await tx.update(userAccount).set({ passwordHash }).where(eq(userAccount.id, tok.userId));
    });

    // A reset exempts nothing. The person doing it is holding a link from their
    // inbox, not a session, and if they are here because somebody else has one,
    // keeping any session would defeat the reset.
    await this.sessions.revokeAllFor(tok.userId);
  }
}
