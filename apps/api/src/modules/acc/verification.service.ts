import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { EMAIL_ADAPTER } from '../../shared/adapters/adapters.module';
import type { EmailAdapter } from '@bault/adapters';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { generateToken, hashToken } from '../../shared/tokens';
import { userAccount, verificationToken } from './acc.schema';

const EMAIL_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Email verification & password-reset TOKEN issuance/consumption (T030).
 * Tokens are single-use and time-limited; only their hash is stored. The raw
 * token travels only in the emailed link.
 */
@Injectable()
export class VerificationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  async issueEmailVerification(userId: string, email: string): Promise<void> {
    const raw = generateToken();
    await this.db.insert(verificationToken).values({
      userId,
      type: 'email_verification',
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + EMAIL_TTL_MS),
    });
    await this.email.send({
      to: email,
      subject: 'Verify your Bault account',
      template: 'email_verification',
      variables: { link: `/verify-email?token=${raw}` },
    });
  }

  /** Consume a valid email-verification token and activate the account. */
  async verifyEmail(rawToken: string): Promise<void> {
    const [tok] = await this.db
      .select()
      .from(verificationToken)
      .where(
        and(
          eq(verificationToken.type, 'email_verification'),
          eq(verificationToken.tokenHash, hashToken(rawToken)),
        ),
      )
      .limit(1);

    if (!tok) throw AppError.tokenExpired('Invalid verification link');
    if (tok.consumedAt || tok.expiresAt.getTime() < Date.now()) {
      throw AppError.tokenExpired('Verification link expired or already used');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(verificationToken)
        .set({ consumedAt: new Date() })
        .where(eq(verificationToken.id, tok.id));
      await tx
        .update(userAccount)
        .set({ status: 'active' })
        .where(eq(userAccount.id, tok.userId));
    });
  }

  /** Re-issue a verification email for a still-pending account (expired link path). */
  async resend(email: string): Promise<void> {
    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(eq(userAccount.email, email))
      .limit(1);
    if (u && u.status === 'pending') await this.issueEmailVerification(u.id, u.email);
    // Silent otherwise: never reveal whether an email exists.
  }

  /** Issue a password-reset token (used by PasswordService.requestReset). */
  async issuePasswordReset(email: string): Promise<void> {
    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(eq(userAccount.email, email))
      .limit(1);
    if (!u) return; // silent — do not leak account existence
    const raw = generateToken();
    await this.db.insert(verificationToken).values({
      userId: u.id,
      type: 'password_reset',
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });
    await this.email.send({
      to: email,
      subject: 'Reset your Bault password',
      template: 'password_reset',
      variables: { link: `/reset-password?token=${raw}` },
    });
  }
}
