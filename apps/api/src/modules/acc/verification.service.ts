import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { loadEnv } from '@bault/config';
import { EMAIL_ADAPTER } from '../../shared/adapters/adapters.module';
import type { EmailAdapter } from '@bault/adapters';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { generateToken, hashToken } from '../../shared/tokens';
import { userAccount, verificationToken } from './acc.schema';

const EMAIL_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Build the absolute link that goes in an email.
 *
 * Two things make this more than string concatenation. The link must be
 * ABSOLUTE: a mail client has no origin to resolve `/verify-email` against. And
 * the SPA is a HASH router, so the route lives after `#`; a path-style link
 * would load the app at its default section and drop the token.
 *
 * The token is percent-encoded even though `generateToken` emits URL-safe
 * characters today, so a future change to the token alphabet cannot silently
 * produce a malformed link.
 */
function emailLink(route: string, token: string): string {
  const base = loadEnv().APP_BASE_URL.replace(/\/+$/, '');
  return `${base}/#/${route}?token=${encodeURIComponent(token)}`;
}

/**
 * Email verification TOKEN issuance/consumption. Tokens are single-use and
 * time-limited; only their hash is stored. The raw token travels only in the
 * emailed link. Password-reset mail is sent by the worker
 * (`password-reset-mail.ts`), from the event `PasswordService.requestReset` emits.
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
      variables: { link: emailLink('verify-email', raw) },
    });
  }

  /**
   * Consume a valid email-verification token and activate the account if, and
   * only if, it is still `pending`. A link stays valid for a day, so it must
   * never reinstate an account suspended or closed in the meantime.
   */
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
      // Single use under concurrency too: two clicks on one link consume it once.
      const [consumed] = await tx
        .update(verificationToken)
        .set({ consumedAt: new Date() })
        .where(and(eq(verificationToken.id, tok.id), isNull(verificationToken.consumedAt)))
        .returning({ id: verificationToken.id });
      if (!consumed) throw AppError.tokenExpired('Verification link expired or already used');

      const [activated] = await tx
        .update(userAccount)
        .set({ status: 'active' })
        .where(and(eq(userAccount.id, tok.userId), eq(userAccount.status, 'pending')))
        .returning({ id: userAccount.id });
      if (activated) return;

      // Already active (a second link from a resend, say) is not an error:
      // the address is confirmed and nothing needs to change.
      const [u] = await tx
        .select({ status: userAccount.status })
        .from(userAccount)
        .where(eq(userAccount.id, tok.userId))
        .limit(1);
      if (u?.status === 'active') return;
      // Suspended or closed stays exactly that. Throwing also rolls the
      // consumption back, which changes nothing: the link can never activate it.
      throw AppError.accountSuspended();
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
}
