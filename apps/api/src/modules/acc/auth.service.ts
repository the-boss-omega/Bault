import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { eq, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { pgErrorCode } from '../../shared/errors/pg-error';
import { OneAtATime } from '../../shared/one-at-a-time';
import { loginAttempt, userAccount } from './acc.schema';
import { isValidUsername, normalizeNamePart, normalizeUsername } from '../../shared/names';
import { VerificationService } from './verification.service';
import { SessionService, clampUserAgent, type ClientOrigin } from './session.service';
import type { AuthUser } from '../sec/auth-context';

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
/**
 * The per-identifier lockout: this many failures inside `LOCKOUT_WINDOW_MIN`
 * shut that identifier out for `LOCKOUT_MIN`, whatever password comes next.
 *
 * The per-IP rate limit was the only brake, and it brakes a person, not an
 * attacker: anybody with a second address could go on guessing at one account
 * indefinitely. Ten is far past a forgotten password and a mistyped one.
 */
const LOCKOUT_FAILURES = 10;
const LOCKOUT_WINDOW_MIN = 15;
const LOCKOUT_MIN = 15;

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
  ) {}

  async register(
    email: string,
    username: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<{ userId: string; username: string; firstName: string; lastName: string }> {
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
    let created: { id: string } | undefined;
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
        })
        .returning({ id: userAccount.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.validation('Email or username is already taken');
      throw e;
    }
    if (!created) throw AppError.validation('Failed to create account');

    await this.verification.issueEmailVerification(created.id, normalizedEmail);
    return { userId: created.id, username: normalizedUsername, firstName: first, lastName: last };
  }

  /**
   * `identifier` is EITHER the email or the username — one is enough, callers
   * never send both. Usernames may not contain '@' (RegisterDto) and both columns
   * are unique, so a single OR lookup resolves unambiguously.
   */
  async login(
    identifier: string,
    password: string,
    origin: ClientOrigin = {},
  ): Promise<{ user: AuthUser; rawToken: string; expiresAt: Date }> {
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

  private async attempt(
    normalized: string,
    password: string,
    origin: ClientOrigin,
  ): Promise<{ user: AuthUser; rawToken: string; expiresAt: Date }> {
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
    const secondsLeft = await this.lockedFor(normalized);
    if (secondsLeft > 0) {
      const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        `Too many failed sign-ins for this email or username. Try again in ${minutes} minutes, or reset your password.`,
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: secondsLeft },
      );
    }

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
      await this.recordAttempt(normalized, u?.id ?? null, 'bad_credentials', origin);
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
      await this.recordAttempt(normalized, u.id, 'unverified', origin);
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
      await this.recordAttempt(normalized, u.id, 'refused', origin);
      throw AppError.accountSuspended();
    }

    const { rawToken, expiresAt } = await this.sessions.create(u.id, origin);
    await this.recordAttempt(normalized, u.id, 'success', origin);
    return { user: { id: u.id, role: u.role, status: u.status }, rawToken, expiresAt };
  }

  /**
   * Seconds until this identifier may try again, or 0.
   *
   * Locked when its last `LOCKOUT_FAILURES` failures all fall within
   * `LOCKOUT_WINDOW_MIN` of each other and the newest of them is under
   * `LOCKOUT_MIN` old. Because refusals during a lock write nothing, that newest
   * failure is the one that tripped it, so the lock lasts exactly `LOCKOUT_MIN`
   * from there. Decided by the database's clock — the one that stamped the
   * attempts — so a skewed API host cannot shorten it.
   */
  private async lockedFor(normalized: string): Promise<number> {
    const identifier = normalized.slice(0, 254); // as `recordAttempt` stores it
    const result = await this.db.execute<{ seconds_left: number }>(sql`
      SELECT ceil(extract(epoch FROM (max(occurred_at) + make_interval(mins => ${LOCKOUT_MIN}) - now())))::int AS seconds_left
        FROM (
          SELECT occurred_at FROM login_attempt
           WHERE identifier = ${identifier}
             AND outcome = 'bad_credentials'
             AND occurred_at > now() - make_interval(mins => ${LOCKOUT_WINDOW_MIN + LOCKOUT_MIN})
           ORDER BY occurred_at DESC
           LIMIT ${LOCKOUT_FAILURES}
        ) recent
      HAVING count(*) >= ${LOCKOUT_FAILURES}
         AND max(occurred_at) - min(occurred_at) <= make_interval(mins => ${LOCKOUT_WINDOW_MIN})
         AND max(occurred_at) > now() - make_interval(mins => ${LOCKOUT_MIN})`);
    return Math.max(0, Number(result.rows[0]?.seconds_left ?? 0));
  }

  /**
   * One row per sign-in attempt, in `login_attempt`.
   *
   * Never allowed to break sign-in: if the log cannot be written the person
   * still gets the answer they were owed, and the failure is logged instead. A
   * security log that can lock everybody out when the disk is full is a denial
   * of service with good intentions.
   */
  private async recordAttempt(
    identifier: string,
    userId: string | null,
    outcome: 'success' | 'bad_credentials' | 'unverified' | 'refused',
    origin: ClientOrigin,
  ): Promise<void> {
    try {
      await this.db.insert(loginAttempt).values({
        identifier: identifier.slice(0, 254),
        userId,
        outcome,
        ip: origin.ip ?? null,
        userAgent: clampUserAgent(origin.userAgent),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[auth] could not record a sign-in attempt', e);
    }
  }
}

/**
 * Postgres reports a violated UNIQUE index as SQLSTATE 23505. Read through
 * `pgErrorCode`, because a newer drizzle wraps the driver's error and keeps the
 * code on its `cause`.
 */
function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === '23505';
}
