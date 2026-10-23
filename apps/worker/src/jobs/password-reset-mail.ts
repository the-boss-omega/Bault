import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { loadEnv } from '@bault/config';
import type { EmailAdapter } from '@bault/adapters';
import { log } from '../log';

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
      subject: 'איפוס הסיסמה ב־Bault · Reset your Bault password',
      template: 'password_reset',
      variables: { link: `${base}/#/reset-password?token=${encodeURIComponent(raw)}` },
    });
  } catch (err) {
    log.error('password reset mail failed', { job: 'outbox.dispatch', error: (err as Error).message });
  }
}
