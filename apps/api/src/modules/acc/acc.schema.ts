import { pgEnum, pgTable, text, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * ACC tables (User Account, Verification Token, Login Session).
 *
 * The item/lifecycle/money tables reference `userAccount.id` as the single owner
 * (Principle I). PII columns (email, profile) are exposed to admins only at the
 * serialization boundary (Principle IX) — the DB stores them normally.
 *
 * Identity, after the identity pass:
 *  - `id` is the immutable internal primary key. It is what every other table
 *    references and what audit records name; it is never a customer-facing id.
 *  - `username` is the permanent, unique, CUSTOMER-FACING identifier. It has a
 *    unique index, a lower-case CHECK constraint, and a DB trigger that rejects
 *    any UPDATE of the column — so it cannot be reassigned even by a bug.
 *  - `firstName` / `lastName` replaced the old free-text `displayName`. The
 *    former column survives as `legacyDisplayName` for historical reference and
 *    is never written again.
 *  - `intakeId` is retired from every user-facing workflow. It stays, nullable,
 *    because existing rows, audit trails and printed package labels still carry
 *    it; new accounts simply do not get one.
 */

export const accountStatus = pgEnum('account_status', [
  'pending', // created, email not yet verified
  'active',
  'suspended', // blocked from sign-in & all actions
  'closed', // blocked from sign-in & all actions (terminal)
]);

export const userRole = pgEnum('user_role', ['user', 'warehouse_operator', 'admin']);

export const userAccount = pgTable(
  'user_account',
  {
    id: pkId(),
    email: text('email').notNull(),
    // IMMUTABLE (Requirement 4.1): chosen once at registration, never editable.
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
     * It exists to keep the two kinds of suspension apart. An administrator's
     * suspension is a human judgement and must survive the balance recovering;
     * a debt suspension is a consequence of a number and must not. Only the
     * sweep writes this column, and it only ever reinstates accounts it can see
     * it suspended itself.
     */
    autoSuspendedAt: timestamp('auto_suspended_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    emailUnique: uniqueIndex('user_account_email_unique').on(t.email),
    usernameUnique: uniqueIndex('user_account_username_unique').on(t.username),
    intakeIdUnique: uniqueIndex('user_account_intake_id_unique').on(t.intakeId),
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
  createdAt: createdAt(),
});
