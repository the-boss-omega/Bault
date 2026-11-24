import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, count, desc, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { toString as qrToString } from 'qrcode';
import { loadEnv } from '@bault/config';
import { DRIZZLE } from '../../../db/db.module';
import type { Database } from '../../../db/client';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCode } from '../../../shared/errors/error-codes';
import { generateToken, hashToken } from '../../../shared/tokens';
import { AuditService } from '../../sec/audit.service';
import type { AuthUser, MfaMethod, Role } from '../../sec/auth-context';
import { OutboxService } from '../../not/outbox/outbox.service';
import { mfaChallenge, mfaEmailCode, mfaFactor, mfaRecoveryCode, userAccount } from '../acc.schema';
import { LoginAttemptService } from '../login-attempts.service';
import { SessionService, type ClientOrigin } from '../session.service';
import { emailCodeKey, emailCodeMatches, maskEmail, normalizeEmailCode } from './email-codes';
import { MFA_POLICY, type MfaPolicy } from './mfa-policy';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import { UnreadableSecretError, deriveSubkey, keyFromBase64, openSecret, sealSecret } from './secret-box';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp';
import { sameId } from '../../../shared/uuid-param';

const CHALLENGE_TTL_MINUTES = 5;
const EMAIL_CHALLENGE_TTL_MINUTES = 30;
const CHALLENGE_MAX_FAILURES = 5;
const ISSUER = 'Card Embassy';

export const EMAIL_CODE_MAX_FAILURES = 5;
export const EMAIL_CODE_RESEND_SECONDS = 60;
export const EMAIL_CODES_PER_HOUR = 5;
const EMAIL_CODE_RETENTION_HOURS = 24;

export const MFA_EMAIL_CODE_REQUESTED = 'mfa_email_code_requested';

export type SecondFactorProof = { code: string } | { recoveryCode: string };

export type Challenge =
  | { challengeToken: string; expiresAt: Date; method: 'totp' }
  | {
      challengeToken: string;
      expiresAt: Date;
      method: 'email';
      codeSent: boolean;
      sentTo: string | null;
      resendAfterSeconds: number;
    };

export type EmailCodeRefusal =
  | { reason: 'wrong'; attemptsLeft: number }
  | { reason: 'none' | 'not_sent' | 'expired' | 'exhausted' | 'address_changed' };

export type Redemption =
  | { status: 'ok'; user: AuthUser; rawToken: string; expiresAt: Date }
  | { status: 'invalid' }
  | { status: 'code_refused'; refusal: EmailCodeRefusal }
  | { status: 'expired' }
  | { status: 'refused' };

type Exec = Database;
type Factor = typeof mfaFactor.$inferSelect;
type Purpose = 'sign_in' | 'settings';
type EmailCodeSpend = { ok: true; sentTo: string } | ({ ok: false } & EmailCodeRefusal);
type CodeRequest =
  | { sent: true; sentTo: string; resendAfterSeconds: number }
  | { sent: false; error: AppError; resendAfterSeconds: number };
type FactorProof = { ok: true } | { ok: false; refusal?: EmailCodeRefusal };

