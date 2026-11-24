import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';

export const arrivalDisposal = pgTable('arrival_disposal', {
  id: pkId(),
  code: text('code').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  category: text('category').notNull(),
  outcome: text('outcome').notNull(),
  description: text('description').notNull(),
  notes: text('notes').notNull(),
  actorId: uuid('actor_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
