import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../../../db/db.module';
import type { Database } from '../../../db/client';
import { outboxMessage } from './outbox.schema';

export interface DomainEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox writer (T018, Principle XI).
 *
 * `emit` MUST be called with the SAME transaction handle (`tx`) as the state
 * change, so the event and the change commit together — atomically. The worker
 * dispatches unsent rows later (T128). Never call this outside a transaction that
 * also performs the state change.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async emit(tx: Database, event: DomainEvent): Promise<void> {
    await tx.insert(outboxMessage).values({
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload,
    });
  }
}
