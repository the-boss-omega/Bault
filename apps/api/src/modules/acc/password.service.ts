import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { hashToken } from '../../shared/tokens';
import { userAccount, verificationToken } from './acc.schema';
import { VerificationService } from './verification.service';

/**
 * Password change & reset (T032).
 *  - change: verify the CURRENT password, then set the new one (effective immediately).
 *  - requestReset: issue a single-use, time-limited emailed link (via VerificationService).
 *  - reset: consume that link and set a new password.
 */
@Injectable()
export class PasswordService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly verification: VerificationService,
  ) {}

  async change(userId: string, currentPassword: string, newPassword: string): Promise<void> {
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
  }

  async requestReset(email: string): Promise<void> {
    await this.verification.issuePasswordReset(email.trim().toLowerCase());
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
  }
}
