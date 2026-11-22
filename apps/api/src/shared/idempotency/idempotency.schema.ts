import { pgTable, text, jsonb, integer, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';
import { userAccount } from '../../modules/acc/acc.schema';

export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    id: pkId(),
    key: text('key').notNull(),
    userId: uuid('user_id').references(() => userAccount.id, { onDelete: 'restrict' }),
    endpoint: text('endpoint').notNull(),
    statusCode: integer('status_code'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    idempotencyKeyUnique: uniqueIndex('idempotency_key_endpoint_unique').on(t.key, t.endpoint),
  }),
);
