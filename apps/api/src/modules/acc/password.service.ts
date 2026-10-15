import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
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
 * Password change & reset (T032).
 *  - change: verify the CURRENT password, then set the new one (effective immediately).
 *  - requestReset: issue a single-use, time-limited emailed link (via VerificationService).
 *  - reset: consume that link and set a new password.
 *
 * BOTH PATHS NOW END EVERY OTHER SESSION, and that is the point of them.
 *
 * Changing a password used to write a new hash and touch nothing else. A session
 * is an opaque cookie with a seven-day life, checked against its own table — so
 * somebody who had stolen one kept full access to the account AFTER the owner
 * noticed and changed their password, which is the single moment the owner
 * believes they have locked the attacker out. The new password was not a
 * revocation of anything; it only changed what the next sign-in would need.
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
   * Ask for a reset link — and do exactly the same thing for any address (N11).
   *
   * The mail used to be sent here, inside the request, and only when the address
   * had an account. So a mail server that was down answered 500 for registered
   * addresses and 202 for everyone else, and on a good day the time taken — a
   * lookup, a token row and an SMTP conversation, or just the lookup — told the
   * same story. Both were ways to ask "does this person have an account?".
   *
   * Now the request records that a reset was asked for, by address, and nothing
   * else: no lookup, no token, no mail. The worker resolves the address, mints
   * the token and sends the link after the caller has had their answer, and an
   * address with no account is simply dropped there. The raw token never sits
   * in the outbox — it is minted where it is mailed, and only its hash is stored,
   * as for every other token.
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

    await this.db.transaction(async (tx) => {
      await tx
        .update(verificationToken)
        .set({ consumedAt: new Date() })
        .where(eq(verificationToken.id, tok.id));
      await tx
        .update(userAccount)
        .set({ passwordHash: await argon2.hash(newPassword) })
        .where(eq(userAccount.id, tok.userId));
    });

    // A reset exempts nothing. The person doing it is holding a link from their
    // inbox, not a session, so there is no session of theirs worth keeping — and
    // if the reason they are here is that somebody else has one, keeping any of
    // them is the whole failure.
    await this.sessions.revokeAllFor(tok.userId);
  }
}
