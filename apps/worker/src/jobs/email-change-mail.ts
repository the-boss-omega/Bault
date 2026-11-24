import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { loadEnv } from '@bault/config';
import type { EmailAdapter } from '@bault/adapters';

export const EMAIL_CHANGE_REQUESTED = 'email_change_requested';
export const EMAIL_CHANGED = 'email_changed';

export const EMAIL_CHANGE_TTL_HOURS = 24;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${address.slice(0, 1)}•••${address.slice(at)}`;
}

function base(): string {
  return loadEnv().APP_BASE_URL.replace(/\/+$/, '');
}

function supportVariables(): Record<string, string> {
  const support = (loadEnv().SUPPORT_EMAIL ?? '').trim();
  return support
    ? { support, link: `mailto:${support}` }
    : { link: `${base()}/#/support` };
}

export async function sendEmailChangeLink(
  db: Pick<PoolClient, 'query'>,
  payload: Record<string, unknown> | null,
  mailer: EmailAdapter,
): Promise<boolean> {
  const userId = typeof payload?.userId === 'string' ? payload.userId : '';
  const pendingEmail = typeof payload?.pendingEmail === 'string' ? payload.pendingEmail : '';
  if (!UUID.test(userId) || !pendingEmail) return false;

  const { rows } = await db.query<{ email: string }>(
    `SELECT email FROM user_account
      WHERE id = $1
        AND pending_email = $2
        AND pending_email_token_hash IS NULL
        AND status IN ('active', 'suspended')
      FOR UPDATE`,
    [userId, pendingEmail],
  );
  const account = rows[0];
  if (!account) return false;

  const raw = randomBytes(32).toString('hex');
  await db.query(
    `UPDATE user_account
        SET pending_email_token_hash = $2, pending_email_expires_at = now() + make_interval(hours => $3)
      WHERE id = $1`,
    [userId, createHash('sha256').update(raw).digest('hex'), EMAIL_CHANGE_TTL_HOURS],
  );

  await mailer.send({
    to: pendingEmail,
    subject: 'Confirm your new Card Embassy email address',
    template: 'email_change',
    variables: { link: `${base()}/#/confirm-email?token=${encodeURIComponent(raw)}` },
  });
  if (payload?.notifyOld === true) {
    await mailer.send({
      to: account.email,
      subject: 'A change of email address was asked for on your Card Embassy account',
      template: 'email_change_notice',
      variables: { stage: 'requested', newAddress: maskAddress(pendingEmail), ...supportVariables() },
    });
  }
  return true;
}

export async function sendEmailChangedNotice(
  db: Pick<PoolClient, 'query'>,
  payload: Record<string, unknown> | null,
  mailer: EmailAdapter,
): Promise<boolean> {
  const userId = typeof payload?.userId === 'string' ? payload.userId : '';
  const previousEmail = typeof payload?.previousEmail === 'string' ? payload.previousEmail : '';
  if (!UUID.test(userId) || !previousEmail) return false;

  const { rows } = await db.query<{ email: string }>(`SELECT email FROM user_account WHERE id = $1`, [userId]);
  const account = rows[0];
  if (!account || account.email === previousEmail) return false;

  await mailer.send({
    to: previousEmail,
    subject: 'The email address on your Card Embassy account was changed',
    template: 'email_change_notice',
    variables: { stage: 'changed', newAddress: maskAddress(account.email), ...supportVariables() },
  });
  return true;
}
