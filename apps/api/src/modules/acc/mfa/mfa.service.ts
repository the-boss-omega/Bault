import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, count, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { toString as qrToString } from 'qrcode';
import { loadEnv } from '@bault/config';
import { DRIZZLE } from '../../../db/db.module';
import type { Database } from '../../../db/client';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCode } from '../../../shared/errors/error-codes';
import { generateToken, hashToken } from '../../../shared/tokens';
import { AuditService } from '../../sec/audit.service';
import type { AuthUser, Role } from '../../sec/auth-context';
import { mfaChallenge, mfaFactor, mfaRecoveryCode, userAccount } from '../acc.schema';
import { LoginAttemptService } from '../login-attempts.service';
import { SessionService, type ClientOrigin } from '../session.service';
import { MFA_POLICY, type MfaPolicy } from './mfa-policy';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import { UnreadableSecretError, deriveSubkey, keyFromBase64, openSecret, sealSecret } from './secret-box';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp';

const CHALLENGE_TTL_MINUTES = 5;
const CHALLENGE_MAX_FAILURES = 5;
const ISSUER = 'Bault';

export type SecondFactorProof = { code: string } | { recoveryCode: string };

export type Redemption =
  | { status: 'ok'; user: AuthUser; rawToken: string; expiresAt: Date }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'refused' };

type Exec = Database;
type Factor = typeof mfaFactor.$inferSelect;

