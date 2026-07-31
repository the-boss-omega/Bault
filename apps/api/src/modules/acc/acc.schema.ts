import { pgEnum, pgTable, text, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * ACC tables (User Account, Verification Token, Login Session).
 *
 * The item/lifecycle/money tables reference `userAccount.id` as the single owner
 * (Principle I). PII columns (email, profile) are exposed to admins only at the
 * serialization boundary (Principle IX) — the DB stores them normally.
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
    // No service or endpoint writes this column after the INSERT in AuthService.
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(), // argon2 hash (never plaintext)
    status: accountStatus('status').notNull().default('pending'),
    // Unique routing code assigned at registration; inbound packages are addressed by it.
    intakeId: text('intake_id').notNull(),
    role: userRole('role').notNull().default('user'),
    displayName: text('display_name'),
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
