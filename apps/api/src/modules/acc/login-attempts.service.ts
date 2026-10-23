import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { loginAttempt } from './acc.schema';
import { clampUserAgent, type ClientOrigin } from './session.service';

const LOCKOUT_FAILURES = 10;
const LOCKOUT_WINDOW_MIN = 15;
const LOCKOUT_MIN = 15;

export type LoginOutcome = 'success' | 'bad_credentials' | 'unverified' | 'refused' | 'mfa_challenged' | 'mfa_failed';

@Injectable()
export class LoginAttemptService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  lockedFor(normalized: string): Promise<number> {
    const identifier = normalized.slice(0, 254);
    return this.secondsLocked(
      sql`identifier = ${identifier} AND outcome IN ('bad_credentials', 'mfa_failed')`,
    );
  }

  secondFactorLockedFor(userId: string): Promise<number> {
    return this.secondsLocked(sql`user_id = ${userId} AND outcome = 'mfa_failed'`);
  }

  private async secondsLocked(which: SQL): Promise<number> {
    const result = await this.db.execute<{ seconds_left: number }>(sql`
      SELECT ceil(extract(epoch FROM (max(occurred_at) + make_interval(mins => ${LOCKOUT_MIN}) - now())))::int AS seconds_left
        FROM (
          SELECT occurred_at FROM login_attempt
           WHERE ${which}
             AND occurred_at > now() - make_interval(mins => ${LOCKOUT_WINDOW_MIN + LOCKOUT_MIN})
           ORDER BY occurred_at DESC
           LIMIT ${LOCKOUT_FAILURES}
        ) recent
      HAVING count(*) >= ${LOCKOUT_FAILURES}
         AND max(occurred_at) - min(occurred_at) <= make_interval(mins => ${LOCKOUT_WINDOW_MIN})
         AND max(occurred_at) > now() - make_interval(mins => ${LOCKOUT_MIN})`);
    return Math.max(0, Number(result.rows[0]?.seconds_left ?? 0));
  }

  lockedError(secondsLeft: number): AppError {
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    return new AppError(
      ErrorCode.RATE_LIMITED,
      `Too many failed sign-ins for this email or username. Try again in ${minutes} minutes, or reset your password.`,
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterSeconds: secondsLeft },
    );
  }

  async record(
    identifier: string,
    userId: string | null,
    outcome: LoginOutcome,
    origin: ClientOrigin,
  ): Promise<void> {
    try {
      await this.db.insert(loginAttempt).values({
        identifier: identifier.slice(0, 254),
        userId,
        outcome,
        ip: origin.ip ?? null,
        userAgent: clampUserAgent(origin.userAgent),
      });
    } catch (e) {
      console.error('[auth] could not record a sign-in attempt', e);
    }
  }
}
