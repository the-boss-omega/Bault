import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, boolean, uniqueIndex, index, check, bigint, integer } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * ACC tables (User Account, Verification Token, Login Session).
 *
 * The item/lifecycle/money tables reference `userAccount.id` as the single owner
 * (Principle I). The DB stores PII columns (email, profile) normally; Principle
 * IX applies at the serialization boundary.
 *
 * Identity:
 *  - `id` is the immutable internal primary key. It is what every other table
 *    references and what audit records name; it is never a customer-facing id.
 *  - `username` is the permanent, unique, CUSTOMER-FACING identifier. It has a
 *    unique index, a lower-case CHECK constraint, and a DB trigger that rejects
 *    any UPDATE of the column, so it cannot be reassigned even by a bug.
 *  - `firstName` / `lastName` are the name. The old free-text display name
 *    survives as `legacyDisplayName` for historical reference and is never
 *    written.
 *  - `intakeId` is retired from every user-facing workflow. It stays, nullable,
 *    because existing rows, audit trails and printed package labels still carry
 *    it; new accounts do not get one.
 */

export const accountStatus = pgEnum('account_status', [
  'pending', // created, email not yet verified
  'active',
  'suspended', // may sign in, but reaches only `@AllowSuspended()` routes
  'closed', // blocked from sign-in & all actions (terminal)
]);

export const userRole = pgEnum('user_role', ['user', 'warehouse_operator', 'admin']);

export const userAccount = pgTable(
  'user_account',
  {
    id: pkId(),
    email: text('email').notNull(),
    // IMMUTABLE: chosen once at registration, never editable.
    // No service or endpoint writes this column after the INSERT in AuthService,
    // and `user_account_username_immutable` rejects it at the database if one ever does.
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(), // argon2 hash (never plaintext)
    status: accountStatus('status').notNull().default('pending'),
    // RETIRED from user-facing workflows; nullable so new accounts never get one.
    // Kept for historical rows, audit trails and pre-existing package labels.
    intakeId: text('intake_id'),
    role: userRole('role').notNull().default('user'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    // Set by migration 0004 when the legacy display name could not be split into
    // first + last without guessing. Surfaced to admins; never blocks sign-in.
    nameReviewRequired: boolean('name_review_required').notNull().default(false),
    // The retired free-text display name. Read-only history: nothing writes it.
    legacyDisplayName: text('legacy_display_name'),
    /**
     * Set when the WALLET DEBT SWEEP suspended this account, and cleared when the
     * same sweep lifts that suspension after the debt clears.
     *
     * It keeps the two kinds of suspension apart. An administrator's suspension
     * is a human judgement and must survive the balance recovering; a debt
     * suspension is a consequence of a number and must not. Only the sweep sets
     * this column, and it only ever reinstates accounts it can see it suspended
     * itself. Any status an administrator sets clears it (`AdmService.updateUser`).
     */
    autoSuspendedAt: timestamp('auto_suspended_at', { withTimezone: true }),
    /**
     * Which version of the Terms of Service, Privacy Policy and Cookie notice
     * this person accepted at registration, and when (migration 0033).
     *
     * Written once, by `AuthService.register`, from the version the sign-up
     * page showed, and only if that is the version in force. NULL on every
     * account created before there was anything to accept: back-filling one
     * would invent a consent nobody gave. `user_account_terms_acceptance_complete`
     * keeps the pair together, so a version never exists without its moment.
     */
    termsVersion: text('terms_version'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    emailUnique: uniqueIndex('user_account_email_unique').on(t.email),
    usernameUnique: uniqueIndex('user_account_username_unique').on(t.username),
    intakeIdUnique: uniqueIndex('user_account_intake_id_unique').on(t.intakeId),
    termsAcceptanceComplete: check(
      'user_account_terms_acceptance_complete',
      sql`(${t.termsVersion} IS NULL) = (${t.termsAcceptedAt} IS NULL)`,
    ),
  }),
);

export const verificationTokenType = pgEnum('verification_token_type', [
  'email_verification',
  'password_reset',
]);

export const verificationToken = pgTable('verification_token', {
  id: pkId(),
  userId: text('user_id').notNull(),
  type: verificationTokenType('type').notNull(),
  // Only the HASH of the token is stored; the raw token lives only in the emailed link.
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }), // set on first use → single-use
  createdAt: createdAt(),
});

