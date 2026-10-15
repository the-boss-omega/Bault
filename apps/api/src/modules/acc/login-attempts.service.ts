import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { loginAttempt } from './acc.schema';
import { clampUserAgent, type ClientOrigin } from './session.service';

/**
 * The per-identifier lockout: this many failures inside `LOCKOUT_WINDOW_MIN`
 * shut that identifier out for `LOCKOUT_MIN`, whatever password comes next.
 *
 * The per-IP rate limit was the only brake, and it brakes a person, not an
 * attacker: anybody with a second address could go on guessing at one account
 * indefinitely. Ten is far past a forgotten password and a mistyped one.
 */
const LOCKOUT_FAILURES = 10;
const LOCKOUT_WINDOW_MIN = 15;
const LOCKOUT_MIN = 15;

export type LoginOutcome = 'success' | 'bad_credentials' | 'unverified' | 'refused' | 'mfa_challenged' | 'mfa_failed';

/**
 * The sign-in log and the lockout that reads it.
 *
 * Moved out of `AuthService` when sign-in grew a second step: a wrong code is
 * checked in three places now — the second sign-in step, replacing recovery
 * codes and turning two-factor sign-in off — and every one of them has to
 * count against the same limit and land in the same log, or the limit is only
 * as strong as the least careful of them.
 */
@Injectable()
export class LoginAttemptService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Seconds until this typed identifier may try again, or 0.
   *
   * Locked when its last `LOCKOUT_FAILURES` failures all fall within
   * `LOCKOUT_WINDOW_MIN` of each other and the newest of them is under
   * `LOCKOUT_MIN` old. Because refusals during a lock write nothing, that newest
   * failure is the one that tripped it, so the lock lasts exactly `LOCKOUT_MIN`
   * from there. Decided by the database's clock — the one that stamped the
   * attempts — so a skewed API host cannot shorten it.
   *
   * A wrong second-factor code is a failure here exactly like a wrong password:
   * somebody who has the password and is guessing at the code is the attacker
   * this lock exists for, one step further along.
   */
  lockedFor(normalized: string): Promise<number> {
    const identifier = normalized.slice(0, 254); // as `record` stores it
    return this.secondsLocked(
      sql`identifier = ${identifier} AND outcome IN ('bad_credentials', 'mfa_failed')`,
    );
  }

  /**
   * The same lock, on wrong CODES for one ACCOUNT, whichever identifier or
   * route they came through.
   *
   * The identifier lock alone counts an account's email and username apart, and
   * does not see codes checked while signed in at all (replacing recovery codes,
   * turning two-factor off). A stolen session cookie could otherwise guess at
   * the code there at the rate limit's pace. Keyed on the account, which reveals
   * nothing: every code check happens after the password, or inside a session.
   */
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

  /** The refusal while a lock stands — the same words for every route that hits it. */
  lockedError(secondsLeft: number): AppError {
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    return new AppError(
      ErrorCode.RATE_LIMITED,
      `Too many failed sign-ins for this email or username. Try again in ${minutes} minutes, or reset your password.`,
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterSeconds: secondsLeft },
    );
  }

  /**
   * One row per sign-in attempt, in `login_attempt`.
   *
   * Never allowed to break sign-in: if the log cannot be written the person
   * still gets the answer they were owed, and the failure is logged instead. A
   * security log that can lock everybody out when the disk is full is a denial
   * of service with good intentions.
   */
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
