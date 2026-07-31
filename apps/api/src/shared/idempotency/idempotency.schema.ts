import { pgTable, text, jsonb, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * Idempotency keys (T016). Payment-affecting and trade endpoints require a
 * client-supplied `Idempotency-Key`. The first request stores its response here;
 * replays return the stored response WITHOUT re-executing (Principle V — safe
 * retries of irreversible operations).
 */
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
    // A key is unique per endpoint so the same key can't be replayed against a different action.
    idempotencyKeyUnique: uniqueIndex('idempotency_key_endpoint_unique').on(t.key, t.endpoint),
  }),
);
