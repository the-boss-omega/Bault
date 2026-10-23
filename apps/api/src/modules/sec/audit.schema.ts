import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

export const auditRecord = pgTable('audit_record', {
  id: pkId(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetEntity: text('target_entity'),
  targetId: text('target_id'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
