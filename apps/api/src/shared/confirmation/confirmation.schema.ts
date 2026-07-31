import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * Two-step confirmation tokens (T017). Irreversible actions — withdrawal, donation,
 * ownership transfer, listing removal — first return a short-lived confirmation
 * token; the action executes only when that token is presented back (Principle VII).
 */
export const confirmationToken = pgTable('confirmation_token', {
  id: pkId(),
  userId: text('user_id').notNull(),
  action: text('action').notNull(), // e.g. "withdrawal", "donation"
  tokenHash: text('token_hash').notNull(),
  payload: jsonb('payload'), // the pending action's parameters
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: createdAt(),
});
