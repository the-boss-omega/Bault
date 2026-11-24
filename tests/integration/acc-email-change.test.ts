import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Client, SEED, fixtureEmail, signIn } from './helpers/http';
import { closeDb, inTransaction, sql } from './helpers/db';
import {
  MFA_PASSWORD,
  activeAccount,
  codeAt,
  emailChallenge,
  enrol,
  enrolByEmail,
  passwordOnly,
  wrongCode,
  type Account,
} from './helpers/mfa';
import {
  EMAIL_CHANGED,
  EMAIL_CHANGE_REQUESTED,
  sendEmailChangeLink,
  sendEmailChangedNotice,
} from '../../apps/worker/src/jobs/email-change-mail';

const promoted: string[] = [];

afterAll(async () => {
  if (promoted.length > 0) {
    const admin = await signIn(SEED.admin);
    for (const id of promoted) await admin.patch(`/admin/users/${id}`, { role: 'user' });
  }
  await closeDb();
});

interface Mail {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, string>;
}

function from(): Record<string, string> {
  return { 'x-forwarded-for': `10.${[1, 2, 3].map(() => randomBytes(1)[0]).join('.')}` };
}

async function deliver(account: { id: string }): Promise<Mail[]> {
  const waiting = await sql<{ id: string; event_type: string; payload: Record<string, unknown> }>(
    `SELECT id, event_type, payload FROM outbox_message
      WHERE event_type = ANY($1::text[]) AND dispatched_at IS NULL AND payload->>'userId' = $2
      ORDER BY created_at`,
    [[EMAIL_CHANGE_REQUESTED, EMAIL_CHANGED], account.id],
  );
  const sent: Mail[] = [];
  const mailer = {
    send: async (message: Mail) => {
      sent.push(message);
      return { providerRef: `test_${sent.length}` };
    },
  };
  for (const message of waiting) {
    await inTransaction(async (client) => {
      if (message.event_type === EMAIL_CHANGE_REQUESTED) {
        await sendEmailChangeLink(client as never, message.payload, mailer);
      } else {
        await sendEmailChangedNotice(client as never, message.payload, mailer);
      }
      await client.query(`UPDATE outbox_message SET dispatched_at = now(), attempts = attempts + 1 WHERE id = $1`, [
        message.id,
      ]);
    });
  }
  return sent;
}

