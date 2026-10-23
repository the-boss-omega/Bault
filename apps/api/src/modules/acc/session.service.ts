import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { generateToken, hashToken } from '../../shared/tokens';
import { loginSession, mfaFactor, userAccount } from './acc.schema';
import type { AuthUser } from '../sec/auth-context';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ClientOrigin {
  ip?: string | null;
  userAgent?: string | null;
}

export function clampUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.length > 300 ? ua.slice(0, 300) : ua;
}

@Injectable()
export class SessionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(
    userId: string,
    origin: ClientOrigin = {},
    tx?: Database,
  ): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await (tx ?? this.db).insert(loginSession).values({
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
      ip: origin.ip ?? null,
      userAgent: clampUserAgent(origin.userAgent),
    });
    return { rawToken, expiresAt };
  }

  async resolve(rawToken: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({
        userId: loginSession.userId,
        expiresAt: loginSession.expiresAt,
        revokedAt: loginSession.revokedAt,
        role: userAccount.role,
        status: userAccount.status,
        mfaEnabledAt: mfaFactor.enabledAt,
      })
      .from(loginSession)
      .innerJoin(userAccount, eq(userAccount.id, loginSession.userId))
      .leftJoin(mfaFactor, eq(mfaFactor.userId, loginSession.userId))
      .where(and(eq(loginSession.tokenHash, hashToken(rawToken)), isNull(loginSession.revokedAt)))
      .limit(1);

    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    return { id: row.userId, role: row.role, status: row.status, mfaEnabled: row.mfaEnabledAt !== null };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.db
      .update(loginSession)
      .set({ revokedAt: new Date() })
      .where(eq(loginSession.tokenHash, hashToken(rawToken)));
  }

  async revokeAllFor(userId: string, exceptRawToken?: string, tx?: Database): Promise<number> {
    const conditions = [eq(loginSession.userId, userId), isNull(loginSession.revokedAt)];
    if (exceptRawToken) {
      conditions.push(sql`${loginSession.tokenHash} <> ${hashToken(exceptRawToken)}`);
    }
    const revoked = await (tx ?? this.db)
      .update(loginSession)
      .set({ revokedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: loginSession.id });
    return revoked.length;
  }
}
