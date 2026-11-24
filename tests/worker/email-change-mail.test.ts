import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { renderEmail } from '@bault/adapters';
import { dispatchOutbox } from '../../apps/worker/src/jobs/outbox-dispatch';
import { EMAIL_CHANGED, EMAIL_CHANGE_REQUESTED } from '../../apps/worker/src/jobs/email-change-mail';
import { count, createUser, testPool } from './helpers/db';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Sent {
  to: string;
  template: string;
  variables: Record<string, string>;
}

function watchMail() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return (): Sent[] =>
    log.mock.calls
      .map((call) => String(call[0]).match(/^\[email\] to=(\S+) template=(email_change\S*)$/))
      .flatMap((m, i) => (m ? [{ to: m[1]!, template: m[2]!, variables: log.mock.calls[i]![1] as Record<string, string> }] : []));
}

const emailOf = async (userId: string) =>
  (await pool.query<{ email: string }>(`SELECT email FROM user_account WHERE id = $1`, [userId])).rows[0]!.email;

async function emit(eventType: string, userId: string, payload: Record<string, unknown>): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload)
     VALUES ('user_account', $1, $2, $3::jsonb) RETURNING id`,
    [userId, eventType, JSON.stringify({ userId, ...payload })],
  );
  return rows[0]!.id;
}

async function pend(userId: string, address: string): Promise<void> {
  await pool.query(`UPDATE user_account SET pending_email = $2 WHERE id = $1`, [userId, address]);
}

const fresh = () => `wk-new-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}@fixture.bault.test`;

describe('mailing an email change', () => {
  it('mails the new address a Card Embassy confirmation link that lasts 24 hours, and stores only its hash', async () => {
    const mails = watchMail();
    const user = await createUser(pool);
    const old = await emailOf(user);
    const next = fresh();
    await pend(user, next);
    await emit(EMAIL_CHANGE_REQUESTED, user, { pendingEmail: next, notifyOld: true });

    await dispatchOutbox(pool);

    const sent = mails().filter((m) => m.to === next || m.to === old);
    expect(sent.map((m) => [m.to, m.template])).toEqual([
      [next, 'email_change'],
      [old, 'email_change_notice'],
    ]);
    const link = sent[0]!.variables.link!;
    expect(link).toMatch(/\/#\/confirm-email\?token=[0-9a-f]{64}$/);
    const raw = link.split('token=')[1]!;
    const { rows } = await pool.query<{ hash: string; hours: number }>(
      `SELECT pending_email_token_hash AS hash,
              round(extract(epoch FROM pending_email_expires_at - now()) / 3600)::int AS hours
         FROM user_account WHERE id = $1`,
      [user],
    );
    expect(rows[0]!.hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(rows[0]!.hours).toBe(24);

    const { text, html } = renderEmail('email_change', sent[0]!.variables);
    expect(text).toContain('CONFIRM YOUR NEW ADDRESS');
    expect(text).toContain('Confirm your new email address');
    expect(text).toContain('Card Embassy');
    expect(text).toMatch(/valid for 24 hours and can be used once/);
    expect(text).toContain(link);
    expect(html).toContain('Confirm new address');
    expect(html).not.toMatch(/Bault/);
  });

  it('tells the old address that a change was asked for, to which address, and how to refuse it', async () => {
    const mails = watchMail();
    const user = await createUser(pool);
    const old = await emailOf(user);
    const next = fresh();
    await pend(user, next);
    await emit(EMAIL_CHANGE_REQUESTED, user, { pendingEmail: next, notifyOld: true });
    await dispatchOutbox(pool);

    const notice = mails().find((m) => m.to === old)!;
    expect(notice.variables.stage).toBe('requested');
    expect(notice.variables.newAddress).toBe(`w•••@fixture.bault.test`);
    expect(notice.variables.link ?? '').not.toContain('token');
    const { text } = renderEmail('email_change_notice', notice.variables);
    expect(text).toContain('EMAIL CHANGE REQUESTED');
    expect(text).toContain('Somebody asked to change the email address on your Card Embassy account to w•••@fixture.bault.test');
    expect(text).toMatch(/nothing changes until the link sent to the new address is opened/i);
    expect(text).toMatch(/If this was not you, sign in and cancel it under Profile → Details, change your password, and contact Card Embassy support/);
    expect(text).not.toContain(next);
  });

  it('tells the old address once the change has happened, and how to get support', async () => {
    const mails = watchMail();
    const user = await createUser(pool);
    const old = await emailOf(user);
    const next = fresh();
    await pool.query(`UPDATE user_account SET email = $2 WHERE id = $1`, [user, next]);
    await emit(EMAIL_CHANGED, user, { previousEmail: old });
    await dispatchOutbox(pool);

    const sent = mails().filter((m) => m.to === old || m.to === next);
    expect(sent.map((m) => [m.to, m.template, m.variables.stage])).toEqual([[old, 'email_change_notice', 'changed']]);
    const { text } = renderEmail('email_change_notice', sent[0]!.variables);
    expect(text).toContain('EMAIL ADDRESS CHANGED');
    expect(text).toContain('The email address on your Card Embassy account is now w•••@fixture.bault.test');
    expect(text).toMatch(/signed out everywhere else/);
    expect(text).toMatch(/If this was not you, contact Card Embassy support at once/);
  });

  it('names the support address when one is set', () => {
    const { text } = renderEmail('email_change_notice', {
      stage: 'changed',
      newAddress: 'n•••@example.test',
      support: 'help@example.test',
      link: 'mailto:help@example.test',
    });
    expect(text).toContain('contact Card Embassy support at once at help@example.test');
  });

  it('mails nothing for a request that was replaced, cancelled or already minted, and no notice on a resend', async () => {
    const mails = watchMail();
    const user = await createUser(pool);
    const old = await emailOf(user);
    const first = fresh();
    const second = fresh();
    await pend(user, second);
    const replaced = await emit(EMAIL_CHANGE_REQUESTED, user, { pendingEmail: first, notifyOld: true });
    const resend = await emit(EMAIL_CHANGE_REQUESTED, user, { pendingEmail: second, notifyOld: false });
    const twice = await emit(EMAIL_CHANGE_REQUESTED, user, { pendingEmail: second, notifyOld: false });
    await dispatchOutbox(pool);

    const sent = mails().filter((m) => [old, first, second].includes(m.to));
    expect(sent.map((m) => [m.to, m.template])).toEqual([[second, 'email_change']]);
    expect(
      await count(pool, `SELECT 1 FROM outbox_message WHERE id = ANY($1::uuid[]) AND dispatched_at IS NULL`, [
        [replaced, resend, twice],
      ]),
    ).toBe(0);
  });

  it('mails nothing to a closed account', async () => {
    const mails = watchMail();
    const user = await createUser(pool, 'closed');
    const next = fresh();
    await pend(user, next);
    await emit(EMAIL_CHANGE_REQUESTED, user, { pendingEmail: next, notifyOld: true });
    await dispatchOutbox(pool);
    expect(mails().filter((m) => m.to === next)).toEqual([]);
  });
});
