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

export const PASSWORD_RESET_REQUESTED = 'password_reset_requested';

@Injectable()
export class PasswordService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly sessions: SessionService,
  ) {}

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

    const otherSessionsEnded = await this.sessions.revokeAllFor(userId, currentSessionToken);
    return { otherSessionsEnded };
  }

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

    const passwordHash = await argon2.hash(newPassword);
    await this.db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(verificationToken)
        .set({ consumedAt: new Date() })
        .where(and(eq(verificationToken.id, tok.id), isNull(verificationToken.consumedAt)))
        .returning({ id: verificationToken.id });
      if (!consumed) throw AppError.tokenExpired('Reset link expired or already used');
      await tx.update(userAccount).set({ passwordHash }).where(eq(userAccount.id, tok.userId));
    });

    await this.sessions.revokeAllFor(tok.userId);
  }
}
