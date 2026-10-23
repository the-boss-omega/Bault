import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

export const arrivalDisposal = pgTable('arrival_disposal', {
  id: pkId(),
  code: text('code').notNull(),
  ownerId: text('owner_id').notNull(),
  category: text('category').notNull(),
  outcome: text('outcome').notNull(),
  description: text('description').notNull(),
  notes: text('notes').notNull(),
  actorId: text('actor_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
