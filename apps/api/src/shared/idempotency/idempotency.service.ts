import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { idempotencyKey } from './idempotency.schema';

interface StoredResponse {
  statusCode: number;
  body: unknown;
}

const KEY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  async claim(
    tx: Database,
    key: string,
    endpoint: string,
    userId: string | null,
  ): Promise<{ replay: StoredResponse | null }> {
    const expiresAt = new Date(Date.now() + KEY_TTL_MS);
    const [claimed] = await tx
      .insert(idempotencyKey)
      .values({ key, endpoint, userId, expiresAt })
      .onConflictDoNothing()
      .returning({ id: idempotencyKey.id });
    if (claimed) return { replay: null };

    const [row] = await tx
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint)))
      .limit(1);
    if (!row || (userId !== null && row.userId !== null && row.userId !== userId)) {
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'That idempotency key has already been used.', 409);
    }
    if (row.statusCode == null) {
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'A request with that idempotency key is still in progress.', 409);
    }
    return { replay: { statusCode: row.statusCode, body: row.responseBody } };
  }

  async complete(tx: Database, key: string, endpoint: string, statusCode: number, body: unknown): Promise<void> {
    await tx
      .update(idempotencyKey)
      .set({ statusCode, responseBody: body })
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint)));
  }
}