@Injectable()
export class MfaService {
  private readonly key: Buffer;
  private readonly recoveryKey: Buffer;
  private readonly emailKey: Buffer;
  private readonly logger = new Logger('MfaService');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(MFA_POLICY) private readonly policy: MfaPolicy,
  ) {
    this.key = keyFromBase64(loadEnv().MFA_ENCRYPTION_KEY);
    this.recoveryKey = deriveSubkey(this.key, 'recovery-codes');
    this.emailKey = emailCodeKey(this.key);
  }

  requiredFor(role: Role): boolean {
    return this.policy.requiredRoles.includes(role);
  }

  methodsFor(role: Role): MfaMethod[] {
    return this.requiredFor(role) ? ['totp'] : ['email', 'totp'];
  }

  mustEnrol(user: { role: Role; mfaMethod?: MfaMethod | null }): boolean {
    return this.requiredFor(user.role) && user.mfaMethod !== 'totp';
  }

  async enabledMethod(userId: string, exec: Exec = this.db): Promise<MfaMethod | null> {
    const [f] = await exec
      .select({ method: mfaFactor.method })
      .from(mfaFactor)
      .where(and(eq(mfaFactor.userId, userId), isNotNull(mfaFactor.enabledAt)))
      .limit(1);
    return f?.method ?? null;
  }

  async status(user: AuthUser) {
    const factors = await this.db
      .select({
        method: mfaFactor.method,
        enabledAt: mfaFactor.enabledAt,
        emailAddress: mfaFactor.emailAddress,
        createdAt: mfaFactor.createdAt,
      })
      .from(mfaFactor)
      .where(eq(mfaFactor.userId, user.id));
    const enabled = factors.find((f) => f.enabledAt !== null);
    const pending = factors
      .filter((f) => f.enabledAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const [account] = await this.db
      .select({ email: userAccount.email })
      .from(userAccount)
      .where(eq(userAccount.id, user.id))
      .limit(1);
    const [left] = await this.db
      .select({ n: count() })
      .from(mfaRecoveryCode)
      .where(and(eq(mfaRecoveryCode.userId, user.id), isNull(mfaRecoveryCode.usedAt)));
    return {
      enabled: Boolean(enabled),
      pending: Boolean(pending),
      method: enabled?.method ?? null,
      pendingMethod: pending?.method ?? null,
      methods: this.methodsFor(user.role),
      email: (enabled?.method === 'email' ? enabled.emailAddress : null) ?? account?.email ?? null,
      required: this.requiredFor(user.role),
      recoveryCodesRemaining: enabled ? Number(left?.n ?? 0) : 0,
    };
  }

  beginSetup(user: AuthUser, method: MfaMethod = 'totp') {
    return method === 'email' ? this.beginEmailSetup(user) : this.beginTotpSetup(user);
  }

  private async beginTotpSetup(user: AuthUser) {
    const userId = user.id;
    const [u] = await this.db
      .select({ username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u) throw AppError.notFound('Account not found');

    const inForce = await this.enabledMethod(userId);
    if (inForce === 'totp' || (inForce === 'email' && !this.requiredFor(user.role))) throw alreadyEnabled();

    const secret = generateTotpSecret();
    const sealed = sealSecret(this.key, secret, userId);
    const written = await this.db.transaction(async (tx) => {
      await tx
        .delete(mfaFactor)
        .where(and(eq(mfaFactor.userId, userId), ne(mfaFactor.method, 'totp'), isNull(mfaFactor.enabledAt)));
      return tx
        .insert(mfaFactor)
        .values({ userId, method: 'totp', secretCiphertext: sealed })
        .onConflictDoUpdate({
          target: [mfaFactor.userId, mfaFactor.method],
          set: { secretCiphertext: sealed, lastUsedStep: null, createdAt: new Date() },
          setWhere: isNull(mfaFactor.enabledAt),
        })
        .returning({ userId: mfaFactor.userId });
    });
    if (written.length === 0) throw alreadyEnabled();

    const uri = otpauthUri({ issuer: ISSUER, account: u.username, secret });
    const svg = await qrToString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    return {
      method: 'totp' as const,
      otpauthUri: uri,
      secret: base32Encode(secret),
      qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    };
  }

  private async beginEmailSetup(user: AuthUser) {
    if (this.requiredFor(user.role)) throw methodNotAllowed();
    await this.refuseWhileLocked(user.id);
    return this.db.transaction(async (tx) => {
      await this.lockCodesOf(tx as Exec, user.id);
      if (await this.enabledMethod(user.id, tx as Exec)) throw alreadyEnabled();
      await tx
        .delete(mfaFactor)
        .where(and(eq(mfaFactor.userId, user.id), ne(mfaFactor.method, 'email'), isNull(mfaFactor.enabledAt)));
      await tx
        .insert(mfaFactor)
        .values({ userId: user.id, method: 'email' })
        .onConflictDoUpdate({
          target: [mfaFactor.userId, mfaFactor.method],
          set: { createdAt: new Date() },
          setWhere: isNull(mfaFactor.enabledAt),
        });
      const request = await this.requestCode(tx as Exec, user.id, 'settings', 'reuse');
      if (!request.sent) throw request.error;
      return { method: 'email' as const, email: request.sentTo, resendAfterSeconds: request.resendAfterSeconds };
    });
  }

  async sendSettingsCode(user: AuthUser) {
    await this.refuseWhileLocked(user.id);
    return this.db.transaction(async (tx) => {
      await this.lockCodesOf(tx as Exec, user.id);
      const [factor] = await tx
        .select({ method: mfaFactor.method })
        .from(mfaFactor)
        .where(and(eq(mfaFactor.userId, user.id), eq(mfaFactor.method, 'email')))
        .limit(1);
      if (!factor) {
        throw AppError.conflict(
          ErrorCode.MFA_NOT_ENABLED,
          'This account does not use emailed codes, so there is no code to send. Set them up first.',
        );
      }
      const request = await this.requestCode(tx as Exec, user.id, 'settings', 'new');
      if (!request.sent) throw request.error;
      return { status: 'code_sent' as const, email: request.sentTo, resendAfterSeconds: request.resendAfterSeconds };
    });
  }

  async resendSignInCode(userId: string): Promise<{ sentTo: string; resendAfterSeconds: number }> {
    return this.db.transaction(async (tx) => {
      await this.lockCodesOf(tx as Exec, userId);
      if ((await this.enabledMethod(userId, tx as Exec)) !== 'email') {
        throw AppError.validation(
          'This sign-in asks for the code from your authenticator app, so there is nothing to email. Use the app, or a recovery code.',
        );
      }
      const request = await this.requestCode(tx as Exec, userId, 'sign_in', 'new');
      if (!request.sent) throw request.error;
      return { sentTo: maskEmail(request.sentTo), resendAfterSeconds: request.resendAfterSeconds };
    });
  }

  async confirmSetup(
    user: AuthUser,
    method: MfaMethod,
    password: string,
    code: string,
    currentSessionToken: string | undefined,
    origin: ClientOrigin,
  ): Promise<{ recoveryCodes: string[]; otherSessionsEnded: number }> {
    const userId = user.id;
    if (method === 'email' && this.requiredFor(user.role)) throw methodNotAllowed();
    await this.refuseWhileLocked(userId);
    const [u] = await this.db
      .select({ passwordHash: userAccount.passwordHash, username: userAccount.username, email: userAccount.email })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u) throw AppError.notFound('Account not found');
    if (!(await argon2.verify(u.passwordHash, password))) {
      await this.attempts.record(u.username, userId, 'mfa_failed', origin);
      throw passwordOrCodeWrong();
    }

    const outcome = await this.db.transaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(mfaFactor)
        .where(and(eq(mfaFactor.userId, userId), eq(mfaFactor.method, method)))
        .for('update')
        .limit(1);
      if (!f) {
        throw AppError.conflict(ErrorCode.MFA_NOT_ENABLED, 'There is no two-factor setup to confirm. Start it again.');
      }
      if (f.enabledAt) throw alreadyEnabled();

      let step: number | null = null;
      let emailAddress: string | null = null;
      if (method === 'totp') {
        step = matchTotp(this.open(f), normalizeCode(code), Date.now());
        if (step === null) throw passwordOrCodeWrong();
      } else {
        const spent = await this.spendEmailCode(tx as Exec, userId, 'settings', null, u.email, code);
        if (!spent.ok) return { refused: true as const };
        emailAddress = spent.sentTo;
      }

      const replaced = await tx
        .delete(mfaFactor)
        .where(and(eq(mfaFactor.userId, userId), ne(mfaFactor.method, method)))
        .returning({ method: mfaFactor.method, enabledAt: mfaFactor.enabledAt });
      await tx
        .update(mfaFactor)
        .set({ enabledAt: new Date(), lastUsedStep: step, emailAddress })
        .where(and(eq(mfaFactor.userId, userId), eq(mfaFactor.method, method), isNull(mfaFactor.enabledAt)));
      if (method === 'totp') await this.withdrawEmailCodes(tx as Exec, userId);
      const recoveryCodes = await this.replaceRecoveryCodes(tx as Exec, userId);
      const otherSessionsEnded = await this.sessions.revokeAllFor(userId, currentSessionToken, tx as Exec);
      const replacedMethod = replaced.find((r) => r.enabledAt !== null)?.method;
      await this.audit.record(
        {
          actorId: userId,
          action: 'mfa.enable',
          targetEntity: 'user_account',
          targetId: userId,
          metadata: { otherSessionsEnded, method, ...(replacedMethod ? { replaced: replacedMethod } : {}) },
        },
        tx as Exec,
      );
      return { recoveryCodes, otherSessionsEnded };
    });
    if ('refused' in outcome) {
      await this.attempts.record(u.username, userId, 'mfa_failed', origin);
      throw passwordOrCodeWrong();
    }
    return outcome;
  }

  async regenerateRecoveryCodes(user: AuthUser, code: string, origin: ClientOrigin) {
    await this.refuseWhileLocked(user.id);
    const outcome = await this.db.transaction(async (tx) => {
      const f = await this.enabledFactor(tx as Exec, user.id);
      const proof = await this.spendFactorCode(tx as Exec, f, code);
      if (!proof.ok) return proof;
      const codes = await this.replaceRecoveryCodes(tx as Exec, user.id);
      await this.audit.record(
        { actorId: user.id, action: 'mfa.recovery_codes_replaced', targetEntity: 'user_account', targetId: user.id },
        tx as Exec,
      );
      return { ok: true as const, codes };
    });
    if (!outcome.ok) {
      await this.attempts.record(await this.identifierOf(user.id), user.id, 'mfa_failed', origin);
      throw outcome.refusal ? emailCodeRefused(outcome.refusal, HttpStatus.BAD_REQUEST) : codeInvalid(HttpStatus.BAD_REQUEST);
    }
    return { recoveryCodes: outcome.codes };
  }

  async disable(user: AuthUser, password: string, code: string, origin: ClientOrigin): Promise<void> {
    if (this.requiredFor(user.role)) {
      throw new AppError(
        ErrorCode.MFA_REQUIRED_FOR_ROLE,
        'Two-factor sign-in is required for your role and cannot be turned off. If you have lost your authenticator, ask another administrator to reset it.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.refuseWhileLocked(user.id);
    const [u] = await this.db
      .select({ passwordHash: userAccount.passwordHash, username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, user.id))
      .limit(1);
    if (!u) throw AppError.notFound('Account not found');
    await this.enabledFactor(this.db, user.id);

    const passwordRight = await argon2.verify(u.passwordHash, password);
    const done =
      passwordRight &&
      (await this.db.transaction(async (tx) => {
        const f = await this.enabledFactor(tx as Exec, user.id);
        if (!(await this.spendFactorCode(tx as Exec, f, code)).ok) return false;
        await this.removeFactor(tx as Exec, user.id);
        await this.audit.record(
          {
            actorId: user.id,
            action: 'mfa.disable',
            targetEntity: 'user_account',
            targetId: user.id,
            metadata: { method: f.method },
          },
          tx as Exec,
        );
        return true;
      }));
    if (!done) {
      await this.attempts.record(u.username, user.id, 'mfa_failed', origin);
      throw passwordOrCodeWrong();
    }
  }

  async resetFor(actorId: string, targetId: string): Promise<{ sessionsEnded: number }> {
    if (sameId(actorId, targetId)) {
      throw AppError.validation(
        'You cannot reset your own two-factor sign-in. Ask another administrator — the reset has to be somebody else’s decision.',
      );
    }
    return this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.id, targetId))
        .limit(1);
      if (!target) throw AppError.notFound('User not found');

      const removed = await tx
        .delete(mfaFactor)
        .where(eq(mfaFactor.userId, targetId))
        .returning({ enabledAt: mfaFactor.enabledAt, method: mfaFactor.method });
      if (removed.length === 0) {
        throw AppError.conflict(ErrorCode.MFA_NOT_ENABLED, 'This account has no two-factor sign-in to reset.');
      }
      await this.removeFactor(tx as Exec, targetId);
      const sessionsEnded = await this.sessions.revokeAllFor(targetId, undefined, tx as Exec);
      const enabled = removed.find((r) => r.enabledAt !== null);
      await this.audit.record(
        {
          actorId,
          action: 'mfa.reset',
          targetEntity: 'user_account',
          targetId,
          metadata: { sessionsEnded, wasEnabled: Boolean(enabled), method: enabled?.method ?? null },
        },
        tx as Exec,
      );
      return { sessionsEnded };
    });
  }

  async issueChallenge(userId: string, identifier: string, method: MfaMethod): Promise<Challenge> {
    await this.db
      .delete(mfaChallenge)
      .where(
        and(
          eq(mfaChallenge.userId, userId),
          or(isNotNull(mfaChallenge.consumedAt), lt(mfaChallenge.expiresAt, sql`now()`)),
        ),
      );
    const challengeToken = generateToken();
    const ttl = method === 'email' ? EMAIL_CHALLENGE_TTL_MINUTES : CHALLENGE_TTL_MINUTES;
    const [row] = await this.db
      .insert(mfaChallenge)
      .values({
        userId,
        identifier: identifier.slice(0, 254),
        tokenHash: hashToken(challengeToken),
        expiresAt: sql`now() + make_interval(mins => ${ttl})`,
      })
      .returning({ expiresAt: mfaChallenge.expiresAt });
    const expiresAt = row!.expiresAt;
    if (method === 'totp') return { challengeToken, expiresAt, method };

    const locked = await this.attempts.secondFactorLockedFor(userId);
    if (locked > 0) return { challengeToken, expiresAt, method, codeSent: false, sentTo: null, resendAfterSeconds: locked };
    const request = await this.db.transaction(async (tx) => {
      await this.lockCodesOf(tx as Exec, userId);
      return this.requestCode(tx as Exec, userId, 'sign_in', 'reuse');
    });
    return {
      challengeToken,
      expiresAt,
      method,
      codeSent: request.sent,
      sentTo: request.sent ? maskEmail(request.sentTo) : null,
      resendAfterSeconds: request.resendAfterSeconds,
    };
  }

  async findChallenge(rawToken: string): Promise<{ id: string; userId: string; identifier: string } | null> {
    const [c] = await this.db
      .select({ id: mfaChallenge.id, userId: mfaChallenge.userId, identifier: mfaChallenge.identifier })
      .from(mfaChallenge)
      .where(
        and(
          eq(mfaChallenge.tokenHash, hashToken(rawToken)),
          isNull(mfaChallenge.consumedAt),
          sql`${mfaChallenge.expiresAt} > now()`,
          lt(mfaChallenge.failedAttempts, CHALLENGE_MAX_FAILURES),
        ),
      )
      .limit(1);
    return c ?? null;
  }

  async redeemChallenge(challengeId: string, proof: SecondFactorProof, origin: ClientOrigin): Promise<Redemption> {
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .select({
          userId: mfaChallenge.userId,
          failedAttempts: mfaChallenge.failedAttempts,
          consumedAt: mfaChallenge.consumedAt,
          live: sql<boolean>`${mfaChallenge.expiresAt} > now()`,
        })
        .from(mfaChallenge)
        .where(eq(mfaChallenge.id, challengeId))
        .for('update')
        .limit(1);
      if (!c || c.consumedAt || !c.live || c.failedAttempts >= CHALLENGE_MAX_FAILURES) return { status: 'expired' };

      const consume = () =>
        tx.update(mfaChallenge).set({ consumedAt: new Date() }).where(eq(mfaChallenge.id, challengeId));

      const [u] = await tx
        .select({ id: userAccount.id, role: userAccount.role, status: userAccount.status, email: userAccount.email })
        .from(userAccount)
        .where(eq(userAccount.id, c.userId))
        .limit(1);
      if (!u || (u.status !== 'active' && u.status !== 'suspended')) {
        await consume();
        return { status: 'refused' };
      }
      const [f] = await tx
        .select()
        .from(mfaFactor)
        .where(and(eq(mfaFactor.userId, c.userId), isNotNull(mfaFactor.enabledAt)))
        .limit(1);
      if (!f) {
        await consume();
        return { status: 'expired' };
      }

      let accepted: boolean;
      if ('recoveryCode' in proof) {
        accepted = await this.spendRecoveryCode(tx as Exec, c.userId, proof.recoveryCode);
      } else if (f.method === 'totp') {
        accepted = await this.spendTotp(tx as Exec, f, proof.code);
      } else {
        const spent = await this.spendEmailCode(tx as Exec, c.userId, 'sign_in', f.emailAddress, u.email, proof.code);
        if (!spent.ok) {
          const { ok: _ok, ...refusal } = spent;
          return { status: 'code_refused', refusal };
        }
        accepted = true;
      }
      if (!accepted) {
        await tx
          .update(mfaChallenge)
          .set({ failedAttempts: sql`${mfaChallenge.failedAttempts} + 1` })
          .where(eq(mfaChallenge.id, challengeId));
        return { status: 'invalid' };
      }

      await consume();
      const { rawToken, expiresAt } = await this.sessions.create(c.userId, origin, tx as Exec);
      return {
        status: 'ok',
        user: { id: u.id, role: u.role, status: u.status, mfaEnabled: true, mfaMethod: f.method },
        rawToken,
        expiresAt,
      };
    });
  }

  private async requestCode(tx: Exec, userId: string, purpose: Purpose, mode: 'reuse' | 'new'): Promise<CodeRequest> {
    const [u] = await tx
      .select({ email: userAccount.email })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u) throw AppError.notFound('Account not found');
    const [bound] = await tx
      .select({ emailAddress: mfaFactor.emailAddress })
      .from(mfaFactor)
      .where(and(eq(mfaFactor.userId, userId), eq(mfaFactor.method, 'email'), isNotNull(mfaFactor.enabledAt)))
      .limit(1);
    if (bound && bound.emailAddress !== u.email) return { sent: false, error: addressChanged(), resendAfterSeconds: 0 };

    await tx
      .delete(mfaEmailCode)
      .where(
        and(
          eq(mfaEmailCode.userId, userId),
          lt(mfaEmailCode.requestedAt, sql`now() - make_interval(hours => ${EMAIL_CODE_RETENTION_HOURS})`),
        ),
      );
    const [newest] = await tx
      .select({
        secondsAgo: sql<number>`extract(epoch FROM now() - ${mfaEmailCode.requestedAt})::float8`,
        usable: sql<boolean>`${mfaEmailCode.consumedAt} IS NULL
          AND ${mfaEmailCode.failedAttempts} < ${EMAIL_CODE_MAX_FAILURES}
          AND (${mfaEmailCode.expiresAt} IS NULL OR ${mfaEmailCode.expiresAt} > now())`,
      })
      .from(mfaEmailCode)
      .where(and(eq(mfaEmailCode.userId, userId), eq(mfaEmailCode.purpose, purpose)))
      .orderBy(desc(mfaEmailCode.requestedAt))
      .limit(1);
    if (newest && newest.secondsAgo < EMAIL_CODE_RESEND_SECONDS) {
      const wait = Math.max(1, Math.ceil(EMAIL_CODE_RESEND_SECONDS - newest.secondsAgo));
      if (mode === 'new') return { sent: false, error: tooSoon(wait), resendAfterSeconds: wait };
      if (newest.usable) return { sent: true, sentTo: u.email, resendAfterSeconds: wait };
    }

    const [hour] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        oldestSecondsAgo: sql<number | null>`extract(epoch FROM now() - min(${mfaEmailCode.requestedAt}))::float8`,
      })
      .from(mfaEmailCode)
      .where(and(eq(mfaEmailCode.userId, userId), sql`${mfaEmailCode.requestedAt} > now() - interval '1 hour'`));
    if ((hour?.n ?? 0) >= EMAIL_CODES_PER_HOUR) {
      const wait = Math.max(1, Math.ceil(3600 - Number(hour?.oldestSecondsAgo ?? 0)));
      return { sent: false, error: hourlyLimit(wait), resendAfterSeconds: wait };
    }

    await tx
      .update(mfaEmailCode)
      .set({ consumedAt: new Date() })
      .where(and(eq(mfaEmailCode.userId, userId), eq(mfaEmailCode.purpose, purpose), isNull(mfaEmailCode.consumedAt)));
    const [row] = await tx.insert(mfaEmailCode).values({ userId, purpose }).returning({ id: mfaEmailCode.id });
    await this.outbox.emit(tx, {
      aggregateType: 'mfa_email_code',
      aggregateId: row!.id,
      eventType: MFA_EMAIL_CODE_REQUESTED,
      payload: { codeId: row!.id },
    });
    return { sent: true, sentTo: u.email, resendAfterSeconds: EMAIL_CODE_RESEND_SECONDS };
  }

  private async lockCodesOf(tx: Exec, userId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mfa-email-code:${userId}`}, 0))`);
  }

  private async spendEmailCode(
    tx: Exec,
    userId: string,
    purpose: Purpose,
    boundTo: string | null,
    accountEmail: string,
    raw: string,
  ): Promise<EmailCodeSpend> {
    const [c] = await tx
      .select({
        id: mfaEmailCode.id,
        codeHash: mfaEmailCode.codeHash,
        sentTo: mfaEmailCode.sentTo,
        failedAttempts: mfaEmailCode.failedAttempts,
        live: sql<boolean>`${mfaEmailCode.expiresAt} > now()`,
      })
      .from(mfaEmailCode)
      .where(and(eq(mfaEmailCode.userId, userId), eq(mfaEmailCode.purpose, purpose), isNull(mfaEmailCode.consumedAt)))
      .orderBy(desc(mfaEmailCode.requestedAt))
      .limit(1)
      .for('update');
    if (!c) return { ok: false, reason: 'none' };
    if (!c.codeHash || !c.sentTo) return { ok: false, reason: 'not_sent' };
    if (!c.live) return { ok: false, reason: 'expired' };
    if (c.failedAttempts >= EMAIL_CODE_MAX_FAILURES) return { ok: false, reason: 'exhausted' };
    if (c.sentTo !== accountEmail || (boundTo !== null && c.sentTo !== boundTo)) {
      return { ok: false, reason: 'address_changed' };
    }

    const normal = normalizeEmailCode(raw);
    if (!normal || !emailCodeMatches(this.emailKey, c.id, normal, c.codeHash)) {
      await tx
        .update(mfaEmailCode)
        .set({ failedAttempts: sql`${mfaEmailCode.failedAttempts} + 1` })
        .where(eq(mfaEmailCode.id, c.id));
      return { ok: false, reason: 'wrong', attemptsLeft: Math.max(0, EMAIL_CODE_MAX_FAILURES - c.failedAttempts - 1) };
    }
    const spent = await tx
      .update(mfaEmailCode)
      .set({ consumedAt: new Date() })
      .where(and(eq(mfaEmailCode.id, c.id), isNull(mfaEmailCode.consumedAt)))
      .returning({ id: mfaEmailCode.id });
    if (spent.length !== 1) return { ok: false, reason: 'none' };
    return { ok: true, sentTo: c.sentTo };
  }

  private async spendFactorCode(exec: Exec, f: Factor, code: string): Promise<FactorProof> {
    if (f.method === 'totp') return { ok: await this.spendTotp(exec, f, code) };
    const [u] = await exec
      .select({ email: userAccount.email })
      .from(userAccount)
      .where(eq(userAccount.id, f.userId))
      .limit(1);
    const spent = await this.spendEmailCode(exec, f.userId, 'settings', f.emailAddress, u?.email ?? '', code);
    if (spent.ok) return { ok: true };
    const { ok: _ok, ...refusal } = spent;
    return { ok: false, refusal };
  }

  private open(f: Factor): Buffer {
    try {
      if (!f.secretCiphertext) throw new UnreadableSecretError('The factor has no secret');
      return openSecret(this.key, f.secretCiphertext, f.userId);
    } catch (e) {
      if (!(e instanceof UnreadableSecretError)) throw e;
      this.logger.error(
        `Two-factor secret of account ${f.userId} does not open (${e.message}). ` +
          'If MFA_ENCRYPTION_KEY was changed or lost, restore it; otherwise an administrator resets two-factor sign-in for the account.',
      );
      throw factorUnreadable(Boolean(f.enabledAt));
    }
  }

  private async enabledFactor(exec: Exec, userId: string): Promise<Factor> {
    const [f] = await exec
      .select()
      .from(mfaFactor)
      .where(and(eq(mfaFactor.userId, userId), isNotNull(mfaFactor.enabledAt)))
      .limit(1);
    if (!f) throw AppError.conflict(ErrorCode.MFA_NOT_ENABLED, 'Two-factor sign-in is not turned on for this account.');
    return f;
  }

  private async spendTotp(exec: Exec, f: Factor, rawCode: string): Promise<boolean> {
    const step = matchTotp(this.open(f), normalizeCode(rawCode), Date.now());
    if (step === null) return false;
    const spent = await exec
      .update(mfaFactor)
      .set({ lastUsedStep: step })
      .where(
        and(
          eq(mfaFactor.userId, f.userId),
          eq(mfaFactor.method, 'totp'),
          isNotNull(mfaFactor.enabledAt),
          or(isNull(mfaFactor.lastUsedStep), lt(mfaFactor.lastUsedStep, step)),
        ),
      )
      .returning({ userId: mfaFactor.userId });
    return spent.length === 1;
  }

  private async spendRecoveryCode(exec: Exec, userId: string, raw: string): Promise<boolean> {
    const normal = normalizeRecoveryCode(raw);
    if (!normal) return false;
    const used = await exec
      .update(mfaRecoveryCode)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(mfaRecoveryCode.userId, userId),
          eq(mfaRecoveryCode.codeHash, hashRecoveryCode(this.recoveryKey, normal)),
          isNull(mfaRecoveryCode.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCode.id });
    return used.length === 1;
  }

  private async replaceRecoveryCodes(exec: Exec, userId: string): Promise<string[]> {
    await exec.delete(mfaRecoveryCode).where(eq(mfaRecoveryCode.userId, userId));
    const codes = generateRecoveryCodes();
    await exec.insert(mfaRecoveryCode).values(
      codes.map((code) => ({
        userId,
        codeHash: hashRecoveryCode(this.recoveryKey, normalizeRecoveryCode(code)!),
      })),
    );
    return codes;
  }

  private async withdrawEmailCodes(exec: Exec, userId: string): Promise<void> {
    await exec
      .update(mfaEmailCode)
      .set({ consumedAt: new Date() })
      .where(and(eq(mfaEmailCode.userId, userId), isNull(mfaEmailCode.consumedAt)));
  }

  private async removeFactor(exec: Exec, userId: string): Promise<void> {
    await exec.delete(mfaFactor).where(eq(mfaFactor.userId, userId));
    await exec.delete(mfaRecoveryCode).where(eq(mfaRecoveryCode.userId, userId));
    await exec
      .update(mfaChallenge)
      .set({ consumedAt: new Date() })
      .where(and(eq(mfaChallenge.userId, userId), isNull(mfaChallenge.consumedAt)));
    await this.withdrawEmailCodes(exec, userId);
  }

  async spendAuthenticatorCode(exec: Exec, userId: string, code: string): Promise<boolean> {
    const f = await this.enabledFactor(exec, userId);
    if (f.method !== 'totp') return false;
    return this.spendTotp(exec, f, code);
  }

  async refuseWhileLocked(userId: string): Promise<void> {
    const wait = await this.attempts.secondFactorLockedFor(userId);
    if (wait > 0) throw this.attempts.lockedError(wait);
  }

  private async identifierOf(userId: string): Promise<string> {
    const [u] = await this.db
      .select({ username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    return u?.username ?? userId;
  }
}

function normalizeCode(code: string): string {
  return code.replace(/\s/g, '');
}

function alreadyEnabled(): AppError {
  return AppError.conflict(
    ErrorCode.MFA_ALREADY_ENABLED,
    'Two-factor sign-in is already on for this account. Turn it off first to set it up another way.',
  );
}

function methodNotAllowed(): AppError {
  return new AppError(
    ErrorCode.MFA_METHOD_NOT_ALLOWED,
    'Your role signs in with an authenticator app. Emailed codes are not offered for it.',
    HttpStatus.FORBIDDEN,
  );
}

function addressChanged(): AppError {
  return AppError.conflict(
    ErrorCode.MFA_EMAIL_ADDRESS_CHANGED,
    'The email address on this account is not the one its sign-in codes were set up for, so no code can be sent. Use a recovery code, or ask support to reset two-factor sign-in.',
  );
}

function tooSoon(seconds: number): AppError {
  return new AppError(
    ErrorCode.RATE_LIMITED,
    `A code was sent less than a minute ago. Wait ${seconds} seconds before asking for another.`,
    HttpStatus.TOO_MANY_REQUESTS,
    { retryAfterSeconds: seconds },
  );
}

function hourlyLimit(seconds: number): AppError {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return new AppError(
    ErrorCode.RATE_LIMITED,
    `${EMAIL_CODES_PER_HOUR} codes were sent in the last hour, which is as many as we send. Try again in ${minutes} minutes, or use a recovery code.`,
    HttpStatus.TOO_MANY_REQUESTS,
    { retryAfterSeconds: seconds },
  );
}

function factorUnreadable(enabled: boolean): AppError {
  return AppError.conflict(
    ErrorCode.MFA_FACTOR_UNREADABLE,
    enabled
      ? 'Your two-factor sign-in cannot be checked: its secret can no longer be read on our side, so no code will work. Ask an administrator to reset two-factor sign-in for your account, then sign in with your password and set it up again.'
      : 'This two-factor setup can no longer be read on our side. Start the setup again; that replaces it.',
  );
}

function passwordOrCodeWrong(): AppError {
  return new AppError(
    ErrorCode.MFA_CODE_INVALID,
    'The password or the code is not right. An emailed code works for ten minutes, and only the newest one does.',
    HttpStatus.BAD_REQUEST,
  );
}

export function codeInvalid(status: HttpStatus.UNAUTHORIZED | HttpStatus.BAD_REQUEST): AppError {
  return new AppError(ErrorCode.MFA_CODE_INVALID, 'That code is not right. Check the time on your phone and try the current one.', status);
}

export function emailCodeRefused(
  refusal: EmailCodeRefusal,
  status: HttpStatus.UNAUTHORIZED | HttpStatus.BAD_REQUEST,
): AppError {
  switch (refusal.reason) {
    case 'wrong':
      return new AppError(
        ErrorCode.MFA_CODE_INVALID,
        refusal.attemptsLeft > 0
          ? `That code is not right. It can be tried ${refusal.attemptsLeft} more ${refusal.attemptsLeft === 1 ? 'time' : 'times'}; use the code in the newest email from Card Embassy.`
          : 'That code is not right, and it cannot be tried again. Send a new code.',
        status,
        { attemptsLeft: refusal.attemptsLeft },
      );
    case 'not_sent':
      return new AppError(
        ErrorCode.MFA_CODE_EXPIRED,
        'Your code has not been emailed yet. Wait for the email, then enter the code in it.',
        status,
      );
    case 'exhausted':
      return new AppError(
        ErrorCode.MFA_CODE_EXPIRED,
        'This code was entered wrongly too many times. Send a new code.',
        status,
      );
    case 'address_changed':
      return new AppError(
        ErrorCode.MFA_CODE_EXPIRED,
        'This code went to an email address that is no longer on your account, so it no longer works.',
        status,
      );
    default:
      return new AppError(
        ErrorCode.MFA_CODE_EXPIRED,
        'This code has expired or was already used. Send a new code.',
        status,
      );
  }
}
