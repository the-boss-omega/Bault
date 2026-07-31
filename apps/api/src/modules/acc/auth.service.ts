import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { eq, or } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { userAccount } from './acc.schema';
import { generateIntakeId } from './intake-id';
import { VerificationService } from './verification.service';
import { SessionService } from './session.service';
import type { AuthUser } from '../sec/auth-context';

/**
 * Registration + login (T029, Principle IX/X).
 *
 * Registration: hash the password with argon2, record the caller's chosen
 * USERNAME (immutable from this point on — Requirement 4.1), assign a UNIQUE
 * intake ID, create the account in `pending` status, and email a verification link.
 * Login: verify credentials, block non-active accounts, mint a session.
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
  ): Promise<{ userId: string; intakeId: string; username: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();

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
    const intakeId = await this.allocateIntakeId();

    // This is the ONLY write of `username` anywhere in the platform (Req 4.1).
    const [created] = await this.db
      .insert(userAccount)
      .values({
        email: normalizedEmail,
        username: normalizedUsername,
        passwordHash,
        intakeId,
        status: 'pending',
        role: 'user',
      })
      .returning({ id: userAccount.id });
    if (!created) throw AppError.validation('Failed to create account');

    await this.verification.issueEmailVerification(created.id, normalizedEmail);
    return { userId: created.id, intakeId, username: normalizedUsername };
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
    const normalized = identifier.trim().toLowerCase();
    const [u] = await this.db
      .select()
      .from(userAccount)
      .where(or(eq(userAccount.email, normalized), eq(userAccount.username, normalized)))
      .limit(1);

    // Same error whether the account is unknown or the password is wrong (no user enumeration).
    if (!u || !(await argon2.verify(u.passwordHash, password))) {
      throw AppError.unauthenticated('Invalid credentials');
    }
    if (u.status === 'pending') throw AppError.forbidden('Verify your email before signing in');
    if (u.status !== 'active') throw AppError.accountSuspended();

    const { rawToken, expiresAt } = await this.sessions.create(u.id);
    return { user: { id: u.id, role: u.role, status: u.status }, rawToken, expiresAt };
  }

  /** Generate a free intake ID (retry on the rare collision before insert). */
  private async allocateIntakeId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateIntakeId();
      const [taken] = await this.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.intakeId, candidate))
        .limit(1);
      if (!taken) return candidate;
    }
    throw AppError.validation('Could not allocate a unique intake ID; retry');
  }
}
