import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, boolean, uniqueIndex, index, check, bigint, integer } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

export const accountStatus = pgEnum('account_status', [
  'pending',
  'active',
  'suspended',
  'closed',
]);

export const userRole = pgEnum('user_role', ['user', 'warehouse_operator', 'admin']);

export const userAccount = pgTable(
  'user_account',
  {
    id: pkId(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: accountStatus('status').notNull().default('pending'),
    intakeId: text('intake_id'),
    role: userRole('role').notNull().default('user'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    nameReviewRequired: boolean('name_review_required').notNull().default(false),
    legacyDisplayName: text('legacy_display_name'),
    autoSuspendedAt: timestamp('auto_suspended_at', { withTimezone: true }),
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
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const loginSession = pgTable('login_session', {
  id: pkId(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
});

export const loginAttemptOutcome = pgEnum('login_attempt_outcome', [
  'success',
  'bad_credentials',
  'unverified',
  'refused',
  'mfa_challenged',
  'mfa_failed',
]);

export const loginAttempt = pgTable(
  'login_attempt',
  {
    id: pkId(),
    identifier: text('identifier').notNull(),
    userId: text('user_id'),
    outcome: loginAttemptOutcome('outcome').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTime: index('login_attempt_time_idx').on(t.occurredAt),
    byUser: index('login_attempt_user_idx').on(t.userId, t.occurredAt),
    byIdentifier: index('login_attempt_identifier_idx').on(t.identifier, t.occurredAt),
  }),
);

export const mfaFactor = pgTable('mfa_factor', {
  userId: text('user_id').primaryKey(),
  secretCiphertext: text('secret_ciphertext').notNull(),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  createdAt: createdAt(),
});

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
