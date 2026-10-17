import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { loadEnv } from '@bault/config';
import type { EmailAdapter } from '@bault/adapters';
import { log } from '../log';

/**
 * Password-reset mail, sent from the outbox.
 *
 * `POST /auth/password/reset-request` writes one outbox row for ANY address and
 * answers at once, so neither its status nor its timing says whether an account
 * exists. Everything that depends on that happens here, after the caller has gone.
 *
 * The token is minted HERE, where it is mailed, so its raw value exists only in
 * the message and only its hash is stored. A link in the outbox payload would
 * leave a working reset link in a table.
 *
 * ON THE DISPATCHER'S TRANSACTION. `db` is the connection that claimed the
 * outbox message, and the token is written in the same transaction that marks
 * it dispatched. Minted on a connection of its own, a token outlived a dispatch
 * that failed to commit, the message was sent again, and the account held two
 * working reset links. Now a failed dispatch takes its token with it, and the
 * link already mailed opens nothing.
 *
 * Only an account that can still use a password is sent one: active,
 * suspended (it may sign in, to reach the helpdesk) or pending (it may verify
 * and then sign in). A closed account is never mailed.
 *
 * Mirrored BY VALUE from the API (the worker does not import it): the event
 * name from `PasswordService`, the token shape from `shared/tokens.ts`, and the
 * link format from `VerificationService`. The one-hour life is set only here.
 */
export const PASSWORD_RESET_REQUESTED = 'password_reset_requested';

const RESET_TTL_MINUTES = 60;

export async function sendPasswordReset(
  db: PoolClient,
  payload: Record<string, unknown> | null,
  mailer: EmailAdapter,
): Promise<void> {
  const email = typeof payload?.email === 'string' ? payload.email : '';
  if (!email) return;

  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM user_account WHERE email = $1 AND status IN ('active', 'suspended', 'pending') LIMIT 1`,
    [email],
  );
  // Nobody by that address, or nobody who could use a password. The caller was
  // told "sent if it exists" either way.
  const user = rows[0];
  if (!user) return;

  const raw = randomBytes(32).toString('hex');
  await db.query(
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
    // Logged rather than retried: the person can ask again from the same page,
    // and retries against a dead server would mail a stack of links when it
    // comes back.
    log.error('password reset mail failed', { job: 'outbox.dispatch', error: (err as Error).message });
  }
}
