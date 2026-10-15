import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Client, SEED, SEED_PASSWORD, fixtureEmail, signIn } from '../../tests/integration/helpers/http';

/**
 * Signing in, from the side of somebody guessing (E13, N5, N10).
 *
 * An identifier that matched no account skipped `argon2.verify` and was refused
 * in a few milliseconds, against a couple of hundred for a real one — so the
 * time it took to say "invalid credentials" said which accounts exist. And a
 * single account could be guessed at for as long as the per-IP rate limit
 * allowed, by anyone with more than one address.
 *
 * Every account these tests guess against is a fixture registered here, or an
 * identifier nobody owns. The lockout is real and is not switched off for
 * tests: a suite that pointed ten wrong passwords at a seeded account would
 * lock it for every suite after it.
 */

const PASSWORD = 'correct horse battery';

/** A fresh account. Pending — the password is checked before the status is. */
async function register(label: string): Promise<{ email: string; username: string }> {
  const email = fixtureEmail(label);
  const username = `${label.slice(0, 6)}${randomBytes(5).toString('hex')}`;
  const res = await new Client().post('/auth/register', {
    email,
    username,
    firstName: 'Sign',
    lastName: 'In',
    password: PASSWORD,
  });
  expect(res.status).toBe(201);
  return { email, username };
}

const nobody = (label: string) => `nobody-${label}-${randomBytes(6).toString('hex')}`;

async function attempt(identifier: string, password: string) {
  const started = performance.now();
  const res = await new Client().post('/auth/login', { identifier, password });
  return { status: res.status, body: res.body, ms: performance.now() - started };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/* ============================================================
   E13 — the time a refusal takes says nothing
   ============================================================ */

describe('how long a wrong sign-in takes', () => {
  it('is the same whether or not the identifier belongs to anybody', async () => {
    // Twenty attempts each side, spread over four identifiers per side so none
    // of them gets near the lockout, interleaved so a slow moment on the
    // machine lands on both sides, and with the order of each pair alternating
    // so whichever side goes second does not always get the warmer machine.
    const known = await Promise.all([1, 2, 3, 4].map((i) => register(`time${i}`)));
    const unknown = [1, 2, 3, 4].map((i) => nobody(`time${i}`));

    // One of each first, so neither side pays for a cold path alone.
    await attempt(known[0]!.username, 'wrong-password');
    await attempt(unknown[0]!, 'wrong-password');

    const knownMs: number[] = [];
    const unknownMs: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      for (let i = 0; i < 4; i += 1) {
        const knownFirst = (round + i) % 2 === 0;
        const first = await attempt(knownFirst ? known[i]!.username : unknown[i]!, `wrong-${round}`);
        const second = await attempt(knownFirst ? unknown[i]! : known[i]!.username, `wrong-${round}`);
        const [k, u] = knownFirst ? [first, second] : [second, first];
        expect(k.status).toBe(401);
        expect(u.status).toBe(401);
        knownMs.push(k.ms);
        unknownMs.push(u.ms);
      }
    }

    const gap = Math.abs(mean(knownMs) - mean(unknownMs));
    expect(gap, `known ${mean(knownMs).toFixed(1)} ms, unknown ${mean(unknownMs).toFixed(1)} ms`).toBeLessThan(50);
  }, 120_000);
});

/* ============================================================
   Per-identifier lockout
   ============================================================ */

describe('guessing at one identifier', () => {
  it('is refused for fifteen minutes after ten failures — even with the right password', async () => {
    const { username } = await register('lock');
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt(username, `guess-${i}`)).status).toBe(401);
    }
    // The right password, now. Letting it through would make the lockout a
    // signal ("the one that worked") rather than a stop.
    const eleventh = await attempt(username, PASSWORD);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe('rate_limited');
    expect(eleventh.body.error.message).toMatch(/15 minutes|minutes/);
  }, 60_000);

  it('behaves identically for an identifier nobody owns, so the lockout reveals nothing', async () => {
    const { username } = await register('lockk');
    const stranger = nobody('lock');
    const answers: Record<string, { status: number; message: string }> = {};
    for (const id of [username, stranger]) {
      for (let i = 0; i < 10; i += 1) expect((await attempt(id, `guess-${i}`)).status).toBe(401);
      const locked = await attempt(id, 'one-more');
      answers[id] = { status: locked.status, message: String(locked.body.error.message).replace(/\d+/g, 'N') };
    }
    expect(answers[stranger]).toEqual(answers[username]);
    expect(answers[stranger]!.status).toBe(429);
  }, 60_000);

  it('counts guesses sent all at once: twenty in parallel still get ten tries', async () => {
    // Read-the-count-then-verify, unserialised, lets every request in a burst
    // read "fewer than ten" before any of them has written its failure.
    const target = nobody('burst');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt(target, `burst-${i}`)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10);
  }, 60_000);

  it('leaves every other identifier alone', async () => {
    const target = nobody('other');
    for (let i = 0; i < 10; i += 1) await attempt(target, `guess-${i}`);
    expect((await attempt(target, 'x')).status).toBe(429);
    // A seeded account somebody else is guessing at nothing to do with.
    await signIn(SEED.collector2, SEED_PASSWORD);
  }, 60_000);
});
