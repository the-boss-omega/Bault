import { bigint, char, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pkId = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const amountMinor = (name = 'amount') => bigint(name, { mode: 'number' });

export const currency = (name = 'currency') => char(name, { length: 3 });
