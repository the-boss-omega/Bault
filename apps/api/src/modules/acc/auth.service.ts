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

/**
 * What a right password gets: a session, or — for an account with two-factor
 * sign-in — a challenge that the second step turns into one.
 */
export type LoginResult =
  | { kind: 'session'; user: AuthUser; rawToken: string; expiresAt: Date }
  | { kind: 'challenge'; challengeToken: string; expiresAt: Date };

/**
 * Registration + login (T029, Principle IX/X).
 *
 * Registration: hash the password with argon2, record the caller's chosen
 * USERNAME (immutable from this point on — Requirement 4.1) plus their first and
 * last name, create the account in `pending` status, and email a verification
 * link. Login: verify credentials, block non-active accounts, mint a session.
 *
 * No intake ID is allocated any more. The username IS the customer-facing
 * identifier now, so a second routing code would be a second thing to keep
 * unique, print, and explain. Existing accounts keep the one they were given.
 */
/*
 * The per-identifier lockout — ten failures in fifteen minutes shut the typed
 * identifier out for fifteen — lives in `LoginAttemptService` now, beside the
 * log it reads, because wrong second-factor codes count against it too.
 */

@Injectable()
export class AuthService {
  /**
   * What an identifier that matches nobody is verified against (E13).
   *
   * Minted once per process by the same `argon2.hash` call registration uses,
   * so it carries the same cost parameters as every real hash and can never
   * drift from them — a hand-pasted constant would silently go stale the day
   * somebody raised the cost. The password it hashes is random and thrown
   * away, so nothing can match it.
   */
  private readonly dummyHash = argon2.hash(randomBytes(32).toString('hex'));

  /** Sign-ins for one identifier run one at a time; see `login`. */
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
    /**
     * Consent first, before anything is looked up or hashed.
     *
     * An account used to be created without anybody being asked to agree to the
     * fees, the interest on a negative balance or the suspension rule — there
     * was nothing to agree to. Now there is, and agreeing to an OLDER text is
     * not agreeing to this one: a sign-up page left open across a change of
     * terms sends the version it showed, and recording that as consent to the
     * current version would be recording something that did not happen. The
     * page is told which version is in force so it can show it and ask again.
     */
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
    // Normalized ONCE, here, so the unique index below is an index over exactly
    // the values a person can type: "Red", " red " and "RED" are one account.
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

    // This is the ONLY write of `username` anywhere in the platform (Req 4.1).
    // The pre-check above is a friendly error; the unique index is the guarantee,
    // so a concurrent duplicate still fails rather than slipping through.
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
          // Written in the same INSERT as the account, so there is no instant at
          // which an account exists without the record of what it agreed to.
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

  /**
   * `identifier` is EITHER the email or the username — one is enough, callers
   * never send both. Usernames may not contain '@' (RegisterDto) and both columns
   * are unique, so a single OR lookup resolves unambiguously.
   */
  async login(identifier: string, password: string, origin: ClientOrigin = {}): Promise<LoginResult> {
    // Same normalization as registration, so a username typed in any casing
    // resolves to the row that was stored (Requirement: usernames normalized
    // consistently).
    const normalized = normalizeUsername(identifier);

    /**
     * One attempt at a time per identifier.
     *
     * The lockout below reads "how many failures so far" and then verifies. Run
     * side by side, twenty guesses fired at once all read nine-or-fewer before
     * any of them had written its failure, and all twenty were checked — the
     * limit held only for an attacker polite enough to wait for each answer.
     */
    return this.perIdentifier.run(normalized, () => this.attempt(normalized, password, origin));
  }

