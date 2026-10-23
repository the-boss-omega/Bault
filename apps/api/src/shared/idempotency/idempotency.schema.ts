import { pgTable, text, jsonb, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    id: pkId(),
    key: text('key').notNull(),
    userId: text('user_id'),
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
