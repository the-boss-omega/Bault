import { bigint, char, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Shared column builders (T010).
 *
 * Each helper RETURNS A FRESH builder so the same definition can be reused across
 * many tables without sharing mutable builder state. Conventions enforced here:
 *  - UUID primary keys (`pkId`)
 *  - UTC `timestamptz` audit columns (`createdAt`/`updatedAt`)
 *  - Money as INTEGER MINOR UNITS (`amountMinor`) + explicit ISO-4217 `currency`
 *    (Constitution: monetary amounts are integers in minor units, never floats).
 */
export const pkId = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Amount in the currency's smallest unit (USD cents). */
export const amountMinor = (name = 'amount') => bigint(name, { mode: 'number' });

/** ISO-4217 currency code, fixed 3 chars. */
export const currency = (name = 'currency') => char(name, { length: 3 });
