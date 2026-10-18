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

const EMAIL_TTL_MS = 24 * 60 * 60 * 1000;

function emailLink(route: string, token: string): string {
  const base = loadEnv().APP_BASE_URL.replace(/\/+$/, '');
  return `${base}/#/${route}?token=${encodeURIComponent(token)}`;
}

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

      const [u] = await tx
        .select({ status: userAccount.status })
        .from(userAccount)
        .where(eq(userAccount.id, tok.userId))
        .limit(1);
      if (u?.status === 'active') return;
      throw AppError.accountSuspended();
    });
  }

  async resend(email: string): Promise<void> {
    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(eq(userAccount.email, email))
      .limit(1);
    if (u && u.status === 'pending') await this.issueEmailVerification(u.id, u.email);
  }
}
