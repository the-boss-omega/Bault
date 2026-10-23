#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { apiBase, argValue, credentials, hasFlag, prompt, Session } from './session.mjs';

const say = (msg = '') => process.stdout.write(`${msg}\n`);

export const MIX = [
  { name: 'browse listings', weight: 30, path: () => '/marketplace/listings?limit=24' },
  { name: 'listing detail', weight: 20, needs: 'listing', path: (ctx) => `/marketplace/listings/${pick(ctx.listings)}` },
  { name: 'price list', weight: 10, path: () => '/pricing/list' },
  { name: 'membership tiers', weight: 5, path: () => '/membership/tiers' },
  { name: 'vault items', weight: 15, signedIn: true, path: () => '/vault/items' },
  { name: 'wallet', weight: 15, signedIn: true, path: () => '/finance/wallet' },
  { name: 'ledger', weight: 5, signedIn: true, path: () => '/finance/ledger' },
];

export const AUTH_LIMIT_PER_MINUTE = 30;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function chooser(mix, ctx) {
  const usable = mix.filter((m) => !(m.needs === 'listing' && ctx.listings.length === 0));
  const total = usable.reduce((s, m) => s + m.weight, 0);
  return (r = Math.random()) => {
    let x = r * total;
    for (const m of usable) {
      x -= m.weight;
      if (x < 0) return m;
    }
    return usable[usable.length - 1];
  };
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(samples) {
  const by = new Map();
  for (const s of samples) {
    if (!by.has(s.name)) by.set(s.name, []);
    by.get(s.name).push(s);
  }
  const row = (name, list) => {
    const ms = list.map((s) => s.ms).sort((a, b) => a - b);
    const errors = list.filter((s) => !s.ok).length;
    return {
      name,
      count: list.length,
      errors,
      throttled: list.filter((s) => s.status === 429).length,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      p99: percentile(ms, 99),
      errorRate: list.length === 0 ? 0 : errors / list.length,
    };
  };
  return { rows: [...by].map(([name, list]) => row(name, list)), overall: row('all', samples) };
}

export function verdict(summary, { maxP95, maxErrorRate }) {
  const problems = [];
  const { overall } = summary;
  if (overall.count === 0) problems.push('no request completed');
  if (overall.p95 !== null && overall.p95 > maxP95) problems.push(`p95 ${overall.p95} ms is over ${maxP95} ms`);
  if (overall.errorRate > maxErrorRate) {
    problems.push(`${(overall.errorRate * 100).toFixed(2)}% of requests failed, over ${(maxErrorRate * 100).toFixed(2)}%`);
  }
  return problems;
}

async function timed(session, name, method, path, body) {
  const start = performance.now();
  try {
    const res = await session.request(method, path, body);
    return { name, ms: Math.round(performance.now() - start), status: res.status, ok: res.status >= 200 && res.status < 300 };
  } catch {
    return { name, ms: Math.round(performance.now() - start), status: 'network', ok: false };
  }
}

async function signInOnce(base, identifier, password) {
  const s = new Session(base);
  const res = await s.post('/auth/login', { identifier, password });
  if (res.status !== 200) throw new Error(`The load-test account could not sign in (${res.status}).`);
  if (res.body?.status === 'mfa_required') {
    throw new Error('The load-test account has two-factor on. Use a collector account without it.');
  }
  return s;
}

function number(argv, name, fallback) {
  const raw = argValue(argv, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

const USAGE = `Usage: pnpm ops:load-test --url https://<staging site> --target staging --rps <n> [--duration 60]
                         [--sign-ins-per-minute 6] [--max-p95 1000] [--max-error-rate 0.01]

Sends a steady mix of public reads, a collector's vault and wallet reads, and a
trickle of sign-ins, at --rps requests a second, then reports p50, p95 and p99
and the error rate. It signs in as BAULT_LOADTEST_IDENTIFIER and
BAULT_LOADTEST_PASSWORD (or asks): a collector account on staging, without
two-factor.

The API limits each address to RATE_LIMIT_PER_MINUTE requests a minute (300 by
default, 5 a second) and AUTH_RATE_LIMIT_PER_MINUTE sign-ins (30). From one
machine, raise RATE_LIMIT_PER_MINUTE on staging for the test, or every request
past the limit is a 429 and counts as an error. Set it back afterwards.`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (hasFlag(argv, '--help')) {
    say(USAGE);
    return 0;
  }
  if (argValue(argv, '--target') !== 'staging') {
    say('Refusing to run: a load test is for staging. Pass --target staging to confirm that --url is staging.');
    return 2;
  }
  const base = apiBase(argValue(argv, '--url'));
  const rpsRaw = argValue(argv, '--rps');
  if (rpsRaw === undefined) throw new Error('--rps is required: three times the busiest second you expect.');
  const rps = number(argv, '--rps');
  const duration = number(argv, '--duration', 60);
  const signInsPerMinute = number(argv, '--sign-ins-per-minute', 6);
  const maxP95 = number(argv, '--max-p95', 1000);
  const maxErrorRate = Number(argValue(argv, '--max-error-rate') ?? 0.01);
  if (signInsPerMinute >= AUTH_LIMIT_PER_MINUTE) {
    throw new Error(`--sign-ins-per-minute must stay under the auth limit of ${AUTH_LIMIT_PER_MINUTE} a minute.`);
  }

  const { identifier, password } = await credentials(env, prompt, 'LOADTEST');
  const reader = await signInOnce(base, identifier, password);
  const anonymous = new Session(base);
  const listed = await anonymous.get('/marketplace/listings?limit=50');
  const ctx = { listings: Array.isArray(listed.body) ? listed.body.map((l) => l.id) : [] };
  const next = chooser(MIX, ctx);

  say(`Load test against ${base}: ${rps} requests a second for ${duration} s, ${signInsPerMinute} sign-ins a minute.`);
  if (ctx.listings.length === 0) say('No active listings to read; the listing-detail share goes to the other reads.');

  const samples = [];
  const inFlight = new Set();
  const maxInFlight = Math.max(50, Math.ceil(rps * 10));
  const started = performance.now();
  const end = started + duration * 1000;
  let fired = 0;
  let dropped = 0;

  const fire = (promise) => {
    inFlight.add(promise);
    promise.then((s) => {
      samples.push(s);
      inFlight.delete(promise);
    });
  };

  const signIns = (async () => {
    const gap = 60_000 / signInsPerMinute;
    for (let t = started + gap / 2; t < end; t += gap) {
      await sleep(Math.max(0, t - performance.now()));
      const s = new Session(base);
      const login = await timed(s, 'sign in', 'POST', '/auth/login', { identifier, password });
      samples.push(login);
      if (login.ok) samples.push(await timed(s, 'sign out', 'POST', '/auth/logout', {}));
    }
  })();

  while (performance.now() < end) {
    const due = started + (fired * 1000) / rps;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    fired += 1;
    if (inFlight.size >= maxInFlight) {
      dropped += 1;
      samples.push({ name: 'not sent (too many in flight)', ms: 0, status: 'dropped', ok: false });
      continue;
    }
    const m = next();
    fire(timed(m.signedIn ? reader : anonymous, m.name, 'GET', m.path(ctx)));
  }
  await signIns;
  await Promise.all([...inFlight]);

  const summary = summarize(samples);
  say('');
  say('request                          count  errors   p50 ms   p95 ms   p99 ms');
  for (const r of [...summary.rows, summary.overall]) {
    say(
      `${r.name.padEnd(32)} ${String(r.count).padStart(5)} ${String(r.errors).padStart(7)} ${String(r.p50 ?? '-').padStart(8)} ${String(r.p95 ?? '-').padStart(8)} ${String(r.p99 ?? '-').padStart(8)}`,
    );
  }
  const elapsed = (performance.now() - started) / 1000;
  say('');
  say(`Sent ${fired - dropped} requests in ${elapsed.toFixed(1)} s (${((fired - dropped) / elapsed).toFixed(1)} a second).`);
  if (summary.overall.throttled > 0) {
    say(`${summary.overall.throttled} answered 429: the rate limiter, not the server, stopped them. Raise RATE_LIMIT_PER_MINUTE on staging for the test.`);
  }
  const problems = verdict(summary, { maxP95, maxErrorRate });
  if (problems.length === 0) {
    say(`PASSED: p95 ${summary.overall.p95} ms (limit ${maxP95}), errors ${(summary.overall.errorRate * 100).toFixed(2)}% (limit ${(maxErrorRate * 100).toFixed(2)}%).`);
    return 0;
  }
  for (const p of problems) say(`FAILED: ${p}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`load-test: ${e.message}\n`);
      process.exit(1);
    },
  );
}