  private async attempt(normalized: string, password: string, origin: ClientOrigin): Promise<LoginResult> {
    /**
     * Ten failures in fifteen minutes shut the identifier out for fifteen.
     *
     * Asked BEFORE the password is looked at, so the right password is refused
     * too while the lock stands — otherwise the lock would be a signal ("the
     * attempt that worked") rather than a stop.
     *
     * Keyed on what was TYPED, not on the account it resolves to. An identifier
     * nobody owns therefore locks exactly like a real one, with the same words,
     * and the lockout cannot be used to ask whether an account exists. The cost
     * is that an account's email and username are counted separately.
     *
     * Refusals during the lock are not recorded: they are not guesses that were
     * checked, and an attacker hammering a locked identifier should not be able
     * to fill the log or extend anyone's lock.
     */
    const secondsLeft = await this.attempts.lockedFor(normalized);
    if (secondsLeft > 0) throw this.attempts.lockedError(secondsLeft);

    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(or(eq(userAccount.email, normalized), eq(userAccount.username, normalized)))
      .limit(1);

    /**
     * Same error whether the account is unknown or the password is wrong — and
     * now the same TIME (E13).
     *
     * The message was always identical; the work was not. An unknown identifier
     * skipped `argon2.verify` and came back in a few milliseconds, a known one
     * in a couple of hundred, so a stopwatch enumerated every account. Both now
     * pay for exactly one verification. Recorded either way — the log says
     * which, the response does not.
     */
    const verified = await argon2.verify(u?.passwordHash ?? (await this.dummyHash), password);
    if (!u || !verified) {
      await this.attempts.record(normalized, u?.id ?? null, 'bad_credentials', origin);
      throw AppError.unauthenticated('Invalid credentials');
    }
    /**
     * The password was right. The address was never confirmed.
     *
     * This is the one refusal at sign-in that the person can resolve themselves,
     * and the sign-in page had nothing to offer them: it printed the sentence
     * and left them with "Forgot password", which does not help, and "Sign up",
     * which reports the address as already registered. Somebody who signed up a
     * week ago and lost the mail could not get in by any route in the product,
     * even though `POST /auth/verify-email/resend` existed the whole time.
     */
    if (u.status === 'pending') {
      await this.attempts.record(normalized, u.id, 'unverified', origin);
      throw AppError.emailUnverified(
        'Your email address has not been confirmed yet. Check your inbox for the link we sent — we can send a fresh one.',
      );
    }
    /**
     * A SUSPENDED account may still authenticate. That is a change, and a
     * deliberate one.
     *
     * Suspension used to refuse sign-in outright, which was coherent while it
     * was only ever an administrator's decision. It stopped being coherent when
     * the debt sweep began imposing it automatically: a holder suspended for
     * owing $20 cannot sign in, therefore cannot cash in, therefore cannot clear
     * the debt that suspended them. The lock had no key on the inside.
     *
     * Authentication now succeeds and AUTHORIZATION does the work instead:
     * `SessionAuthGuard` refuses every route except those marked
     * `@AllowSuspended()`, which is the helpdesk and the profile probe the shell
     * needs to render at all. The account is still entirely unusable — it can
     * only explain itself and read the answer.
     *
     * `closed` remains a hard refusal: that state is terminal.
     */
    if (u.status !== 'active' && u.status !== 'suspended') {
      // `closed` and anything unrecognised: the password was right, the door stays shut.
      await this.attempts.record(normalized, u.id, 'refused', origin);
      throw AppError.accountSuspended();
    }

    /**
     * The password was right; for an enrolled account that is half of it.
     *
     * No session — a challenge, good for five minutes, for this account, once.
     * Only here, after every refusal above has had its turn, so the answer to a
     * WRONG password is exactly what it always was and says nothing about
     * whether the account has a second factor; only somebody who knows the
     * password learns that. Logged as its own outcome: a right password
     * followed by wrong codes is the pattern an administrator most needs to see.
     */
    if (await this.mfa.isEnabled(u.id)) {
      const challenge = await this.mfa.issueChallenge(u.id, normalized);
      await this.attempts.record(normalized, u.id, 'mfa_challenged', origin);
      return { kind: 'challenge', ...challenge };
    }

    const { rawToken, expiresAt } = await this.sessions.create(u.id, origin);
    await this.attempts.record(normalized, u.id, 'success', origin);
    return { kind: 'session', user: { id: u.id, role: u.role, status: u.status, mfaEnabled: false }, rawToken, expiresAt };
  }

  /**
   * The second step: a challenge from the first, and a code from the app or a
   * recovery code. A session, or a refusal.
   *
   * Under the same one-at-a-time queue as the first step, keyed on the
   * identifier the challenge was issued for, so a burst of guesses is counted
   * one by one exactly like a burst of passwords. Both locks are asked first:
   * the identifier's (wrong passwords and wrong codes) and the account's (wrong
   * codes through any identifier or signed-in route). A wrong code is logged
   * against both. An unknown, used, expired or burned challenge is one answer —
   * start again with the password — and is not a guess, so it is not counted.
   */
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

/** The second step has nothing to answer: start again with the password. */
function challengeExpired(): AppError {
  return new AppError(
    ErrorCode.MFA_CHALLENGE_EXPIRED,
    'This sign-in has expired or was already used. Enter your password again.',
    HttpStatus.UNAUTHORIZED,
  );
}

/**
 * Postgres reports a violated UNIQUE index as SQLSTATE 23505. Read through
 * `pgErrorCode`, because a newer drizzle wraps the driver's error and keeps the
 * code on its `cause`.
 */
function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === '23505';
}
