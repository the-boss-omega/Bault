import { createHmac, hkdfSync, randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { loadEnv } from '@bault/config';
import type { EmailAdapter } from '@bault/adapters';
import { log } from '../log';

export const MFA_EMAIL_CODE_REQUESTED = 'mfa_email_code_requested';

export const EMAIL_CODE_TTL_MINUTES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let derived: Buffer | undefined;
export function emailCodeKey(): Buffer {
  if (derived) return derived;
  const master = Buffer.from(loadEnv().MFA_ENCRYPTION_KEY, 'base64');
  if (master.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to 32 bytes');
  derived = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'bault-mfa:email-codes', 32));
  return derived;
}

export function emailCodeHash(key: Buffer, codeId: string, code: string): string {
  return createHmac('sha256', key).update(`${codeId}:${code}`).digest('hex');
}

interface Waiting {
  id: string;
  purpose: 'sign_in' | 'settings';
  email: string;
  status: string;
  hasEmailFactor: boolean;
  boundTo: string | null;
}

export async function sendMfaEmailCode(
  db: Pick<PoolClient, 'query'>,
  payload: Record<string, unknown> | null,
  mailer: EmailAdapter,
): Promise<boolean> {
  const codeId = typeof payload?.codeId === 'string' ? payload.codeId : '';
  if (!UUID.test(codeId)) return false;

  const { rows } = await db.query<Waiting>(
    `SELECT c.id, c.purpose, u.email, u.status::text AS status,
            EXISTS (SELECT 1 FROM mfa_factor f WHERE f.user_id = c.user_id AND f.method = 'email') AS "hasEmailFactor",
            (SELECT f.email_address FROM mfa_factor f
              WHERE f.user_id = c.user_id AND f.method = 'email' AND f.enabled_at IS NOT NULL) AS "boundTo"
       FROM mfa_email_code c
       JOIN user_account u ON u.id = c.user_id
      WHERE c.id = $1
        AND c.code_hash IS NULL
        AND c.consumed_at IS NULL
        AND c.requested_at > now() - make_interval(mins => $2)
      FOR UPDATE OF c`,
    [codeId, EMAIL_CODE_TTL_MINUTES],
  );
  const code = rows[0];
  if (!code) return false;
  if (code.status !== 'active' && code.status !== 'suspended') return false;
  if (!code.hasEmailFactor) return false;
  if (code.purpose === 'sign_in' && code.boundTo === null) return false;
  if (code.boundTo !== null && code.boundTo !== code.email) {
    log.warn('two-factor code not mailed: the account address is not the one its email factor proved', {
      job: 'outbox.dispatch',
      codeId,
    });
    return false;
  }

  const digits = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query(
    `UPDATE mfa_email_code
        SET code_hash = $2, sent_to = $3, sent_at = now(), expires_at = now() + make_interval(mins => $4)
      WHERE id = $1`,
    [codeId, emailCodeHash(emailCodeKey(), codeId, digits), code.email, EMAIL_CODE_TTL_MINUTES],
  );
  await mailer.send({
    to: code.email,
    subject: code.purpose === 'sign_in' ? 'Your Card Embassy sign-in code' : 'Your Card Embassy confirmation code',
    template: 'mfa_email_code',
    variables: { code: digits, purpose: code.purpose, minutes: String(EMAIL_CODE_TTL_MINUTES) },
  });
  return true;
}
