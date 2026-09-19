import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { generateToken, hashToken } from '../../shared/tokens';
import { loginSession, userAccount } from './acc.schema';
import type { AuthUser } from '../sec/auth-context';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Where a request came from, as far as the API can honestly tell. */
export interface ClientOrigin {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * A user agent is whatever the client says it is, and it can say a lot. Stored
 * for a person to read ("Chrome on Windows"), so it is capped rather than
 * trusted to be short.
 */
export function clampUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return ua.length > 300 ? ua.slice(0, 300) : ua;
}

/**
 * Session lifecycle (T031). Sessions are opaque tokens; only their hash is stored
 * (Principle IX). `create` mints a session for a user; `resolve` turns a raw
 * cookie value into an AuthUser (used by SessionAuthGuard); `revoke` signs out.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(
    userId: string,
    origin: ClientOrigin = {},
  ): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(loginSession).values({
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
      ip: origin.ip ?? null,
      userAgent: clampUserAgent(origin.userAgent),
    });
    return { rawToken, expiresAt };
  }

  /** Validate a raw session token → AuthUser, or null if invalid/expired/revoked. */
  async resolve(rawToken: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({
        userId: loginSession.userId,
        expiresAt: loginSession.expiresAt,
        revokedAt: loginSession.revokedAt,
        role: userAccount.role,
        status: userAccount.status,
      })
      .from(loginSession)
      .innerJoin(userAccount, sql`${userAccount.id}::text = ${loginSession.userId}`)
      .where(and(eq(loginSession.tokenHash, hashToken(rawToken)), isNull(loginSession.revokedAt)))
      .limit(1);

    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    return { id: row.userId, role: row.role, status: row.status };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.db
      .update(loginSession)
      .set({ revokedAt: new Date() })
      .where(eq(loginSession.tokenHash, hashToken(rawToken)));
  }

  /**
   * Revoke every session this user holds.
   *
   * A password change is the moment somebody who believes their account is
   * compromised acts on it — and until now it changed the password and nothing
   * else, so a stolen cookie kept working afterwards. That is the exact opposite
   * of what the person pressing the button believes they are doing.
   *
   * `exceptRawToken` keeps the caller's own session alive, so changing a
   * password from the profile page does not sign the person out of the page they
   * are standing on. A RESET passes nothing — the person is holding a link from
   * their inbox, not a session, and everything that exists at that moment is
   * suspect.
   *
   * Returns how many sessions were ended, because "signed out 3 other devices"
   * is a materially different message from "signed out 0", and the caller
   * cannot know which without being told.
   */
  async revokeAllFor(userId: string, exceptRawToken?: string): Promise<number> {
    const conditions = [eq(loginSession.userId, userId), isNull(loginSession.revokedAt)];
    if (exceptRawToken) {
      conditions.push(sql`${loginSession.tokenHash} <> ${hashToken(exceptRawToken)}`);
    }
    const revoked = await this.db
      .update(loginSession)
      .set({ revokedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: loginSession.id });
    return revoked.length;
  }
}