export const loginSession = pgTable('login_session', {
  id: pkId(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(), // hash of the httpOnly session cookie value
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }), // set on sign-out
  /**
   * Where the session was opened from, and on what, so "was that me?" has an
   * answer. The IP is the real client address: the API trusts only the
   * configured proxy hops in front of it (`TRUST_PROXY`, see `main.ts`), so
   * behind the tunnel it is the visitor, not 127.0.0.1.
   */
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
});

/**
 * Every sign-in attempt, successful or not.
 *
 * The audit interceptor only records requests that SUCCEED, so this is the one
 * place both outcomes land, with the address and the device, in the order they
 * happened.
 *
 * Append-only (it is on the guard list in `0001_append_only.sql`): a log of who
 * tried to get in that could be edited afterwards is not a log.
 *
 * `identifier` is what was TYPED, normalised, so a burst of attempts against an
 * address that does not exist is visible too. The password is never stored, in
 * any form.
 */
export const loginAttemptOutcome = pgEnum('login_attempt_outcome', [
  'success',
  'bad_credentials',
  'unverified',
  'refused',
  /**
   * The password was right and a second factor was asked for. Not a success
   * (no session exists yet) and not a failure, but it means whoever typed it
   * knows the password, which an administrator needs to see when the next row
   * is a string of wrong codes.
   */
  'mfa_challenged',
  /** A wrong or reused second-factor code. Counted by the lockout like a wrong password. */
  'mfa_failed',
]);

export const loginAttempt = pgTable(
  'login_attempt',
  {
    id: pkId(),
    identifier: text('identifier').notNull(),
    /** The account it resolved to, when it resolved to one. */
    userId: text('user_id'),
    outcome: loginAttemptOutcome('outcome').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTime: index('login_attempt_time_idx').on(t.occurredAt),
    byUser: index('login_attempt_user_idx').on(t.userId, t.occurredAt),
    /**
     * The sign-in lockout's question (the last ten failures for THIS typed
     * identifier), asked on every attempt. It names no outcome, so it serves
     * both wrong passwords and wrong codes (migration 0035 explains why it
     * cannot be partial on the newer value).
     */
    byIdentifier: index('login_attempt_identifier_idx').on(t.identifier, t.occurredAt),
  }),
);

/**
 * Two-factor sign-in (migration 0035).
 *
 * One TOTP authenticator per account. `secretCiphertext` is AES-256-GCM under
 * MFA_ENCRYPTION_KEY with the account id as authenticated data (see
 * `mfa/secret-box.ts`), never the secret. `enabledAt` is NULL while a setup
 * waits for its first code. `lastUsedStep` is the newest time step accepted;
 * only a later one is, and the comparison is in the UPDATE that records it.
 */
export const mfaFactor = pgTable('mfa_factor', {
  userId: text('user_id').primaryKey(),
  secretCiphertext: text('secret_ciphertext').notNull(),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  createdAt: createdAt(),
});

/** Single-use recovery codes, as HMACs. `usedAt` is set once, conditionally. */
export const mfaRecoveryCode = pgTable(
  'mfa_recovery_code',
  {
    id: pkId(),
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    userHashUnique: uniqueIndex('mfa_recovery_code_user_hash_unique').on(t.userId, t.codeHash),
  }),
);

/**
 * What a right password earns an enrolled account: a five-minute, single-use,
 * account-bound token for the second step. Only its hash is stored.
 * `identifier` is what was typed at the first step; wrong codes are counted
 * against it by the lockout.
 */
export const mfaChallenge = pgTable(
  'mfa_challenge',
  {
    id: pkId(),
    userId: text('user_id').notNull(),
    identifier: text('identifier').notNull(),
    tokenHash: text('token_hash').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    tokenUnique: uniqueIndex('mfa_challenge_token_unique').on(t.tokenHash),
    byUser: index('mfa_challenge_user_idx').on(t.userId),
  }),
);
