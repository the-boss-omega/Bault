import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import { MFA_PASSWORD, activeAccount, challenge, codeAt, enrol, passwordOnly } from './helpers/mfa';
import { sealSecret } from '../../apps/api/src/modules/acc/mfa/secret-box';
import { generateTotpSecret } from '../../apps/api/src/modules/acc/mfa/totp';

afterAll(closeDb);

async function sealUnderAnotherKey(accountId: string): Promise<Buffer> {
  const secret = generateTotpSecret();
  const otherKey = randomBytes(32);
  await sql(`UPDATE mfa_factor SET secret_ciphertext = $2, last_used_step = NULL WHERE user_id = $1`, [
    accountId,
    sealSecret(otherKey, secret, accountId),
  ]);
  return secret;
}

describe('a factor sealed under another key', () => {
  it('answers the second sign-in step with a clear code, not a 500', async () => {
    const account = await activeAccount('mfakey');
    await enrol(await passwordOnly(account));
    const secret = await sealUnderAnotherKey(account.id);

    const token = await challenge(account);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: codeAt(secret) });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe('mfa_factor_unreadable');
    expect(res.body.error.message).toMatch(/administrator/i);
    expect(res.body.error.message).toMatch(/reset/i);
  });

  it('answers the same on the signed-in routes that check a code', async () => {
    const account = await activeAccount('mfakey2');
    const c = await passwordOnly(account);
    await enrol(c);
    const secret = await sealUnderAnotherKey(account.id);

    const off = await c.post('/auth/mfa/disable', { password: MFA_PASSWORD, code: codeAt(secret, 1) });
    expect(off.status, JSON.stringify(off.body)).toBe(409);
    expect(off.body.error.code).toBe('mfa_factor_unreadable');
  });

  it('tells a setup that was never confirmed to start again, which replaces it', async () => {
    const account = await activeAccount('mfakey3');
    const c = await passwordOnly(account);
    expect((await c.post('/auth/mfa/setup')).status).toBe(200);
    const secret = await sealUnderAnotherKey(account.id);

    const confirmed = await c.post('/auth/mfa/confirm', { code: codeAt(secret), password: MFA_PASSWORD });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(409);
    expect(confirmed.body.error.code).toBe('mfa_factor_unreadable');
    expect(confirmed.body.error.message).toMatch(/set.?up again/i);
  });
});
