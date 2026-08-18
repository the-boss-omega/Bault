import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * An arrival that was addressed to a collector and did NOT become a vault item.
 *
 * Three situations produce one of these, and they are the same shape:
 *
 *   - a prohibited item turned up (glass, a lithium cell, a GPS tracker);
 *   - something arrived whose processing would cost more than it is worth;
 *   - a tracker was found riding along inside somebody's parcel.
 *
 * None of them is an item, and that is the point. Everything Bault takes into
 * custody becomes an `item` that can never be deleted — so recording a refusal
 * as an item would mean booking a thing into a vault it was never in, and then
 * inventing a lifecycle state to take it back out again. A refusal is not a
 * custody event; it is the absence of one, and it gets its own record.
 *
 * APPEND-ONLY. Registered with the guards in `0001_append_only.sql`: the
 * statement "we destroyed something addressed to you" is evidence, and evidence
 * that can be edited afterwards is not evidence. A mistake is corrected by
 * writing a second row, never by rewriting the first.
 *
 * No charge is raised for any of these. Nothing entered storage, so there is
 * nothing to bill for storing.
 */
export const arrivalDisposal = pgTable('arrival_disposal', {
  id: pkId(),
  /** Human-facing Disposal ID, DSL-XXXXXXXX. */
  code: text('code').notNull(),
  /** The collector it was addressed to. */
  ownerId: text('owner_id').notNull(),
  /** A key from `DISPOSAL_CATEGORIES` — why it could not be accepted. */
  category: text('category').notNull(),
  /** A key from `DISPOSAL_OUTCOMES` — what physically happened to it. */
  outcome: text('outcome').notNull(),
  /** What the thing was, in the operator's words. Required. */
  description: text('description').notNull(),
  /** The operator's account of the decision. Required — see DisposalService. */
  notes: text('notes').notNull(),
  /** The operator who made the call. */
  actorId: text('actor_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
