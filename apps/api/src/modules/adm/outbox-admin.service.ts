import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../sec/audit.service';
import { outboxMessage } from '../not/outbox/outbox.schema';
import { PARKED_AFTER_ATTEMPTS } from './outbox-parking';

/** The most parked messages the console lists at once. */
const LIST_LIMIT = 500;

/**
 * Parked outbox messages: the administrator's view of them, and the way to put
 * one back in the queue.
 *
 * The dispatcher parks a message after it has failed `PARKED_AFTER_ATTEMPTS`
 * times — a mail server that was down, a payload it could not read — and its
 * log line said it "needs a person". There was nothing a person could do with
 * that short of an UPDATE typed into the production database. This is the
 * supported way: see what is parked and why, and requeue it once the cause is
 * fixed.
 */
@Injectable()
export class OutboxAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * What failed and when — and NOT what the message carries.
   *
   * A payload is whatever its emitter put in it. Today that includes the
   * address a password reset was asked for, and the next event somebody adds
   * could carry a token or a link that signs somebody in; an administrator
   * deciding whether to retry a message needs neither. So the payload never
   * leaves the database through this route: only the NAMES of its fields, which
   * say what kind of message it is. `aggregateId` is left out for the same
   * reason — for a reset request it is the email address. The error text is
   * scrubbed of anything shaped like a token before it is returned.
   */
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

  /**
   * Put one parked message back for the dispatcher — once.
   *
   * The attempt count goes back to zero, which is the only thing the dispatcher
   * reads to decide a message is parked, so the next run picks it up and it gets
   * the full number of tries again. Its last error stays on the row as history.
   *
   * The UPDATE is the check: it matches only a row that is undispatched AND has
   * used up its attempts. Two clicks, two tabs, two administrators at once — the
   * second UPDATE waits for the first, re-reads the row, finds it no longer
   * parked and matches nothing, so the message is requeued and audited exactly
   * once and the second caller is told it is not parked. The audit row commits
   * with the requeue, in the same transaction, or not at all.
   */
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

/** Undispatched, with every attempt used: what the dispatcher has given up on. */
function parked() {
  return and(isNull(outboxMessage.dispatchedAt), gte(outboxMessage.attempts, PARKED_AFTER_ATTEMPTS));
}

/**
 * Error text with anything shaped like a credential taken out.
 *
 * An error is whatever the failing code said, and a failing send can quote the
 * link it was sending. Three shapes are removed: a `token=`, `code=`, `secret=`,
 * `password=` or `key=` parameter's value; a run of 32 or more hex digits (every
 * token Bault mints is hex); and a run of 40 or more base64 characters. A UUID
 * survives — its groups are short — because it is how a person finds the row.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(token|code|secret|password|key)=([^&\s#"']+)/gi, '$1=[redacted]')
    .replace(/[0-9a-f]{32,}/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/_]{40,}={0,2}/g, '[redacted]');
}
