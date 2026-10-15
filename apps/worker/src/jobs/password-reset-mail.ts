import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import type { EmailAdapter } from '@bault/adapters';
import { log } from '../log';

/**
 * Password-reset mail, sent from the outbox (N11).
 *
 * `POST /auth/password/reset-request` used to look the address up, mint a token
 * and send the mail inside the request, and only for an address with an
 * account — so a dead mail server answered 500 for registered addresses and 202
 * for the rest, and the time taken said the same thing. The API now writes one
 * outbox row for ANY address and answers at once; everything that depends on
 * whether the account exists happens here, after the caller has gone.
 *
 * The token is minted HERE, where it is mailed, so its raw value exists only in
 * the message and only its hash is stored — the rule every other token in the
 * product follows. Writing the link into the outbox payload instead would have
 * left a working reset link in a table.
 *
 * Mirrored BY VALUE from the API (the worker does not import it): the event
 * name from `PasswordService`, the token shape from `shared/tokens.ts`, the
 * one-hour life and the link format from `VerificationService`.
 */
export const PASSWORD_RESET_REQUESTED = 'password_reset_requested';

const RESET_TTL_MINUTES = 60;

export async function sendPasswordReset(
  pool: Pool,
  payload: Record<string, unknown> | null,
  mailer: EmailAdapter,
): Promise<void> {
  const email = typeof payload?.email === 'string' ? payload.email : '';
  if (!email) return;

  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM user_account WHERE email = $1 LIMIT 1`, [
    email,
  ]);
  // Nobody by that address. The caller was told "sent if it exists" either way.
  const user = rows[0];
  if (!user) return;

  const raw = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO verification_token (user_id, type, token_hash, expires_at)
     VALUES ($1, 'password_reset', $2, now() + make_interval(mins => $3))`,
    [user.id, createHash('sha256').update(raw).digest('hex'), RESET_TTL_MINUTES],
  );

  const base = loadEnv().APP_BASE_URL.replace(/\/+$/, '');
  try {
    await mailer.send({
      to: email,
      subject: 'Reset your Bault password',
      template: 'password_reset',
      variables: { link: `${base}/#/reset-password?token=${encodeURIComponent(raw)}` },
    });
  } catch (err) {
    // Logged rather than retried: the token is already minted, the person can
    // ask again from the same page, and a retry loop against a dead server
    // would mail them a stack of links when it comes back.
    log.error('password reset mail failed', { job: 'outbox.dispatch', error: (err as Error).message });
  }
}
