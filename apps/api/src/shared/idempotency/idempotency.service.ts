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

/** Keys are kept a day: long enough for any retry a client makes. */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Idempotency store (T016, Principle V).
 *
 * A key is CLAIMED, inside the transaction of the work it protects, before that
 * work runs — and its response is written in the same transaction:
 *
 *   const claim = await idempotency.claim(tx, key, endpoint, userId);
 *   if (claim.replay) return claim.replay.body;      // somebody already did this
 *   ...the work...
 *   await idempotency.complete(tx, key, endpoint, 201, result);
 *
 * It used to be a lookup before the transaction and a save after it, with
 * nothing in between, so the key protected only a RETRY. Two requests carrying
 * one key at the same moment both missed the lookup and both ran: a
 * double-clicked Buy on a store product with copies in stock bought two and
 * charged twice (F064).
 *
 * The claim is an INSERT against the unique (key, endpoint) index. A second
 * request with the same key blocks on the first one's uncommitted row; when the
 * first commits, the second sees its stored response and replays it, and when
 * the first fails and rolls back, the claim goes with it and the second simply
 * runs. Either way the work happens once.
 */
@Injectable()
export class IdempotencyService {
  /**
   * Claim `key` for this endpoint and caller, or find what it already did.
   *
   * `replay` is set when the work already ran under this key; the caller returns
   * it without running again. A key another account used is refused rather than
   * replayed: answering it would hand one buyer the receipt another earned.
   */
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

    // The conflicting row has committed (the insert waited for it), so this
    // read sees it.
    const [row] = await tx
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint)))
      .limit(1);
    if (!row || (userId !== null && row.userId !== null && row.userId !== userId)) {
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'That idempotency key has already been used.', 409);
    }
    if (row.statusCode == null) {
      // A claim committed without its response — written by nothing in this
      // service, but refused rather than run again if it ever exists.
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED, 'A request with that idempotency key is still in progress.', 409);
    }
    return { replay: { statusCode: row.statusCode, body: row.responseBody } };
  }

  /** Record the response of the work a claim protected, in the same transaction. */
  async complete(tx: Database, key: string, endpoint: string, statusCode: number, body: unknown): Promise<void> {
    await tx
      .update(idempotencyKey)
      .set({ statusCode, responseBody: body })
      .where(and(eq(idempotencyKey.key, key), eq(idempotencyKey.endpoint, endpoint)));
  }
}