function tokenOf(mail: Mail): string {
  const link = mail.variables.link ?? '';
  expect(link).toMatch(/#\/confirm-email\?token=/);
  return decodeURIComponent(link.split('token=')[1]!);
}

async function ask(c: Client, email: string, extra: Record<string, unknown> = {}, headers = from()) {
  return c.post('/me/email', { email, currentPassword: MFA_PASSWORD, ...extra }, headers);
}

async function requested(c: Client, account: Account, email: string): Promise<string> {
  const res = await ask(c, email);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  const link = (await deliver(account)).find((m) => m.template === 'email_change');
  expect(link, 'a confirmation link was mailed').toBeDefined();
  return tokenOf(link!);
}

const confirm = (token: string, c = new Client()) => c.post('/auth/email/confirm', { token }, from());

const emailOf = async (id: string) =>
  (await sql<{ email: string }>(`SELECT email FROM user_account WHERE id = $1`, [id]))[0]!.email;

describe('a collector changes the account email', () => {
  it('holds the new address as pending, mails a link to it and a notice to the old one, and switches once the link is opened', async () => {
    const account = await activeAccount('chmail');
    const c = await passwordOnly(account);
    const next = fixtureEmail('chmail-new');

    const res = await ask(c, `  ${next.toUpperCase()} `);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({ status: 'confirmation_sent', pendingEmail: next });

    const pending = await c.get('/me/profile');
    expect(pending.body).toMatchObject({ email: account.email, pendingEmail: next });
    expect(Object.keys(pending.body)).not.toEqual(
      expect.arrayContaining(['pendingEmailTokenHash']),
    );
    expect(JSON.stringify(pending.body)).not.toMatch(/token|expires/i);

    const mails = await deliver(account);
    expect(mails.map((m) => [m.to, m.template, m.variables.stage ?? null])).toEqual([
      [next, 'email_change', null],
      [account.email, 'email_change_notice', 'requested'],
    ]);
    expect(mails[1]!.variables.link ?? '').not.toContain('token=');
    expect(await emailOf(account.id)).toBe(account.email);

    const done = await confirm(tokenOf(mails[0]!));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'email_changed' });
    expect(await emailOf(account.id)).toBe(next);

    const after = await deliver(account);
    expect(after.map((m) => [m.to, m.template, m.variables.stage])).toEqual([
      [account.email, 'email_change_notice', 'changed'],
    ]);

    const signedIn = await new Client().post('/auth/login', { identifier: next, password: MFA_PASSWORD });
    expect(signedIn.status).toBe(200);
    const old = await new Client().post('/auth/login', { identifier: account.email, password: MFA_PASSWORD });
    expect(old.status).toBe(401);
    const me = await new Client().post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
    expect(me.status).toBe(200);
  });

  it('refuses a link that has expired, and changes nothing', async () => {
    const account = await activeAccount('chexp');
    const c = await passwordOnly(account);
    const token = await requested(c, account, fixtureEmail('chexp-new'));
    await sql(
      `UPDATE user_account SET pending_email_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [account.id],
    );
    const res = await confirm(token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('token_expired');
    expect(await emailOf(account.id)).toBe(account.email);
  });

  it('mints a link that lasts 24 hours', async () => {
    const account = await activeAccount('chttl');
    const c = await passwordOnly(account);
    await requested(c, account, fixtureEmail('chttl-new'));
    const [row] = await sql<{ hours: number }>(
      `SELECT round(extract(epoch FROM pending_email_expires_at - now()) / 3600)::int AS hours
         FROM user_account WHERE id = $1`,
      [account.id],
    );
    expect(row!.hours).toBe(24);
  });

  it('spends the link: a second use is refused', async () => {
    const account = await activeAccount('chreuse');
    const c = await passwordOnly(account);
    const next = fixtureEmail('chreuse-new');
    const token = await requested(c, account, next);
    expect((await confirm(token)).status).toBe(200);
    const again = await confirm(token);
    expect(again.status).toBe(410);
    expect(await emailOf(account.id)).toBe(next);
    const [row] = await sql<{ pending_email: string | null; pending_email_token_hash: string | null }>(
      `SELECT pending_email, pending_email_token_hash FROM user_account WHERE id = $1`,
      [account.id],
    );
    expect(row).toEqual({ pending_email: null, pending_email_token_hash: null });
  });

  it('refuses a wrong current password and holds nothing', async () => {
    const account = await activeAccount('chpw');
    const c = await passwordOnly(account);
    const res = await ask(c, fixtureEmail('chpw-new'), { currentPassword: 'not the password' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/current password/i);
    expect((await c.get('/me/profile')).body.pendingEmail).toBeNull();
    expect(await deliver(account)).toEqual([]);
  });

  it('refuses an address another account has, the address the account already has, and one that is not an address', async () => {
    const account = await activeAccount('chused');
    const c = await passwordOnly(account);

    const taken = await ask(c, SEED.collector2.toUpperCase());
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/another account/i);

    const same = await ask(c, account.email);
    expect(same.status).toBe(400);

    const malformed = await ask(c, 'not-an-address');
    expect(malformed.status).toBe(400);

    expect((await c.get('/me/profile')).body.pendingEmail).toBeNull();
    expect(await deliver(account)).toEqual([]);
  });

  it('refuses the link when the address was taken by another account after it was asked for', async () => {
    const account = await activeAccount('chrace');
    const c = await passwordOnly(account);
    const next = fixtureEmail('chrace-new');
    const token = await requested(c, account, next);
    const other = await activeAccount('chrace2');
    await sql(`UPDATE user_account SET email = $2 WHERE id = $1`, [other.id, next]);
    const res = await confirm(token);
    expect(res.status).toBe(409);
    expect(await emailOf(account.id)).toBe(account.email);
  });

  it('lets a second request replace the first: the first link stops working', async () => {
    const account = await activeAccount('chtwice');
    const c = await passwordOnly(account);
    const first = await requested(c, account, fixtureEmail('chtwice-a'));
    const secondAddress = fixtureEmail('chtwice-b');
    const second = await requested(c, account, secondAddress);

    expect((await c.get('/me/profile')).body.pendingEmail).toBe(secondAddress);
    expect((await confirm(first)).status).toBe(410);
    expect((await confirm(second)).status).toBe(200);
    expect(await emailOf(account.id)).toBe(secondAddress);
  });

  it('mails a fresh link on resend, without a second notice to the old address, and cancel withdraws it', async () => {
    const account = await activeAccount('chresend');
    const c = await passwordOnly(account);
    const next = fixtureEmail('chresend-new');
    const first = await requested(c, account, next);

    const resent = await c.post('/me/email/resend', {}, from());
    expect(resent.status, JSON.stringify(resent.body)).toBe(202);
    const mails = await deliver(account);
    expect(mails.map((m) => [m.to, m.template])).toEqual([[next, 'email_change']]);
    const second = tokenOf(mails[0]!);
    expect((await confirm(first)).status).toBe(410);

    const cancelled = await c.request('DELETE', '/me/email', undefined, from());
    expect(cancelled.status).toBe(200);
    expect((await c.get('/me/profile')).body.pendingEmail).toBeNull();
    expect((await confirm(second)).status).toBe(410);
    expect(await emailOf(account.id)).toBe(account.email);

    const nothing = await c.post('/me/email/resend', {}, from());
    expect(nothing.status).toBe(409);
  });

  it('ends the account’s other sessions and keeps the one that opened the link', async () => {
    const account = await activeAccount('chsess');
    const here = await passwordOnly(account);
    const there = await passwordOnly(account);
    const token = await requested(here, account, fixtureEmail('chsess-new'));

    const res = await confirm(token, here);
    expect(res.status).toBe(200);
    expect(res.body.otherSessionsEnded).toBe(1);
    expect((await here.get('/me/profile')).status).toBe(200);
    expect((await there.get('/me/profile')).status).toBe(401);
  });

  it('ends every session when the link is opened signed out, and spends links mailed to the old address', async () => {
    const account = await activeAccount('chall');
    const c = await passwordOnly(account);
    await sql(
      `INSERT INTO verification_token (user_id, type, token_hash, expires_at)
       VALUES ($1, 'password_reset', $2, now() + interval '1 hour')`,
      [account.id, randomBytes(32).toString('hex')],
    );
    const token = await requested(c, account, fixtureEmail('chall-new'));
    expect((await confirm(token)).status).toBe(200);
    expect((await c.get('/me/profile')).status).toBe(401);
    const [live] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM verification_token WHERE user_id = $1 AND consumed_at IS NULL`,
      [account.id],
    );
    expect(live!.n).toBe(0);
  });

  it('writes an audit row naming both addresses', async () => {
    const account = await activeAccount('chaudit');
    const c = await passwordOnly(account);
    const next = fixtureEmail('chaudit-new');
    const token = await requested(c, account, next);
    expect((await confirm(token)).status).toBe(200);
    const rows = await sql<{ actor_id: string; metadata: Record<string, unknown> }>(
      `SELECT actor_id, metadata FROM audit_record WHERE action = 'account.email_changed' AND target_id = $1`,
      [account.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(account.id);
    expect(rows[0]!.metadata).toMatchObject({ from: account.email, to: next, otherSessionsEnded: 1 });
  });

  it('moves an email second factor to the new address, so sign-in codes keep coming', async () => {
    const account = await activeAccount('chfactor');
    const c = await passwordOnly(account);
    await enrolByEmail(c, account);
    const next = fixtureEmail('chfactor-new');
    const token = await requested(c, account, next);
    expect((await confirm(token, c)).status).toBe(200);

    const [factor] = await sql<{ email_address: string }>(
      `SELECT email_address FROM mfa_factor WHERE user_id = $1 AND method = 'email'`,
      [account.id],
    );
    expect(factor!.email_address).toBe(next);
    const { body } = await emailChallenge(account);
    expect(body).toMatchObject({ codeSent: true });
  });

  it('is rate-limited like password reset', async () => {
    const account = await activeAccount('chrate');
    const c = await passwordOnly(account);
    const one = from();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) statuses.push((await ask(c, fixtureEmail(`chrate-${i}`), {}, one)).status);
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    await deliver(account);
  });
});

describe('a member of staff changes the account email', () => {
  async function staff(): Promise<{ account: Account; c: Client; secret: Buffer }> {
    const account = await activeAccount('chstaff');
    const admin = await signIn(SEED.admin);
    expect((await admin.patch(`/admin/users/${account.id}`, { role: 'warehouse_operator' })).status).toBe(200);
    promoted.push(account.id);
    const c = await passwordOnly(account);
    const { secret } = await enrol(c);
    return { account, c, secret };
  }

  it('must give a current code from the authenticator app as well as the password', async () => {
    const { account, c, secret } = await staff();
    const next = fixtureEmail('chstaff-new');

    const missing = await ask(c, next);
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/authenticator/i);

    const wrong = await ask(c, next, { code: wrongCode(secret) });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('mfa_code_invalid');
    expect((await c.get('/me/profile')).body.pendingEmail).toBeNull();

    const right = await ask(c, next, { code: codeAt(secret, 1) });
    expect(right.status, JSON.stringify(right.body)).toBe(202);
    const link = (await deliver(account)).find((m) => m.template === 'email_change')!;
    expect((await confirm(tokenOf(link), c)).status).toBe(200);
    expect(await emailOf(account.id)).toBe(next);
  });
});
