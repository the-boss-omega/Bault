import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { idempotencyKey } from './idempotency.schema';

interface StoredResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Idempotency store (T016, Principle V).
 *
 * `lookup` returns a previously-stored response for (key, endpoint) if the client
 * is replaying; the caller then returns it WITHOUT re-executing. `save` records
 * the outcome of a first execution. Keys expire after 24h.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async lookup(key: string, endpoint: string): Promise<StoredResponse | null> {
    const [row] = await this.db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint)))
      .limit(1);
    if (!row || row.statusCode == null) return null;
    return { statusCode: row.statusCode, body: row.responseBody };
  }

  async save(
    key: string,
    endpoint: string,
    userId: string | null,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.db
      .insert(idempotencyKey)
      .values({ key, endpoint, userId, statusCode, responseBody: body, expiresAt })
      .onConflictDoNothing();
  }
}
