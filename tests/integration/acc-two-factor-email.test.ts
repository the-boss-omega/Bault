import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Client, SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import {
  MFA_PASSWORD,
  activeAccount,
  ageCodeRequests,
  challenge,
  codeAt,
  deliverCodes,
  emailChallenge,
  enrol,
  enrolByEmail,
  mailedCode,
  otherCode,
  passwordOnly,
} from './helpers/mfa';

afterAll(closeDb);

const failures = async (userId: string) =>
  (
    await sql<{ n: number }>(`SELECT count(*)::int AS n FROM login_attempt WHERE user_id = $1 AND outcome = 'mfa_failed'`, [
      userId,
    ])
  )[0]!.n;

describe('choosing email codes', () => {
  it('offers email first, and the authenticator app, to a collector', async () => {
    const account = await activeAccount('emopts');
    const c = await passwordOnly(account);
    const status = await c.get('/auth/mfa');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      enabled: false,
      pending: false,
      method: null,
      methods: ['email', 'totp'],
      email: account.email,
    });
  });

  it('mails a code to the account address, and turns nothing on until the password and that code come back', async () => {
    const account = await activeAccount('emset');
    const c = await passwordOnly(account);

    const setup = await c.post('/auth/mfa/setup', { method: 'email' });
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    expect(setup.body).toMatchObject({ method: 'email', email: account.email });
    expect(setup.body.resendAfterSeconds).toBeGreaterThan(0);
    expect(setup.body.secret).toBeUndefined();
    expect((await c.get('/auth/mfa')).body).toMatchObject({ enabled: false, pending: true, pendingMethod: 'email' });

    const mail = await deliverCodes(account);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: account.email, template: 'mfa_email_code' });
    expect(mail[0]!.variables.purpose).toBe('settings');
    const code = mail[0]!.variables.code!;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await c.post('/auth/mfa/confirm', { method: 'email', code: otherCode(code), password: MFA_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('mfa_code_invalid');
    const noPassword = await c.post('/auth/mfa/confirm', { method: 'email', code, password: 'not the password' });
    expect(noPassword.status).toBe(400);
    expect((await c.get('/auth/mfa')).body.enabled).toBe(false);

    const confirmed = await c.post('/auth/mfa/confirm', { method: 'email', code: ` ${code.slice(0, 3)} ${code.slice(3)} `, password: MFA_PASSWORD });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.status).toBe('enabled');
    expect(confirmed.body.recoveryCodes).toHaveLength(10);

    expect((await c.get('/auth/mfa')).body).toMatchObject({
      enabled: true,
      pending: false,
      method: 'email',
      email: account.email,
      recoveryCodesRemaining: 10,
    });
    expect((await c.get('/me/profile')).body).toMatchObject({ mfaEnabled: true, mfaMethod: 'email' });

    const audit = await sql<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_record WHERE action = 'mfa.enable' AND target_id = $1`,
      [account.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ method: 'email' });
  });

  it('keeps only a keyed hash of a code, never the code, in the database and in the outbox', async () => {
    const account = await activeAccount('emhash');
    const c = await passwordOnly(account);
    await c.post('/auth/mfa/setup', { method: 'email' });
    const [message] = await sql<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_message
        WHERE event_type = 'mfa_email_code_requested' AND payload->>'codeId' IN (SELECT id::text FROM mfa_email_code WHERE user_id = $1)`,
      [account.id],
    );
    expect(Object.keys(message!.payload)).toEqual(['codeId']);

    const code = await mailedCode(account);
    const [row] = await sql<{ code_hash: string; sent_to: string }>(
      `SELECT code_hash, sent_to FROM mfa_email_code WHERE user_id = $1`,
      [account.id],
    );
    expect(row!.sent_to).toBe(account.email);
    expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.code_hash).not.toContain(code);
    expect(row!.code_hash).not.toBe(createHash('sha256').update(code).digest('hex'));
    const [outbox] = await sql<{ text: string }>(
      `SELECT string_agg(payload::text, ' ') AS text FROM outbox_message WHERE payload->>'codeId' IN (SELECT id::text FROM mfa_email_code WHERE user_id = $1)`,
      [account.id],
    );
    expect(outbox!.text).not.toContain(code);
  });

  it('does not let a code mailed for one account confirm another', async () => {
    const a = await activeAccount('emxa');
    const b = await activeAccount('emxb');
    const ca = await passwordOnly(a);
    const cb = await passwordOnly(b);
    await ca.post('/auth/mfa/setup', { method: 'email' });
    await cb.post('/auth/mfa/setup', { method: 'email' });
    const aCode = await mailedCode(a);
    const bCode = await mailedCode(b);
    if (aCode === bCode) return;
    const res = await cb.post('/auth/mfa/confirm', { method: 'email', code: aCode, password: MFA_PASSWORD });
    expect(res.status).toBe(400);
    expect((await cb.get('/auth/mfa')).body.enabled).toBe(false);
  });

  it('asks for the authenticator to be turned off first, to switch an account that already has one', async () => {
    const account = await activeAccount('emswap');
    const c = await passwordOnly(account);
    await enrol(c);
    const res = await c.post('/auth/mfa/setup', { method: 'email' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('mfa_already_enabled');
    expect(await deliverCodes(account)).toEqual([]);
  });

  it('answers the old authenticator setup when no method is named', async () => {
    const account = await activeAccount('emdflt');
    const c = await passwordOnly(account);
    const res = await c.post('/auth/mfa/setup');
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('signing in with an emailed code', () => {
  it('answers a right password with a challenge, mails a code, and the code opens one session', async () => {
    const account = await activeAccount('emsign');
    await enrolByEmail(await passwordOnly(account), account);

    const { token, body } = await emailChallenge(account);
    expect(body.codeSent).toBe(true);
    expect(body.sentTo).not.toBe(account.email);
    expect(body.sentTo).toMatch(/^e.*@fixture\.bault\.test$/);
    expect(body.id).toBeUndefined();
    const ttl = Date.parse(body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(25 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000 + 5_000);

    const mail = await deliverCodes(account);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: account.email, template: 'mfa_email_code' });
    expect(mail[0]!.variables.purpose).toBe('sign_in');

    const c = new Client();
    const res = await c.post('/auth/login/mfa', { challengeToken: token, code: mail[0]!.variables.code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: account.id, role: 'user', mfaEnrollmentRequired: false });
    expect((await c.get('/me/profile')).body.username).toBe(account.username);

    const outcomes = await sql<{ outcome: string }>(
      `SELECT outcome FROM login_attempt WHERE user_id = $1 ORDER BY occurred_at`,
      [account.id],
    );
    expect(outcomes.map((o) => o.outcome).slice(-2)).toEqual(['mfa_challenged', 'success']);
  });

  it('says nothing new about a wrong password, and mails nothing for one', async () => {
    const enrolled = await activeAccount('emwpe');
    await enrolByEmail(await passwordOnly(enrolled), enrolled);
    const plain = await activeAccount('emwpp');

    const a = await new Client().post('/auth/login', { identifier: enrolled.username, password: 'wrong-password' });
    const b = await new Client().post('/auth/login', { identifier: plain.username, password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(await deliverCodes(enrolled)).toEqual([]);
  });

  it('works once: the same code cannot open a second session', async () => {
    const account = await activeAccount('emonce');
    await enrolByEmail(await passwordOnly(account), account);
    const first = await emailChallenge(account);
    const code = await mailedCode(account);
    expect((await new Client().post('/auth/login/mfa', { challengeToken: first.token, code })).status).toBe(200);

    await ageCodeRequests(account, 120);
    const second = await emailChallenge(account);
    const replay = await new Client().post('/auth/login/mfa', { challengeToken: second.token, code });
    expect(replay.status).toBe(401);
    expect(['mfa_code_invalid', 'mfa_code_expired']).toContain(replay.body.error.code);
  });

  it('lets exactly one of two simultaneous submissions of one code through', async () => {
    const account = await activeAccount('emrace');
    await enrolByEmail(await passwordOnly(account), account);
    const t1 = (await emailChallenge(account)).token;
    const t2 = (await emailChallenge(account)).token;
    const code = await mailedCode(account);

    const results = await Promise.all([
      new Client().post('/auth/login/mfa', { challengeToken: t1, code }),
      new Client().post('/auth/login/mfa', { challengeToken: t2, code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('sends one code for two sign-ins a moment apart, so the one email works for both', async () => {
    const account = await activeAccount('emtwice');
    await enrolByEmail(await passwordOnly(account), account);
    await emailChallenge(account);
    const { token } = await emailChallenge(account);
    const mail = await deliverCodes(account);
    expect(mail).toHaveLength(1);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: mail[0]!.variables.code });
    expect(res.status).toBe(200);
  });

  it('mails a fresh code to a sign-in right after one that used its code', async () => {
    const account = await activeAccount('emagain');
    await enrolByEmail(await passwordOnly(account), account);
    const first = await emailChallenge(account);
    const used = await mailedCode(account);
    expect((await new Client().post('/auth/login/mfa', { challengeToken: first.token, code: used })).status).toBe(200);

    const second = await emailChallenge(account);
    expect(second.body.codeSent).toBe(true);
    const fresh = await mailedCode(account);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: second.token, code: fresh });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('takes only the newest code: asking for another replaces the one before it', async () => {
    const account = await activeAccount('emnew');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    const old = await mailedCode(account);

    await ageCodeRequests(account, 61);
    const resent = await new Client().post('/auth/login/mfa/resend', { challengeToken: token });
    expect(resent.status, JSON.stringify(resent.body)).toBe(202);
    expect(resent.body).toMatchObject({ status: 'code_sent' });
    expect(resent.body.sentTo).toMatch(/@fixture\.bault\.test$/);
    expect(resent.body.resendAfterSeconds).toBe(60);
    const fresh = await mailedCode(account);

    if (old !== fresh) {
      const stale = await new Client().post('/auth/login/mfa', { challengeToken: token, code: old });
      expect(stale.status).toBe(401);
    }
    const ok = await new Client().post('/auth/login/mfa', { challengeToken: token, code: fresh });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('sends a new code once a minute at most, and five an hour', async () => {
    const account = await activeAccount('emthrot');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);

    const tooSoon = await new Client().post('/auth/login/mfa/resend', { challengeToken: token });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('rate_limited');
    expect(tooSoon.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(tooSoon.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(60);

    // The enrolment's code and the sign-in's are two; three more make five in the hour.
    for (let i = 0; i < 3; i += 1) {
      await ageCodeRequests(account, 61);
      expect((await new Client().post('/auth/login/mfa/resend', { challengeToken: token })).status).toBe(202);
    }
    await ageCodeRequests(account, 61);
    const sixth = await new Client().post('/auth/login/mfa/resend', { challengeToken: token });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.message).toMatch(/hour/i);

    const again = await new Client().post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: 'mfa_required', method: 'email', codeSent: false });
    expect(again.body.resendAfterSeconds).toBeGreaterThan(60);

    const [n] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM mfa_email_code WHERE user_id = $1`, [account.id]);
    expect(n!.n).toBe(5);
  });

  it('serialises two requests for a new code: one is sent, the other told to wait', async () => {
    const account = await activeAccount('emrace2');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    await ageCodeRequests(account, 61);

    const results = await Promise.all([
      new Client().post('/auth/login/mfa/resend', { challengeToken: token }),
      new Client().post('/auth/login/mfa/resend', { challengeToken: token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    const live = await sql(`SELECT 1 FROM mfa_email_code WHERE user_id = $1 AND purpose = 'sign_in' AND consumed_at IS NULL`, [
      account.id,
    ]);
    expect(live).toHaveLength(1);
  });

  it('burns a code after five wrong tries; then only a new code will do', async () => {
    const account = await activeAccount('emburn');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    const code = await mailedCode(account);

    for (let i = 0; i < 5; i += 1) {
      const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: otherCode(code) });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('mfa_code_invalid');
    }
    const right = await new Client().post('/auth/login/mfa', { challengeToken: token, code });
    expect(right.status).toBe(401);
    expect(right.body.error.code).toBe('mfa_code_expired');
    expect(right.body.error.message).toMatch(/new code/i);

    await ageCodeRequests(account, 61);
    expect((await new Client().post('/auth/login/mfa/resend', { challengeToken: token })).status).toBe(202);
    const fresh = await mailedCode(account);
    const ok = await new Client().post('/auth/login/mfa', { challengeToken: token, code: fresh });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('says how many tries a code has left', async () => {
    const account = await activeAccount('emleft');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    const code = await mailedCode(account);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: otherCode(code) });
    expect(res.status).toBe(401);
    expect(res.body.error.details).toMatchObject({ attemptsLeft: 4 });
    expect(res.body.error.message).toMatch(/4/);
  });

  it('counts wrong codes toward the sign-in lockout, and sends no code while it lasts', async () => {
    const account = await activeAccount('emlock');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);

    for (let round = 0; round < 2; round += 1) {
      const code = await mailedCode(account);
      for (let i = 0; i < 5; i += 1) {
        expect((await new Client().post('/auth/login/mfa', { challengeToken: token, code: otherCode(code) })).status).toBe(401);
      }
      if (round === 0) {
        await ageCodeRequests(account, 61);
        expect((await new Client().post('/auth/login/mfa/resend', { challengeToken: token })).status).toBe(202);
      }
    }
    expect(await failures(account.id)).toBe(10);

    const password = await new Client().post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
    expect(password.status).toBe(429);
    await ageCodeRequests(account, 61);
    const resend = await new Client().post('/auth/login/mfa/resend', { challengeToken: token });
    expect(resend.status).toBe(429);
    expect(await deliverCodes(account)).toEqual([]);
  }, 60_000);

  it('lets a code expire ten minutes after it was mailed', async () => {
    const account = await activeAccount('emexp');
    const { recoveryCodes } = await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    const code = await mailedCode(account);
    const [row] = await sql<{ minutes: number }>(
      `SELECT round(extract(epoch FROM expires_at - sent_at) / 60)::int AS minutes FROM mfa_email_code
        WHERE user_id = $1 AND purpose = 'sign_in'`,
      [account.id],
    );
    expect(row!.minutes).toBe(10);
    await sql(`UPDATE mfa_email_code SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [account.id]);

    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('mfa_code_expired');
    // The challenge itself is still good: a recovery code finishes it.
    const rec = await new Client().post('/auth/login/mfa', { challengeToken: token, recoveryCode: recoveryCodes[0] });
    expect(rec.status).toBe(200);
  });

  it('refuses a code typed before its email went out', async () => {
    const account = await activeAccount('emearly');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('mfa_code_expired');
    expect(await failures(account.id)).toBe(1);
  });

  it("checks the code against the challenged account's own code", async () => {
    const a = await activeAccount('embnda');
    const b = await activeAccount('embndb');
    await enrolByEmail(await passwordOnly(a), a);
    await enrolByEmail(await passwordOnly(b), b);
    const { token } = await emailChallenge(a);
    await emailChallenge(b);
    const aCode = await mailedCode(a);
    const bCode = await mailedCode(b);
    if (aCode === bCode) return;
    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: bCode });
    expect(res.status).toBe(401);
  });

  it('does not take a code mailed to change the settings at sign-in', async () => {
    const account = await activeAccount('empurp');
    const c = await passwordOnly(account);
    await enrolByEmail(c, account);
    const { token } = await emailChallenge(account);
    await deliverCodes(account);

    await ageCodeRequests(account, 61);
    expect((await c.post('/auth/mfa/email/code')).status).toBe(202);
    const settingsCode = await mailedCode(account);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: settingsCode });
    expect(res.status).toBe(401);
  });

  it('refuses a new code for an invented challenge, and for one that asks for the authenticator', async () => {
    const forged = await new Client().post('/auth/login/mfa/resend', { challengeToken: 'f'.repeat(64) });
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('mfa_challenge_expired');

    const account = await activeAccount('emtotp');
    await enrol(await passwordOnly(account));
    const token = await challenge(account);
    const res = await new Client().post('/auth/login/mfa/resend', { challengeToken: token });
    expect(res.status).toBe(400);
    expect(await deliverCodes(account)).toEqual([]);
  });

  it('keeps the recovery codes working for an email factor', async () => {
    const account = await activeAccount('emrec');
    const { recoveryCodes } = await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    const c = new Client();
    const res = await c.post('/auth/login/mfa', { challengeToken: token, recoveryCode: recoveryCodes[2] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await c.get('/auth/mfa')).body.recoveryCodesRemaining).toBe(9);
  });
});

describe('an address that changes under an email factor', () => {
  it('stops a code mailed to the old address from working', async () => {
    const account = await activeAccount('emaddr');
    await enrolByEmail(await passwordOnly(account), account);
    const { token } = await emailChallenge(account);
    const code = await mailedCode(account);

    await sql(`UPDATE user_account SET email = $2 WHERE id = $1`, [account.id, `moved-${account.email}`]);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('mfa_code_expired');
  });

  it('sends nothing to the new address: the factor is the address that was proved, and a recovery code still signs in', async () => {
    const account = await activeAccount('emaddr2');
    const { recoveryCodes } = await enrolByEmail(await passwordOnly(account), account);
    const moved = `moved-${account.email}`;
    await sql(`UPDATE user_account SET email = $2 WHERE id = $1`, [account.id, moved]);

    const { token, body } = await emailChallenge(account);
    expect(body.codeSent).toBe(false);
    const resend = await new Client().post('/auth/login/mfa/resend', { challengeToken: token });
    expect(resend.status).toBe(409);
    expect(resend.body.error.code).toBe('mfa_email_address_changed');
    expect(await deliverCodes(account)).toEqual([]);

    const c = new Client();
    expect((await c.post('/auth/login/mfa', { challengeToken: token, recoveryCode: recoveryCodes[0] })).status).toBe(200);
    expect((await c.get('/auth/mfa')).body).toMatchObject({ enabled: true, method: 'email', email: account.email });
  });

  it('does not mail a code the API asked for before the address changed', async () => {
    const account = await activeAccount('emaddr3');
    await enrolByEmail(await passwordOnly(account), account);
    await emailChallenge(account);
    await sql(`UPDATE user_account SET email = $2 WHERE id = $1`, [account.id, `moved-${account.email}`]);
    expect(await deliverCodes(account)).toEqual([]);
  });
});

describe('changing the settings with an emailed code', () => {
  it('turns it off with the password and a code mailed for it, then the password alone signs in', async () => {
    const account = await activeAccount('emoff');
    const c = await passwordOnly(account);
    await enrolByEmail(c, account);

    await ageCodeRequests(account, 61);
    const sent = await c.post('/auth/mfa/email/code');
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect(sent.body).toMatchObject({ status: 'code_sent', email: account.email });
    const code = await mailedCode(account);

    expect((await c.post('/auth/mfa/disable', { password: 'not-it', code })).status).toBe(400);
    const wrong = await c.post('/auth/mfa/disable', { password: MFA_PASSWORD, code: otherCode(code) });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('mfa_code_invalid');
    expect((await c.get('/auth/mfa')).body.enabled).toBe(true);

    const off = await c.post('/auth/mfa/disable', { password: MFA_PASSWORD, code });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await c.get('/auth/mfa')).body).toMatchObject({ enabled: false, pending: false, method: null });
    expect((await sql(`SELECT 1 FROM mfa_factor WHERE user_id = $1`, [account.id])).length).toBe(0);
    await passwordOnly(account);
  });

  it('replaces the recovery codes for a code mailed for it', async () => {
    const account = await activeAccount('emregen');
    const c = await passwordOnly(account);
    const { recoveryCodes: old } = await enrolByEmail(c, account);
    await ageCodeRequests(account, 61);
    await c.post('/auth/mfa/email/code');
    const code = await mailedCode(account);
    const fresh = await c.post('/auth/mfa/recovery-codes', { code });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
    expect((fresh.body.recoveryCodes as string[]).filter((r) => old.includes(r))).toEqual([]);
  });

  it('has nothing to mail for an account without email codes', async () => {
    const account = await activeAccount('emnone');
    const c = await passwordOnly(account);
    const res = await c.post('/auth/mfa/email/code');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('mfa_not_enabled');
    await enrol(c);
    expect((await c.post('/auth/mfa/email/code')).status).toBe(409);
    expect(await deliverCodes(account)).toEqual([]);
  });
});

describe("an administrator resetting somebody's email codes", () => {
  it('removes the factor, withdraws the code on its way, and the password alone signs in', async () => {
    const account = await activeAccount('emreset');
    await enrolByEmail(await passwordOnly(account), account);
    await emailChallenge(account);

    const admin = await signIn(SEED.admin);
    const res = await admin.post(`/admin/users/${account.id}/mfa/reset`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('mfa_reset');

    expect(await deliverCodes(account)).toEqual([]);
    const live = await sql(`SELECT 1 FROM mfa_email_code WHERE user_id = $1 AND consumed_at IS NULL`, [account.id]);
    expect(live).toEqual([]);
    const back = await passwordOnly(account);
    expect((await back.get('/auth/mfa')).body).toMatchObject({ enabled: false, method: null });

    const audit = await sql<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_record WHERE action = 'mfa.reset' AND target_id = $1`,
      [account.id],
    );
    expect(audit[0]!.metadata).toMatchObject({ wasEnabled: true, method: 'email' });
  });
});

describe('a TOTP account is unchanged', () => {
  it('still signs in with the code from its app, and its challenge still says so', async () => {
    const account = await activeAccount('emapp');
    const { secret } = await enrol(await passwordOnly(account));
    const res = await new Client().post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
    expect(res.body).toMatchObject({ status: 'mfa_required', method: 'totp' });
    expect(res.body.codeSent).toBeUndefined();
    const ok = await new Client().post('/auth/login/mfa', { challengeToken: res.body.challengeToken, code: codeAt(secret, 1) });
    expect(ok.status).toBe(200);
    expect(await deliverCodes(account)).toEqual([]);
  });
});
