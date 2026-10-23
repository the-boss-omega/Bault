import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

export const confirmationToken = pgTable('confirmation_token', {
  id: pkId(),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  tokenHash: text('token_hash').notNull(),
  payload: jsonb('payload'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: createdAt(),
});
