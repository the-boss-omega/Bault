import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { generateToken, hashToken } from '../tokens';
import { confirmationToken } from './confirmation.schema';

@Injectable()
export class ConfirmationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async issue(
    userId: string,
    action: string,
    payload: Record<string, unknown>,
    ttlSeconds = 300,
  ): Promise<{ confirmationToken: string; expiresAt: Date }> {
    const raw = generateToken();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.db.insert(confirmationToken).values({
      userId,
      action,
      tokenHash: hashToken(raw),
      payload,
      expiresAt,
    });
    return { confirmationToken: raw, expiresAt };
  }

  async consume<T = Record<string, unknown>>(
    userId: string,
    action: string,
    rawToken: string,
  ): Promise<T> {
    const [row] = await this.db
      .select()
      .from(confirmationToken)
      .where(
        and(
          eq(confirmationToken.userId, userId),
          eq(confirmationToken.action, action),
          eq(confirmationToken.tokenHash, hashToken(rawToken)),
        ),
      )
      .limit(1);

    if (!row) {
      throw new AppError(ErrorCode.CONFIRMATION_REQUIRED, 'Invalid confirmation token', 400);
    }
    if (row.consumedAt || row.expiresAt.getTime() < Date.now()) {
      throw AppError.tokenExpired('Confirmation token expired or already used');
    }

    const [claimed] = await this.db
      .update(confirmationToken)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(confirmationToken.id, row.id),
          isNull(confirmationToken.consumedAt),
          gt(confirmationToken.expiresAt, new Date()),
        ),
      )
      .returning({ id: confirmationToken.id });
    if (!claimed) throw AppError.tokenExpired('Confirmation token expired or already used');

    return row.payload as T;
  }
}
