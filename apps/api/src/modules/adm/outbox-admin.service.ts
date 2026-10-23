import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../sec/audit.service';
import { outboxMessage } from '../not/outbox/outbox.schema';
import { PARKED_AFTER_ATTEMPTS } from './outbox-parking';

const LIST_LIMIT = 500;

@Injectable()
export class OutboxAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listParked() {
    const rows = await this.db
      .select({
        id: outboxMessage.id,
        eventType: outboxMessage.eventType,
        aggregateType: outboxMessage.aggregateType,
        attempts: outboxMessage.attempts,
        lastError: outboxMessage.lastError,
        createdAt: outboxMessage.createdAt,
        lastAttemptAt: outboxMessage.lastAttemptAt,
        payload: outboxMessage.payload,
      })
      .from(outboxMessage)
      .where(parked())
      .orderBy(asc(outboxMessage.createdAt))
      .limit(LIST_LIMIT);
    return rows.map(({ payload, lastError, ...row }) => ({
      ...row,
      lastError: lastError === null ? null : redactSecrets(lastError),
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).sort() : [],
    }));
  }

  async requeue(actorId: string, id: string): Promise<{ id: string; status: 'requeued' }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(outboxMessage)
        .set({ attempts: 0 })
        .where(and(eq(outboxMessage.id, id), parked()))
        .returning({
          id: outboxMessage.id,
          eventType: outboxMessage.eventType,
          lastError: outboxMessage.lastError,
          lastAttemptAt: outboxMessage.lastAttemptAt,
        });
      if (!row) {
        const [exists] = await tx
          .select({ id: outboxMessage.id })
          .from(outboxMessage)
          .where(eq(outboxMessage.id, id))
          .limit(1);
        if (!exists) throw AppError.notFound('Outbox message not found');
        throw AppError.conflict(
          ErrorCode.OUTBOX_NOT_PARKED,
          'This message is not parked: it has been delivered, or the dispatcher is still retrying it.',
        );
      }
      await this.audit.record(
        {
          actorId,
          action: 'outbox.requeue',
          targetEntity: 'outbox_message',
          targetId: row.id,
          metadata: {
            eventType: row.eventType,
            parkedAfterAttempts: PARKED_AFTER_ATTEMPTS,
            lastError: row.lastError === null ? null : redactSecrets(row.lastError),
            lastAttemptAt: row.lastAttemptAt,
          },
        },
        tx as Database,
      );
      return { id: row.id, status: 'requeued' as const };
    });
  }
}

function parked() {
  return and(isNull(outboxMessage.dispatchedAt), gte(outboxMessage.attempts, PARKED_AFTER_ATTEMPTS));
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\b(token|code|secret|password|key)=([^&\s#"']+)/gi, '$1=[redacted]')
    .replace(/[0-9a-f]{32,}/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/_]{40,}={0,2}/g, '[redacted]');
}
