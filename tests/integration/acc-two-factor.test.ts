import { afterAll, describe, expect, it } from 'vitest';
import { Client, SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import {
  MFA_PASSWORD,
  activeAccount,
  challenge,
  codeAt,
  enrol,
  passwordOnly,
  wrongCode,
} from './helpers/mfa';
import { base32Encode } from '../../apps/api/src/modules/acc/mfa/totp';

/**
 * Two-factor sign-in (TOTP), end to end, on fresh accounts.
 *
 * A password is phished, reused and guessed, and an administrator can reassign
 * ownership of every card in the vault and approve every cash-out. These pin the
 * second factor that stands behind the password: how an account enrols, how
 * sign-in asks for the code, and every way the second step could be got around:
 * replaying a code, racing two submissions of one code, reusing a challenge,
 * guessing past the lockout.
 *
 * None of this depends on which roles the API under test REQUIRES to enrol —
 * any account may enrol, and an enrolled account is challenged whatever its
 * role. The requirement itself is proven against a second API started with it
 * switched on (`acc-two-factor-required.test.ts`) and on the guard directly
 * (`tests3/contract/mfa-enforcement.test.ts`).
 */

afterAll(closeDb);

describe('enrolling', () => {
  it('hands out a secret three ways, and enables nothing until a code proves the app has it', async () => {
    const account = await activeAccount('mfaset');
    const c = await passwordOnly(account);

    const before = await c.get('/auth/mfa');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ enabled: false, pending: false });

    const setup = await c.post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    // 20 random bytes, base32 for typing by hand.
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(setup.body.otpauthUri as string);
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(decodeURIComponent(uri.pathname)).toContain(account.username);
    expect(setup.body.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(String(setup.body.qrCode).split(',')[1]!, 'base64').toString()).toContain('<svg');

    // A setup that was started and never confirmed changes nothing about signing in.
    expect((await c.get('/auth/mfa')).body).toMatchObject({ enabled: false, pending: true });
    await passwordOnly(account);

    const { base32Decode } = await import('../../apps/api/src/modules/acc/mfa/totp');
    const raw = base32Decode(secret);
    const wrong = await c.post('/auth/mfa/confirm', { code: wrongCode(raw), password: MFA_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('mfa_code_invalid');
    expect((await c.get('/auth/mfa')).body.enabled).toBe(false);

    const confirmed = await c.post('/auth/mfa/confirm', { code: codeAt(raw), password: MFA_PASSWORD });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('enabled');
    const codes = confirmed.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    const after = await c.get('/auth/mfa');
    expect(after.body).toMatchObject({ enabled: true, pending: false, recoveryCodesRemaining: 10 });
    // The recovery codes are shown once: nothing reads them back.
    expect(JSON.stringify(after.body)).not.toContain(codes[0]);
    expect((await c.get('/me/profile')).body).toMatchObject({ mfaEnabled: true });

    // Confirming again, or starting over, is refused while it is on.
    expect(
      (await c.post('/auth/mfa/confirm', { code: codeAt(raw, 1), password: MFA_PASSWORD })).body.error.code,
    ).toBe('mfa_already_enabled');
    expect((await c.post('/auth/mfa/setup')).body.error.code).toBe('mfa_already_enabled');
  });

  it('asks for the password before turning it on, so a stolen session cannot enrol its own phone', async () => {
    // Somebody holding only a session — a cookie lifted from a shared computer —
    // could otherwise enrol an authenticator of THEIR choosing, and from then on
    // the owner's password alone no longer gets the owner in. The password is
    // the thing the session thief does not have.
    const account = await activeAccount('mfapwd');
    const c = await passwordOnly(account);
    const setup = await c.post('/auth/mfa/setup');
    const { base32Decode } = await import('../../apps/api/src/modules/acc/mfa/totp');
    const raw = base32Decode(setup.body.secret as string);

    const noPassword = await c.post('/auth/mfa/confirm', { code: codeAt(raw) });
    expect(noPassword.status).toBe(400);
    const wrongPassword = await c.post('/auth/mfa/confirm', { code: codeAt(raw), password: 'not the password' });
    expect(wrongPassword.status).toBe(400);
    expect(wrongPassword.body.error.code).toBe('mfa_code_invalid');
    expect((await c.get('/auth/mfa')).body).toMatchObject({ enabled: false, pending: true });

    const [failed] = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM login_attempt WHERE identifier = $1 AND outcome = 'mfa_failed'`,
      [account.username],
    );
    expect(Number(failed!.n)).toBe(1);

    const confirmed = await c.post('/auth/mfa/confirm', { code: codeAt(raw), password: MFA_PASSWORD });
    expect(confirmed.status).toBe(200);
  });

  it('ends every other session of the account when it is turned on', async () => {
    // Turning on a second factor is what somebody does when they suspect their
    // password is known. A session opened with that password before it was
    // turned on must not outlive the decision.
    const account = await activeAccount('mfaend');
    const other = await passwordOnly(account);
    const c = await passwordOnly(account);
    expect((await other.get('/me/profile')).status).toBe(200);

    const setup = await c.post('/auth/mfa/setup');
    const { base32Decode } = await import('../../apps/api/src/modules/acc/mfa/totp');
    const raw = base32Decode(setup.body.secret as string);
    const confirmed = await c.post('/auth/mfa/confirm', { code: codeAt(raw), password: MFA_PASSWORD });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.otherSessionsEnded).toBe(1);

    expect((await other.get('/me/profile')).status).toBe(401);
    expect((await c.get('/me/profile')).status).toBe(200);
  });

  it('keeps the secret encrypted and the recovery codes only as keyed hashes', async () => {
    const account = await activeAccount('mfarest');
    const c = await passwordOnly(account);
    const { secret, recoveryCodes } = await enrol(c);

    const [factor] = await sql<{ secret_ciphertext: string; enabled_at: Date | null }>(
      `SELECT secret_ciphertext, enabled_at FROM mfa_factor WHERE user_id = $1`,
      [account.id],
    );
    expect(factor!.enabled_at).not.toBeNull();
    expect(factor!.secret_ciphertext).toMatch(/^v1\./);
    expect(factor!.secret_ciphertext).not.toContain(base32Encode(secret));
    expect(factor!.secret_ciphertext).not.toContain(secret.toString('base64'));
    expect(factor!.secret_ciphertext).not.toContain(secret.toString('hex'));

    const stored = await sql<{ code_hash: string }>(`SELECT code_hash FROM mfa_recovery_code WHERE user_id = $1`, [
      account.id,
    ]);
    expect(stored).toHaveLength(10);
    const flat = stored.map((r) => r.code_hash).join(' ');
    for (const code of recoveryCodes) {
      expect(flat).not.toContain(code);
      expect(flat).not.toContain(code.replace(/-/g, ''));
    }
  });
});

describe('signing in with a second factor', () => {
  it('answers a right password with a challenge, not a session', async () => {
    const account = await activeAccount('mfachal');
    await enrol(await passwordOnly(account));

    const c = new Client();
    const res = await c.post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('mfa_required');
    expect(res.body.challengeToken).toMatch(/^[0-9a-f]{64}$/);
    // Five minutes, give or take the request.
    const ttl = Date.parse(res.body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 5_000);
    // Nothing that a session would carry, and no session.
    expect(res.body.id).toBeUndefined();
    expect(res.body.role).toBeUndefined();
    expect((await c.get('/me/profile')).status).toBe(401);
  });

  it('says nothing new about a wrong password: the refusal is the one an account without 2FA gets', async () => {
    const enrolled = await activeAccount('mfawpe');
    await enrol(await passwordOnly(enrolled));
    const plain = await activeAccount('mfawpp');

    const a = await new Client().post('/auth/login', { identifier: enrolled.username, password: 'wrong-password' });
    const b = await new Client().post('/auth/login', { identifier: plain.username, password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('opens a session for the challenge plus a current code', async () => {
    const account = await activeAccount('mfaok');
    const { secret } = await enrol(await passwordOnly(account));

    const token = await challenge(account);
    const c = new Client();
    const res = await c.post('/auth/login/mfa', { challengeToken: token, code: codeAt(secret, 1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: account.id, role: 'user' });
    const me = await c.get('/me/profile');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(account.username);

    // Both halves are in the sign-in log: the password that was right, then the session.
    const outcomes = await sql<{ outcome: string }>(
      `SELECT outcome FROM login_attempt WHERE user_id = $1 ORDER BY occurred_at`,
      [account.id],
    );
    expect(outcomes.map((o) => o.outcome).slice(-2)).toEqual(['mfa_challenged', 'success']);
  });

  it('refuses a code for a step that was already used — the same code cannot open two sessions', async () => {
    const account = await activeAccount('mfareplay');
    const { secret } = await enrol(await passwordOnly(account));
    const code = codeAt(secret, 1);

    expect((await new Client().post('/auth/login/mfa', { challengeToken: await challenge(account), code })).status).toBe(200);
    // Still inside its thirty seconds, and a fresh challenge — but used.
    const replay = await new Client().post('/auth/login/mfa', { challengeToken: await challenge(account), code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('mfa_code_invalid');
  });

  it('refuses the code the enrolment was confirmed with', async () => {
    // Confirming records that step as used, so the code on the screen at
    // enrolment is not a free second sign-in for whoever watched it typed.
    const account = await activeAccount('mfaconf');
    const c = await passwordOnly(account);
    const setup = await c.post('/auth/mfa/setup');
    const { base32Decode } = await import('../../apps/api/src/modules/acc/mfa/totp');
    const secret = base32Decode(setup.body.secret as string);
    const code = codeAt(secret);
    expect((await c.post('/auth/mfa/confirm', { code, password: MFA_PASSWORD })).status).toBe(200);
    const res = await new Client().post('/auth/login/mfa', { challengeToken: await challenge(account), code });
    expect(res.status).toBe(401);
  });

  it('lets exactly one of two simultaneous submissions of one code through', async () => {
    const account = await activeAccount('mfarace');
    const { secret } = await enrol(await passwordOnly(account));
    const [t1, t2] = [await challenge(account), await challenge(account)];
    const code = codeAt(secret, 1);

    const results = await Promise.all([
      new Client().post('/auth/login/mfa', { challengeToken: t1, code }),
      new Client().post('/auth/login/mfa', { challengeToken: t2, code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('uses a challenge once', async () => {
    const account = await activeAccount('mfaonce');
    const { secret, recoveryCodes } = await enrol(await passwordOnly(account));
    const token = await challenge(account);
    expect((await new Client().post('/auth/login/mfa', { challengeToken: token, code: codeAt(secret, 1) })).status).toBe(200);

    // A recovery code is a valid second factor; the challenge is not.
    const again = await new Client().post('/auth/login/mfa', { challengeToken: token, recoveryCode: recoveryCodes[0] });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('mfa_challenge_expired');
  });

  it('lets a challenge expire after five minutes', async () => {
    const account = await activeAccount('mfaexp');
    const { recoveryCodes } = await enrol(await passwordOnly(account));
    const token = await challenge(account);
    await sql(`UPDATE mfa_challenge SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [account.id]);

    const res = await new Client().post('/auth/login/mfa', { challengeToken: token, recoveryCode: recoveryCodes[0] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('mfa_challenge_expired');
    // And nothing was spent on it.
    expect((await sql(`SELECT 1 FROM mfa_recovery_code WHERE user_id = $1 AND used_at IS NOT NULL`, [account.id])).length).toBe(0);
  });

  it("checks the code against the challenged account's secret, not anybody's", async () => {
    const a = await activeAccount('mfabnda');
    const b = await activeAccount('mfabndb');
    await enrol(await passwordOnly(a));
    const { secret: bSecret } = await enrol(await passwordOnly(b));

    const res = await new Client().post('/auth/login/mfa', { challengeToken: await challenge(a), code: codeAt(bSecret, 1) });
    expect(res.status).toBe(401);
  });

  it('refuses an invented challenge, and a request with no code or both kinds', async () => {
    const forged = await new Client().post('/auth/login/mfa', { challengeToken: 'f'.repeat(64), code: '123456' });
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('mfa_challenge_expired');

    const account = await activeAccount('mfashape');
    const { recoveryCodes } = await enrol(await passwordOnly(account));
    const token = await challenge(account);
    expect((await new Client().post('/auth/login/mfa', { challengeToken: token })).status).toBe(400);
    expect(
      (await new Client().post('/auth/login/mfa', { challengeToken: token, code: '123456', recoveryCode: recoveryCodes[0] })).status,
    ).toBe(400);
  });
});

describe('recovery codes', () => {
  it('sign an account in once each', async () => {
    const account = await activeAccount('mfarec');
    const { recoveryCodes } = await enrol(await passwordOnly(account));
    const code = recoveryCodes[3]!;

    const c = new Client();
    // Typed the way a person types a code read off paper.
    const first = await c.post('/auth/login/mfa', {
      challengeToken: await challenge(account),
      recoveryCode: ` ${code.toUpperCase().replace(/-/g, ' ')} `,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((await c.get('/auth/mfa')).body.recoveryCodesRemaining).toBe(9);

    const second = await new Client().post('/auth/login/mfa', { challengeToken: await challenge(account), recoveryCode: code });
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('mfa_code_invalid');
  });

  it('are replaced only with a current code, and the old set stops working', async () => {
    const account = await activeAccount('mfaregen');
    const c = await passwordOnly(account);
    const { secret, recoveryCodes: old } = await enrol(c);

    const refused = await c.post('/auth/mfa/recovery-codes', { code: wrongCode(secret) });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('mfa_code_invalid');

    const fresh = await c.post('/auth/mfa/recovery-codes', { code: codeAt(secret, 1) });
    expect(fresh.status).toBe(200);
    const replacement = fresh.body.recoveryCodes as string[];
    expect(replacement).toHaveLength(10);
    expect(replacement.filter((r) => old.includes(r))).toEqual([]);

    const oldOne = await new Client().post('/auth/login/mfa', { challengeToken: await challenge(account), recoveryCode: old[0] });
    expect(oldOne.status).toBe(401);
    const newOne = await new Client().post('/auth/login/mfa', {
      challengeToken: await challenge(account),
      recoveryCode: replacement[0],
    });
    expect(newOne.status).toBe(200);
  });
});

describe('guessing at the second step', () => {
  it('burns a challenge after five wrong codes', async () => {
    const account = await activeAccount('mfacap');
    const { secret } = await enrol(await passwordOnly(account));
    const token = await challenge(account);
    for (let i = 0; i < 5; i += 1) {
      const res = await new Client().post('/auth/login/mfa', { challengeToken: token, code: wrongCode(secret) });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('mfa_code_invalid');
    }
    const right = await new Client().post('/auth/login/mfa', { challengeToken: token, code: codeAt(secret, 1) });
    expect(right.status).toBe(401);
    expect(right.body.error.code).toBe('mfa_challenge_expired');
  });

  it('counts wrong codes toward the sign-in lockout: ten of them shut the identifier, password and code alike', async () => {
    const account = await activeAccount('mfalock');
    const { secret } = await enrol(await passwordOnly(account));
    const spare = await challenge(account);

    for (let round = 0; round < 2; round += 1) {
      const token = await challenge(account);
      for (let i = 0; i < 5; i += 1) {
        expect((await new Client().post('/auth/login/mfa', { challengeToken: token, code: wrongCode(secret) })).status).toBe(401);
      }
    }

    // The right password, now: refused, exactly as after ten wrong passwords.
    const password = await new Client().post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
    expect(password.status).toBe(429);
    expect(password.body.error.code).toBe('rate_limited');
    // And a challenge issued before the lock, with the right code: refused too.
    const code = await new Client().post('/auth/login/mfa', { challengeToken: spare, code: codeAt(secret, 1) });
    expect(code.status).toBe(429);

    const failures = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM login_attempt WHERE user_id = $1 AND outcome = 'mfa_failed'`,
      [account.id],
    );
    expect(failures[0]!.n).toBe(10);
  }, 60_000);

  it('counts a burst of guesses sent at once, one at a time', async () => {
    const account = await activeAccount('mfaburst');
    const { secret } = await enrol(await passwordOnly(account));
    const tokens = [];
    for (let i = 0; i < 4; i += 1) tokens.push(await challenge(account));
    // Four challenges, five guesses each, all at once: twenty guesses, of
    // which ten may be checked before the identifier locks.
    const results = await Promise.all(
      tokens.flatMap((t) =>
        Array.from({ length: 5 }, () => new Client().post('/auth/login/mfa', { challengeToken: t, code: wrongCode(secret) })),
      ),
    );
    const checked = results.filter((r) => r.body?.error?.code === 'mfa_code_invalid');
    expect(checked.length).toBeLessThanOrEqual(10);
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(10);
  }, 60_000);
});

describe('turning it off', () => {
  it('needs the password and a current code, and then the password alone signs in', async () => {
    const account = await activeAccount('mfaoff');
    const c = await passwordOnly(account);
    const { secret } = await enrol(c);

    const noPassword = await c.post('/auth/mfa/disable', { password: 'not-it', code: codeAt(secret, 1) });
    expect(noPassword.status).toBe(400);
    const noCode = await c.post('/auth/mfa/disable', { password: MFA_PASSWORD, code: wrongCode(secret) });
    expect(noCode.status).toBe(400);
    expect((await c.get('/auth/mfa')).body.enabled).toBe(true);

    const off = await c.post('/auth/mfa/disable', { password: MFA_PASSWORD, code: codeAt(secret, 1) });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await c.get('/auth/mfa')).body).toMatchObject({ enabled: false, pending: false });
    expect((await sql(`SELECT 1 FROM mfa_recovery_code WHERE user_id = $1`, [account.id])).length).toBe(0);
    await passwordOnly(account);
  });
});

describe("an administrator resetting somebody else's second factor", () => {
  it('removes it, ends their sessions and says so in the audit log', async () => {
    const account = await activeAccount('mfareset');
    const { secret } = await enrol(await passwordOnly(account));
    const theirs = new Client();
    expect(
      (await theirs.post('/auth/login/mfa', { challengeToken: await challenge(account), code: codeAt(secret, 1) })).status,
    ).toBe(200);
    expect((await theirs.get('/me/profile')).status).toBe(200);

    const admin = await signIn(SEED.admin);
    const res = await admin.post(`/admin/users/${account.id}/mfa/reset`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Two: the session they enrolled from, and the one they signed in with since.
    expect(res.body).toMatchObject({ status: 'mfa_reset', sessionsEnded: 2 });

    // Signed out wherever they were.
    expect((await theirs.get('/me/profile')).status).toBe(401);
    // And the password alone signs them in again, so they can enrol afresh.
    const back = await passwordOnly(account);
    expect((await back.get('/auth/mfa')).body.enabled).toBe(false);

    const [adminRow] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [SEED.admin]);
    const audit = await sql<{ actor_id: string; target_id: string }>(
      `SELECT actor_id, target_id FROM audit_record WHERE action = 'mfa.reset' AND target_id = $1`,
      [account.id],
    );
    expect(audit).toEqual([{ actor_id: adminRow!.id, target_id: account.id }]);
  });

  it('refuses their own, an account with nothing to reset, and anybody who is not an administrator', async () => {
    const admin = await signIn(SEED.admin);
    const [adminRow] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [SEED.admin]);
    const own = await admin.post(`/admin/users/${adminRow!.id}/mfa/reset`);
    expect(own.status).toBe(400);

    const plain = await activeAccount('mfanone');
    const none = await admin.post(`/admin/users/${plain.id}/mfa/reset`);
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('mfa_not_enabled');

    const enrolled = await activeAccount('mfanadm');
    await enrol(await passwordOnly(enrolled));
    for (const who of [SEED.collector, SEED.operator]) {
      const c = await signIn(who);
      expect((await c.post(`/admin/users/${enrolled.id}/mfa/reset`)).status).toBe(403);
    }
  });
});

describe("the administrator's sign-in log", () => {
  it('does not count a password that was right, then a code that was right, as a failure', async () => {
    // Five ordinary two-step sign-ins are five `mfa_challenged` rows. Counted as
    // failures, every enrolled account that signs in five times a day would be
    // listed as somebody guessing passwords.
    const account = await activeAccount('mfalog');
    const { recoveryCodes } = await enrol(await passwordOnly(account));
    for (let i = 0; i < 5; i += 1) {
      const res = await new Client().post('/auth/login/mfa', {
        challengeToken: await challenge(account),
        recoveryCode: recoveryCodes[i],
      });
      expect(res.status).toBe(200);
    }
    const log = await (await signIn(SEED.admin)).get('/admin/logins');
    expect(log.status).toBe(200);
    const flagged = (log.body.suspicious as { identifier: string }[]).map((s) => s.identifier);
    expect(flagged).not.toContain(account.username);
  });
});

describe('who the API says must enrol', () => {
  it('reports it on the profile, which the app reads on every load', async () => {
    const account = await activeAccount('mfame');
    const me = await (await passwordOnly(account)).get('/me/profile');
    expect(me.body).toMatchObject({ mfaEnabled: false });
    expect(typeof me.body.mfaRequired).toBe('boolean');
  });
});
