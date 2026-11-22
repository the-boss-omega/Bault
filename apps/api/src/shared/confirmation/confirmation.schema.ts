import { pgTable, text, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';
import { userAccount } from '../../modules/acc/acc.schema';

export const confirmationToken = pgTable('confirmation_token', {
  id: pkId(),
  userId: uuid('user_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  tokenHash: text('token_hash').notNull(),
  payload: jsonb('payload'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: createdAt(),
});
