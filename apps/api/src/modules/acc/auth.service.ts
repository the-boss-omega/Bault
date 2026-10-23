import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { eq, or } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { pgErrorCode } from '../../shared/errors/pg-error';
import { OneAtATime } from '../../shared/one-at-a-time';
import { userAccount } from './acc.schema';
import { isValidUsername, normalizeNamePart, normalizeUsername } from '../../shared/names';
import { VerificationService } from './verification.service';
import { SessionService, type ClientOrigin } from './session.service';
import { LoginAttemptService } from './login-attempts.service';
import { MfaService, codeInvalid, type SecondFactorProof } from './mfa/mfa.service';
import type { AuthUser } from '../sec/auth-context';
import { CURRENT_TERMS_VERSION } from './terms';

export type LoginResult =
  | { kind: 'session'; user: AuthUser; rawToken: string; expiresAt: Date }
  | { kind: 'challenge'; challengeToken: string; expiresAt: Date };

@Injectable()
export class AuthService {
  private readonly dummyHash = argon2.hash(randomBytes(32).toString('hex'));

  private readonly perIdentifier = new OneAtATime();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly verification: VerificationService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptService,
    private readonly mfa: MfaService,
  ) {}

  async register(
    email: string,
    username: string,
    password: string,
    firstName: string,
    lastName: string,
    acceptedTermsVersion: string,
  ): Promise<{
    userId: string;
    username: string;
    firstName: string;
    lastName: string;
    termsVersion: string;
    termsAcceptedAt: Date;
  }> {
    const version = acceptedTermsVersion?.trim() ?? '';
    if (version !== CURRENT_TERMS_VERSION) {
      throw AppError.validation(
        version
          ? 'The terms have changed since this page was loaded. Reload it, read the current terms and accept them to create an account.'
          : 'Accept the Terms of Service, Privacy Policy and Cookie notice to create an account.',
        { currentVersion: CURRENT_TERMS_VERSION },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = normalizeUsername(username);
    if (!isValidUsername(normalizedUsername)) {
      throw AppError.validation('Username must be 3-32 characters of letters, digits, dot, dash or underscore');
    }

    const first = normalizeNamePart(firstName);
    const last = normalizeNamePart(lastName);
    if (!first || !last) throw AppError.validation('First name and last name are both required');

    const [existing] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.email, normalizedEmail))
      .limit(1);
    if (existing) throw AppError.validation('Email is already registered');

    const [usernameTaken] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.username, normalizedUsername))
      .limit(1);
    if (usernameTaken) throw AppError.validation('Username is already taken');

    const passwordHash = await argon2.hash(password);

    let created: { id: string; termsVersion: string | null; termsAcceptedAt: Date | null } | undefined;
    try {
      [created] = await this.db
        .insert(userAccount)
        .values({
          email: normalizedEmail,
          username: normalizedUsername,
          passwordHash,
          firstName: first,
          lastName: last,
          status: 'pending',
          role: 'user',
          termsVersion: CURRENT_TERMS_VERSION,
          termsAcceptedAt: new Date(),
        })
        .returning({
          id: userAccount.id,
          termsVersion: userAccount.termsVersion,
          termsAcceptedAt: userAccount.termsAcceptedAt,
        });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.validation('Email or username is already taken');
      throw e;
    }
    if (!created?.termsVersion || !created.termsAcceptedAt) {
      throw AppError.validation('Failed to create account');
    }

    await this.verification.issueEmailVerification(created.id, normalizedEmail);
    return {
      userId: created.id,
      username: normalizedUsername,
      firstName: first,
      lastName: last,
      termsVersion: created.termsVersion,
      termsAcceptedAt: created.termsAcceptedAt,
    };
  }

  async login(identifier: string, password: string, origin: ClientOrigin = {}): Promise<LoginResult> {
    const normalized = normalizeUsername(identifier);

    return this.perIdentifier.run(normalized, () => this.attempt(normalized, password, origin));
  }

  private async attempt(normalized: string, password: string, origin: ClientOrigin): Promise<LoginResult> {
    const secondsLeft = await this.attempts.lockedFor(normalized);
    if (secondsLeft > 0) throw this.attempts.lockedError(secondsLeft);

    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(or(eq(userAccount.email, normalized), eq(userAccount.username, normalized)))
      .limit(1);

    const verified = await argon2.verify(u?.passwordHash ?? (await this.dummyHash), password);
    if (!u || !verified) {
      await this.attempts.record(normalized, u?.id ?? null, 'bad_credentials', origin);
      throw AppError.unauthenticated('Invalid credentials');
    }
    if (u.status === 'pending') {
      await this.attempts.record(normalized, u.id, 'unverified', origin);
      throw AppError.emailUnverified(
        'Your email address has not been confirmed yet. Check your inbox for the link we sent — we can send a fresh one.',
      );
    }
    if (u.status !== 'active' && u.status !== 'suspended') {
      await this.attempts.record(normalized, u.id, 'refused', origin);
      throw AppError.accountSuspended();
    }

    if (await this.mfa.isEnabled(u.id)) {
      const challenge = await this.mfa.issueChallenge(u.id, normalized);
      await this.attempts.record(normalized, u.id, 'mfa_challenged', origin);
      return { kind: 'challenge', ...challenge };
    }

    const { rawToken, expiresAt } = await this.sessions.create(u.id, origin);
    await this.attempts.record(normalized, u.id, 'success', origin);
    return { kind: 'session', user: { id: u.id, role: u.role, status: u.status, mfaEnabled: false }, rawToken, expiresAt };
  }

  async completeSecondFactor(
    challengeToken: string,
    proof: SecondFactorProof,
    origin: ClientOrigin = {},
  ): Promise<{ user: AuthUser; rawToken: string; expiresAt: Date }> {
    const challenge = await this.mfa.findChallenge(challengeToken);
    if (!challenge) throw challengeExpired();

    return this.perIdentifier.run(challenge.identifier, async () => {
      const wait = Math.max(
        await this.attempts.lockedFor(challenge.identifier),
        await this.attempts.secondFactorLockedFor(challenge.userId),
      );
      if (wait > 0) throw this.attempts.lockedError(wait);

      const result = await this.mfa.redeemChallenge(challenge.id, proof, origin);
      switch (result.status) {
        case 'ok':
          await this.attempts.record(challenge.identifier, challenge.userId, 'success', origin);
          return { user: result.user, rawToken: result.rawToken, expiresAt: result.expiresAt };
        case 'invalid':
          await this.attempts.record(challenge.identifier, challenge.userId, 'mfa_failed', origin);
          throw codeInvalid(HttpStatus.UNAUTHORIZED);
        case 'refused':
          await this.attempts.record(challenge.identifier, challenge.userId, 'refused', origin);
          throw AppError.accountSuspended();
        default:
          throw challengeExpired();
      }
    });
  }
}

function challengeExpired(): AppError {
  return new AppError(
    ErrorCode.MFA_CHALLENGE_EXPIRED,
    'This sign-in has expired or was already used. Enter your password again.',
    HttpStatus.UNAUTHORIZED,
  );
}

function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === '23505';
}
