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
