import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../db/schema/_helpers';

/**
 * Audit Record (SEC) — APPEND-ONLY (Principle II, enforced in 0001_append_only.sql).
 * One row per state-changing request: actor, action, target, timestamp (Principle:
 * every action that changes system state is written to an immutable audit log).
 */
export const auditRecord = pgTable('audit_record', {
  id: pkId(),
  actorId: text('actor_id'), // null for system processes
  action: text('action').notNull(), // e.g. "POST /api/v1/auth/login"
  targetEntity: text('target_entity'),
  targetId: text('target_id'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});