@Injectable()
export class MfaService {
  private readonly key: Buffer;
  private readonly recoveryKey: Buffer;
  private readonly logger = new Logger('MfaService');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptService,
    private readonly audit: AuditService,
    @Inject(MFA_POLICY) private readonly policy: MfaPolicy,
  ) {
    this.key = keyFromBase64(loadEnv().MFA_ENCRYPTION_KEY);
    this.recoveryKey = deriveSubkey(this.key, 'recovery-codes');
  }

  requiredFor(role: Role): boolean {
    return this.policy.requiredRoles.includes(role);
  }

  async isEnabled(userId: string): Promise<boolean> {
    const [f] = await this.db
      .select({ enabledAt: mfaFactor.enabledAt })
      .from(mfaFactor)
      .where(eq(mfaFactor.userId, userId))
      .limit(1);
    return Boolean(f?.enabledAt);
  }

  async status(user: AuthUser) {
    const [f] = await this.db
      .select({ enabledAt: mfaFactor.enabledAt })
      .from(mfaFactor)
      .where(eq(mfaFactor.userId, user.id))
      .limit(1);
    const enabled = Boolean(f?.enabledAt);
    const [left] = await this.db
      .select({ n: count() })
      .from(mfaRecoveryCode)
      .where(and(eq(mfaRecoveryCode.userId, user.id), isNull(mfaRecoveryCode.usedAt)));
    return {
      enabled,
      pending: Boolean(f) && !enabled,
      required: this.requiredFor(user.role),
      recoveryCodesRemaining: enabled ? Number(left?.n ?? 0) : 0,
    };
  }

  async beginSetup(userId: string) {
    const [u] = await this.db
      .select({ username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u) throw AppError.notFound('Account not found');

    const secret = generateTotpSecret();
    const sealed = sealSecret(this.key, secret, userId);
    const written = await this.db
      .insert(mfaFactor)
      .values({ userId, secretCiphertext: sealed })
      .onConflictDoUpdate({
        target: mfaFactor.userId,
        set: { secretCiphertext: sealed, lastUsedStep: null, createdAt: new Date() },
        setWhere: isNull(mfaFactor.enabledAt),
      })
      .returning({ userId: mfaFactor.userId });
    if (written.length === 0) throw alreadyEnabled();

    const uri = otpauthUri({ issuer: ISSUER, account: u.username, secret });
    const svg = await qrToString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    return {
      otpauthUri: uri,
      secret: base32Encode(secret),
      qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    };
  }

  async confirmSetup(
    user: AuthUser,
    password: string,
    code: string,
    currentSessionToken: string | undefined,
    origin: ClientOrigin,
  ): Promise<{ recoveryCodes: string[]; otherSessionsEnded: number }> {
    const userId = user.id;
    await this.refuseWhileLocked(userId);
    const [u] = await this.db
      .select({ passwordHash: userAccount.passwordHash, username: userAccount.username })
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!u) throw AppError.notFound('Account not found');
    if (!(await argon2.verify(u.passwordHash, password))) {
      await this.attempts.record(u.username, userId, 'mfa_failed', origin);
      throw passwordOrCodeWrong();
    }

    return this.db.transaction(async (tx) => {
      const [f] = await tx.select().from(mfaFactor).where(eq(mfaFactor.userId, userId)).for('update').limit(1);
      if (!f) {
        throw AppError.conflict(ErrorCode.MFA_NOT_ENABLED, 'There is no two-factor setup to confirm. Start it again.');
      }
      if (f.enabledAt) throw alreadyEnabled();

      const step = matchTotp(this.open(f), normalizeCode(code), Date.now());
      if (step === null) throw passwordOrCodeWrong();

      await tx
        .update(mfaFactor)
        .set({ enabledAt: new Date(), lastUsedStep: step })
        .where(and(eq(mfaFactor.userId, userId), isNull(mfaFactor.enabledAt)));
      const recoveryCodes = await this.replaceRecoveryCodes(tx as Exec, userId);
      const otherSessionsEnded = await this.sessions.revokeAllFor(userId, currentSessionToken, tx as Exec);
      await this.audit.record(
        {
          actorId: userId,
          action: 'mfa.enable',
          targetEntity: 'user_account',
          targetId: userId,
          metadata: { otherSessionsEnded },
        },
        tx as Exec,
      );
      return { recoveryCodes, otherSessionsEnded };
    });
  }

  async regenerateRecoveryCodes(user: AuthUser, code: string, origin: ClientOrigin) {
    await this.refuseWhileLocked(user.id);
    const recoveryCodes = await this.db.transaction(async (tx) => {
      const f = await this.enabledFactor(tx as Exec, user.id);
      if (!(await this.spendTotp(tx as Exec, f, code))) return null;
      const codes = await this.replaceRecoveryCodes(tx as Exec, user.id);
      await this.audit.record(
        { actorId: user.id, action: 'mfa.recovery_codes_replaced', targetEntity: 'user_account', targetId: user.id },
        tx as Exec,
      );
      return codes;
    });
    if (!recoveryCodes) {
      await this.attempts.record(await this.identifierOf(user.id), user.id, 'mfa_failed', origin);
      throw codeInvalid(HttpStatus.BAD_REQUEST);
    }
    return { recoveryCodes };
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
        if (!(await this.spendTotp(tx as Exec, f, code))) return false;
        await this.removeFactor(tx as Exec, user.id);
        await this.audit.record(
          { actorId: user.id, action: 'mfa.disable', targetEntity: 'user_account', targetId: user.id },
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
    if (actorId === targetId) {
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
        .returning({ enabledAt: mfaFactor.enabledAt });
      if (removed.length === 0) {
        throw AppError.conflict(ErrorCode.MFA_NOT_ENABLED, 'This account has no two-factor sign-in to reset.');
      }
      await this.removeFactor(tx as Exec, targetId);
      const sessionsEnded = await this.sessions.revokeAllFor(targetId, undefined, tx as Exec);
      await this.audit.record(
        {
          actorId,
          action: 'mfa.reset',
          targetEntity: 'user_account',
          targetId,
          metadata: { sessionsEnded, wasEnabled: removed[0]!.enabledAt !== null },
        },
        tx as Exec,
      );
      return { sessionsEnded };
    });
  }

  async issueChallenge(userId: string, identifier: string): Promise<{ challengeToken: string; expiresAt: Date }> {
    await this.db
      .delete(mfaChallenge)
      .where(
        and(
          eq(mfaChallenge.userId, userId),
          or(isNotNull(mfaChallenge.consumedAt), lt(mfaChallenge.expiresAt, sql`now()`)),
        ),
      );
    const challengeToken = generateToken();
    const [row] = await this.db
      .insert(mfaChallenge)
      .values({
        userId,
        identifier: identifier.slice(0, 254),
        tokenHash: hashToken(challengeToken),
        expiresAt: sql`now() + make_interval(mins => ${CHALLENGE_TTL_MINUTES})`,
      })
      .returning({ expiresAt: mfaChallenge.expiresAt });
    return { challengeToken, expiresAt: row!.expiresAt };
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
        .select({ id: userAccount.id, role: userAccount.role, status: userAccount.status })
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

      const accepted =
        'code' in proof
          ? await this.spendTotp(tx as Exec, f, proof.code)
          : await this.spendRecoveryCode(tx as Exec, c.userId, proof.recoveryCode);
      if (!accepted) {
        await tx
          .update(mfaChallenge)
          .set({ failedAttempts: sql`${mfaChallenge.failedAttempts} + 1` })
          .where(eq(mfaChallenge.id, challengeId));
        return { status: 'invalid' };
      }

      await consume();
      const { rawToken, expiresAt } = await this.sessions.create(c.userId, origin, tx as Exec);
      return { status: 'ok', user: { id: u.id, role: u.role, status: u.status, mfaEnabled: true }, rawToken, expiresAt };
    });
  }

  private open(f: Factor): Buffer {
    try {
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

  private async removeFactor(exec: Exec, userId: string): Promise<void> {
    await exec.delete(mfaFactor).where(eq(mfaFactor.userId, userId));
    await exec.delete(mfaRecoveryCode).where(eq(mfaRecoveryCode.userId, userId));
    await exec
      .update(mfaChallenge)
      .set({ consumedAt: new Date() })
      .where(and(eq(mfaChallenge.userId, userId), isNull(mfaChallenge.consumedAt)));
  }

  private async refuseWhileLocked(userId: string): Promise<void> {
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
    'Two-factor sign-in is already on for this account. Turn it off first to set up a different authenticator.',
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
  return new AppError(ErrorCode.MFA_CODE_INVALID, 'The password or the code is not right.', HttpStatus.BAD_REQUEST);
}

export function codeInvalid(status: HttpStatus.UNAUTHORIZED | HttpStatus.BAD_REQUEST): AppError {
  return new AppError(ErrorCode.MFA_CODE_INVALID, 'That code is not right. Check the time on your phone and try the current one.', status);
}
