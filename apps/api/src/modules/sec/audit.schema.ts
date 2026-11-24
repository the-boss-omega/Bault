import { pgTable, text, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';

export const auditRecord = pgTable('audit_record', {
  id: pkId(),
  actorId: uuid('actor_id').references(() => userAccount.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  targetEntity: text('target_entity'),
  targetId: text('target_id'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
