import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { PG_UNIQUE_VIOLATION, pgErrorCode } from '../../shared/errors/pg-error';
import { hashToken } from '../../shared/tokens';
import { AuditService } from '../sec/audit.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { mfaChallenge, mfaEmailCode, mfaFactor, userAccount, verificationToken } from './acc.schema';
import { LoginAttemptService } from './login-attempts.service';
import { MfaService, codeInvalid } from './mfa/mfa.service';
import { SessionService, type ClientOrigin } from './session.service';

export const EMAIL_CHANGE_REQUESTED = 'email_change_requested';
export const EMAIL_CHANGED = 'email_changed';

const linkInvalid = () => AppError.tokenExpired('This confirmation link no longer works: it has expired, has been replaced or has already been used.');

const taken = () => AppError.conflict(ErrorCode.CONFLICT, 'That address belongs to another account.');

@Injectable()
export class EmailChangeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly attempts: LoginAttemptService,
    private readonly audit: AuditService,
  ) {}

  async request(
    userId: string,
    email: string,
    currentPassword: string,
    code: string | undefined,
    origin: ClientOrigin,
  ): Promise<{ pendingEmail: string }> {
    const address = email.trim().toLowerCase();
    const [u] = await this.db
      .select({
        email: userAccount.email,
        username: userAccount.username,
        passwordHash: userAccount.passwordHash,
        role: userAccount.role,
      })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u) throw AppError.notFound('Account not found');

    const needsCode = this.mfa.requiredFor(u.role) || (await this.mfa.enabledMethod(userId)) === 'totp';
    if (needsCode) await this.mfa.refuseWhileLocked(userId);
    if (!(await argon2.verify(u.passwordHash, currentPassword))) {
      throw AppError.validation('Current password is incorrect');
    }
    const factorCode = code?.trim() ?? '';
    if (needsCode && !factorCode) {
      throw AppError.validation('Enter the current code from your authenticator app as well.');
    }
    if (address === u.email) throw AppError.validation('That is already the email address on this account.');
    await this.refuseTaken(this.db, userId, address);

    const done = await this.db.transaction(async (tx) => {
      if (needsCode && !(await this.mfa.spendAuthenticatorCode(tx as Database, userId, factorCode))) return false;
      await tx
        .update(userAccount)
        .set({ pendingEmail: address, pendingEmailTokenHash: null, pendingEmailExpiresAt: null })
        .where(eq(userAccount.id, userId));
      await this.emitLink(tx as Database, userId, address, true);
      await this.audit.record(
        {
          actorId: userId,
          action: 'account.email_change_requested',
          targetEntity: 'user_account',
          targetId: userId,
          metadata: { to: address },
        },
        tx as Database,
      );
      return true;
    });
    if (!done) {
      await this.attempts.record(u.username, userId, 'mfa_failed', origin);
      throw codeInvalid(HttpStatus.BAD_REQUEST);
    }
    return { pendingEmail: address };
  }

  async resend(userId: string): Promise<{ pendingEmail: string }> {
    return this.db.transaction(async (tx) => {
      const [u] = await tx
        .select({ pendingEmail: userAccount.pendingEmail })
        .from(userAccount)
        .where(eq(userAccount.id, userId))
        .limit(1)
        .for('update');
      if (!u?.pendingEmail) {
        throw AppError.conflict(ErrorCode.CONFLICT, 'There is no change of email address waiting to be confirmed.');
      }
      await tx
        .update(userAccount)
        .set({ pendingEmailTokenHash: null, pendingEmailExpiresAt: null })
        .where(eq(userAccount.id, userId));
      await this.emitLink(tx as Database, userId, u.pendingEmail, false);
      return { pendingEmail: u.pendingEmail };
    });
  }

  async cancel(userId: string): Promise<void> {
    await this.db
      .update(userAccount)
      .set({ pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpiresAt: null })
      .where(eq(userAccount.id, userId));
  }

  async confirm(rawToken: string, currentSessionToken?: string): Promise<{ otherSessionsEnded: number }> {
    const tokenHash = hashToken(rawToken);
    return this.db.transaction(async (tx) => {
      const exec = tx as Database;
      const [u] = await tx
        .select({
          id: userAccount.id,
          email: userAccount.email,
          status: userAccount.status,
          pendingEmail: userAccount.pendingEmail,
          live: sql<boolean>`${userAccount.pendingEmailExpiresAt} > now()`,
        })
        .from(userAccount)
        .where(eq(userAccount.pendingEmailTokenHash, tokenHash))
        .limit(1)
        .for('update');
      if (!u?.pendingEmail || !u.live) throw linkInvalid();
      if (u.status !== 'active' && u.status !== 'suspended') throw linkInvalid();
      const next = u.pendingEmail;
      await this.refuseTaken(exec, u.id, next);

      try {
        await tx
          .update(userAccount)
          .set({ email: next, pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpiresAt: null })
          .where(and(eq(userAccount.id, u.id), eq(userAccount.pendingEmailTokenHash, tokenHash)));
      } catch (e) {
        if (pgErrorCode(e) === PG_UNIQUE_VIOLATION) throw taken();
        throw e;
      }

      const now = new Date();
      await tx
        .update(mfaFactor)
        .set({ emailAddress: next })
        .where(and(eq(mfaFactor.userId, u.id), eq(mfaFactor.method, 'email'), isNotNull(mfaFactor.enabledAt)));
      await tx
        .update(mfaEmailCode)
        .set({ consumedAt: now })
        .where(and(eq(mfaEmailCode.userId, u.id), isNull(mfaEmailCode.consumedAt)));
      await tx
        .update(verificationToken)
        .set({ consumedAt: now })
        .where(and(eq(verificationToken.userId, u.id), isNull(verificationToken.consumedAt)));
      await tx
        .update(mfaChallenge)
        .set({ consumedAt: now })
        .where(and(eq(mfaChallenge.userId, u.id), isNull(mfaChallenge.consumedAt)));
      const otherSessionsEnded = await this.sessions.revokeAllFor(u.id, currentSessionToken, exec);

      await this.audit.record(
        {
          actorId: u.id,
          action: 'account.email_changed',
          targetEntity: 'user_account',
          targetId: u.id,
          metadata: { from: u.email, to: next, otherSessionsEnded },
        },
        exec,
      );
      await this.outbox.emit(exec, {
        aggregateType: 'user_account',
        aggregateId: u.id,
        eventType: EMAIL_CHANGED,
        payload: { userId: u.id, previousEmail: u.email },
      });
      return { otherSessionsEnded };
    });
  }

  private async emitLink(tx: Database, userId: string, pendingEmail: string, notifyOld: boolean): Promise<void> {
    await this.outbox.emit(tx, {
      aggregateType: 'user_account',
      aggregateId: userId,
      eventType: EMAIL_CHANGE_REQUESTED,
      payload: { userId, pendingEmail, notifyOld },
    });
  }

  private async refuseTaken(exec: Database, userId: string, address: string): Promise<void> {
    const [other] = await exec
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(and(eq(userAccount.email, address), ne(userAccount.id, userId)))
      .limit(1);
    if (other) throw taken();
  }
}
