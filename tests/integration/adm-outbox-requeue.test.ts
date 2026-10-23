import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

const planted: string[] = [];
afterAll(async () => {
  if (planted.length > 0) {
    await sql(`UPDATE outbox_message SET dispatched_at = now() WHERE id = ANY($1::uuid[])`, [planted]);
  }
  await closeDb();
});

const SECRET = () => `secret-${randomBytes(12).toString('hex')}`;

async function plant(state: { attempts: number; dispatched?: boolean; payload?: Record<string, unknown> }) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload, attempts, last_error, last_attempt_at, dispatched_at)
     VALUES ('item', 'requeue-test', 'item_donated', $1::jsonb, $2, $3, now(), $4)
     RETURNING id`,
    [
      JSON.stringify(state.payload ?? { userId: '00000000-0000-0000-0000-000000000000' }),
      state.attempts,
      state.attempts > 0 ? 'connect ECONNREFUSED smtp.example.invalid:587' : null,
      state.dispatched ? new Date() : null,
    ],
  );
  planted.push(row!.id);
  return row!.id;
}

const attemptsOf = async (id: string) =>
  (await sql<{ attempts: number }>(`SELECT attempts FROM outbox_message WHERE id = $1`, [id]))[0]!.attempts;
const requeueAudits = async (id: string) =>
  sql<{ actor_id: string }>(`SELECT actor_id FROM audit_record WHERE action = 'outbox.requeue' AND target_id = $1`, [id]);

describe('the list of parked messages', () => {
  it('is for administrators only', async () => {
    const id = await plant({ attempts: 5 });
    for (const who of [SEED.collector, SEED.operator]) {
      const c = await signIn(who);
      expect((await c.get('/admin/outbox/parked')).status, who).toBe(403);
      expect((await c.post(`/admin/outbox/${id}/requeue`)).status, who).toBe(403);
    }
    expect(await attemptsOf(id)).toBe(5);
  });

  it('shows what failed and when, and never what the message carries', async () => {
    const token = SECRET();
    const email = `parked-${randomBytes(4).toString('hex')}@fixture.bault.test`;
    const id = await plant({ attempts: 5, payload: { userId: 'x', email, token, link: `https://app/#/reset?token=${token}` } });
    const notParked = await plant({ attempts: 2 });

    const admin = await signIn(SEED.admin);
    const res = await admin.get('/admin/outbox/parked');
    expect(res.status).toBe(200);
    const row = (res.body as { id: string }[]).find((r) => r.id === id);
    expect(row).toMatchObject({ id, eventType: 'item_donated', attempts: 5 });
    expect(row).toHaveProperty('lastError');
    expect(row).toHaveProperty('createdAt');
    expect(row).toHaveProperty('lastAttemptAt');
    expect(row).not.toHaveProperty('payload');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(token);
    expect(text).not.toContain(email);
    expect((res.body as { id: string }[]).some((r) => r.id === notParked)).toBe(false);
  });

  it('keeps a secret out of the error text too', async () => {
    const token = 'a'.repeat(64);
    const [row] = await sql<{ id: string }>(
      `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload, attempts, last_error, last_attempt_at)
       VALUES ('password_reset', 'x', 'password_reset_requested', '{}'::jsonb, 5, $1, now()) RETURNING id`,
      [`send failed for https://app.example/#/reset-password?token=${token}`],
    );
    planted.push(row!.id);
    const res = await (await signIn(SEED.admin)).get('/admin/outbox/parked');
    const listed = (res.body as { id: string; lastError: string }[]).find((r) => r.id === row!.id);
    expect(listed!.lastError).toContain('send failed');
    expect(JSON.stringify(res.body)).not.toContain(token);
  });
});

describe('requeueing a parked message', () => {
  it('puts it back for the dispatcher and records who did it', async () => {
    const id = await plant({ attempts: 5 });
    const admin = await signIn(SEED.admin);
    const res = await admin.post(`/admin/outbox/${id}/requeue`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'requeued' });
    expect(await attemptsOf(id)).toBe(0);

    const [adminRow] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [SEED.admin]);
    expect(await requeueAudits(id)).toEqual([{ actor_id: adminRow!.id }]);
    const list = await admin.get('/admin/outbox/parked');
    expect((list.body as { id: string }[]).some((r) => r.id === id)).toBe(false);
  });

  it('happens once when the button is pressed twice at the same moment', async () => {
    const id = await plant({ attempts: 5 });
    const [a, b] = [await signIn(SEED.admin), await signIn(SEED.admin)];
    const results = await Promise.all([a.post(`/admin/outbox/${id}/requeue`), b.post(`/admin/outbox/${id}/requeue`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await requeueAudits(id)).toHaveLength(1);
    expect(await attemptsOf(id)).toBe(0);
  });

  it('refuses a message that is not parked', async () => {
    const admin = await signIn(SEED.admin);
    const retrying = await plant({ attempts: 2 });
    const delivered = await plant({ attempts: 5, dispatched: true });
    for (const id of [retrying, delivered]) {
      const res = await admin.post(`/admin/outbox/${id}/requeue`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('outbox_not_parked');
      expect(await requeueAudits(id)).toHaveLength(0);
    }
    expect(await attemptsOf(retrying)).toBe(2);

    const missing = await admin.post(`/admin/outbox/00000000-0000-4000-8000-000000000000/requeue`);
    expect(missing.status).toBe(404);
  });
});
