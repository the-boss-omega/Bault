import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { eq, or } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from './acc.schema';
import { isValidUsername, normalizeNamePart, normalizeUsername } from '../../shared/names';
import { VerificationService } from './verification.service';
import { SessionService } from './session.service';
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
@Injectable()
export class AuthService {
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
  ): Promise<{ user: AuthUser; rawToken: string; expiresAt: Date }> {
    // Same normalization as registration, so a username typed in any casing
    // resolves to the row that was stored (Requirement: usernames normalized
    // consistently).
    const normalized = normalizeUsername(identifier);
    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(or(eq(userAccount.email, normalized), eq(userAccount.username, normalized)))
      .limit(1);

    // Same error whether the account is unknown or the password is wrong (no user enumeration).
    if (!u || !(await argon2.verify(u.passwordHash, password))) {
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
    if (u.status === 'closed') throw AppError.accountSuspended();
    if (u.status !== 'active' && u.status !== 'suspended') throw AppError.accountSuspended();

    const { rawToken, expiresAt } = await this.sessions.create(u.id);
    return { user: { id: u.id, role: u.role, status: u.status }, rawToken, expiresAt };
  }

}

/** Postgres reports a violated UNIQUE index as SQLSTATE 23505. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
