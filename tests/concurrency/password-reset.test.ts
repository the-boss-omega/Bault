import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import { BASE, SEED, signIn, type Client } from '../integration/helpers/http';
import { closeDb, sql } from '../integration/helpers/db';

afterAll(closeDb);

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;

async function fixtureAccount(): Promise<string> {
  const tag = randomBytes(5).toString('hex');
  const email = `reset-${tag}@fixture.bault.test`;
  await sql(
    `INSERT INTO user_account (email, username, password_hash, status, role, first_name, last_name, terms_version, terms_accepted_at)
     SELECT $1, $2, password_hash, 'active', 'user', 'Reset', 'Fixture', terms_version, terms_accepted_at
       FROM user_account WHERE email = $3`,
    [email, `rs${tag}`, SEED.collector],
  );
  return email;
}

describe('one reset link used twice at once', () => {
  it('changes the password once and refuses the rest', async () => {
    const email = await fixtureAccount();
    const [user] = await sql<{ id: string }>(`SELECT id::text AS id FROM user_account WHERE email = $1`, [email]);
    const raw = randomBytes(32).toString('hex');
    await sql(
      `INSERT INTO verification_token (user_id, type, token_hash, expires_at)
       VALUES ($1, 'password_reset', $2, now() + interval '1 hour')`,
      [user!.id, createHash('sha256').update(raw).digest('hex')],
    );

    const reset = async (i: number) => {
      const res = await fetch(`${BASE}/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: raw, newPassword: `correct horse battery ${i}` }),
      });
      return { status: res.status, body: await res.json().catch(() => null), i } as Res & { i: number };
    };
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => reset(i)));

    const winners = results.filter(ok);
    expect(winners, JSON.stringify(results.map((r) => r.status))).toHaveLength(1);
    for (const r of results.filter((x) => !ok(x))) expect(r.status).toBeGreaterThanOrEqual(400);
    for (const r of results.filter((x) => !ok(x))) expect(r.status).toBeLessThan(500);

    const winner = (winners[0] as Res & { i: number }).i;
    await expect(signIn(email, `correct horse battery ${winner}`)).resolves.toBeDefined();
    for (const r of results) {
      if (r.i === winner) continue;
      await expect(signIn(email, `correct horse battery ${r.i}`)).rejects.toThrow();
    }
  });
});
