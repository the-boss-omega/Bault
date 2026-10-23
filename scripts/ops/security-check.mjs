#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { apiBase, argValue, credentials, hasFlag, prompt, Session } from './session.mjs';

const say = (msg = '') => process.stdout.write(`${msg}\n`);

export const HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

export const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587, 993, 995, 1433, 1521, 2049, 2375, 2376,
  2379, 3000, 3306, 3389, 4222, 5000, 5432, 5672, 5900, 6379, 6432, 8000, 8008, 8080, 8081, 8443, 8888, 9000,
  9001, 9090, 9200, 9300, 11211, 15672, 27017,
];

export const DOCS_PATHS = ['/docs', '/docs-json', '/docs-yaml', '/api/docs', '/api/v1/docs', '/api/v1/docs-json'];

const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];

function header(headers, name) {
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? null : headers[key];
}

export function gradeHeaders(headers) {
  const missing = HEADERS.filter((h) => !header(headers, h));
  const warnings = [];
  const hsts = header(headers, 'strict-transport-security') ?? '';
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0);
  if (hsts && maxAge < 31_536_000) warnings.push(`HSTS max-age is ${maxAge}, under a year`);
  const csp = header(headers, 'content-security-policy') ?? '';
  if (/'unsafe-eval'/.test(csp)) warnings.push("the CSP allows 'unsafe-eval'");
  if (/'unsafe-inline'/.test(csp)) warnings.push("the CSP allows 'unsafe-inline'");
  if (header(headers, 'x-powered-by')) warnings.push(`X-Powered-By says ${header(headers, 'x-powered-by')}`);
  const server = header(headers, 'server');
  if (server && /\d/.test(server)) warnings.push(`Server names a version: ${server}`);
  const nosniff = header(headers, 'x-content-type-options');
  if (nosniff && nosniff.toLowerCase() !== 'nosniff') warnings.push(`X-Content-Type-Options is ${nosniff}, not nosniff`);
  const grade = GRADES[Math.min(missing.length, GRADES.length - 1)];
  return { grade: grade === 'A' && warnings.length === 0 ? 'A+' : grade, missing, warnings };
}

export function docsVerdict({ status, contentType = '', body = '' }) {
  if (status === 401 || status === 403) return 'password';
  if (status === 404 || status >= 500) return 'absent';
  if (status >= 300 && status < 400) return 'absent';
  if (/swagger-ui|"openapi"\s*:|^openapi:\s/m.test(body)) return 'exposed';
  if (/json|yaml/.test(contentType) && /"paths"\s*:|^paths:/m.test(body)) return 'exposed';
  return 'absent';
}

export function parseNmap(output) {
  const open = [];
  for (const line of output.split('\n')) {
    const m = /^(\d+)\/tcp\s+open\b/.exec(line.trim());
    if (m) open.push(Number(m[1]));
  }
  return open;
}

export function unexpectedPorts(open, allowed) {
  return open.filter((p) => !allowed.has(p)).sort((a, b) => a - b);
}

export function sslLabsVerdict(report) {
  const endpoints = report?.endpoints ?? [];
  if (endpoints.length === 0) return { ok: false, detail: 'SSL Labs returned no endpoints' };
  const grades = endpoints.map((e) => e.grade ?? e.statusMessage ?? '?');
  const ok = grades.every((g) => g === 'A' || g === 'A+');
  return { ok, detail: `grade ${[...new Set(grades)].join(', ')}${ok ? '' : ' (A or A+ needed)'}` };
}

async function sslLabs(host, env) {
  const email = env.SSLLABS_EMAIL;
  const root = email ? 'https://api.ssllabs.com/api/v4/analyze' : 'https://api.ssllabs.com/api/v3/analyze';
  const headers = email ? { email } : {};
  let url = `${root}?host=${encodeURIComponent(host)}&startNew=on&all=done`;
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`SSL Labs answered ${res.status}${email ? '' : '; it may need SSLLABS_EMAIL (API v4 registration)'}`);
    const report = await res.json();
    if (report.status === 'READY') return report;
    if (report.status === 'ERROR') throw new Error(report.statusMessage ?? 'SSL Labs could not test the host');
    url = `${root}?host=${encodeURIComponent(host)}&all=done`;
    await sleep(15_000);
  }
  throw new Error('SSL Labs took longer than 8 minutes');
}

function handshake(host, options) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000, rejectUnauthorized: false, ...options }, () => {
      const cert = socket.getPeerCertificate();
      resolve({ ok: true, authorized: socket.authorized, error: socket.authorizationError, protocol: socket.getProtocol(), cert });
      socket.end();
    });
    socket.on('error', (e) => resolve({ ok: false, error: e.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'timed out' });
    });
  });
}

function connects(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function openPorts(host) {
  const nmap = spawnSync('nmap', ['--version'], { encoding: 'utf8' });
  if (nmap.status === 0) {
    const scan = spawnSync('nmap', ['-Pn', '-T4', '--top-ports', '1000', '--open', host], { encoding: 'utf8', timeout: 600_000 });
    if (scan.status === 0) return { how: 'nmap, the 1000 most common ports', open: parseNmap(scan.stdout) };
  }
  const open = [];
  for (let i = 0; i < COMMON_PORTS.length; i += 16) {
    const batch = COMMON_PORTS.slice(i, i + 16);
    const hits = await Promise.all(batch.map((p) => connects(host, p)));
    batch.forEach((p, j) => hits[j] && open.push(p));
  }
  return { how: `a connect scan of ${COMMON_PORTS.length} common ports (install nmap for a wider one)`, open };
}

export async function adminNeedsCode(base, { identifier, password }) {
  const s = new Session(base);
  const res = await s.post('/auth/login', { identifier, password });
  if (res.status !== 200) return { ok: false, detail: `the sign-in itself was refused (${res.status}); check the account` };
  if (res.body?.status === 'mfa_required' && !s.signedIn) {
    return { ok: true, detail: 'the password alone opens no session; the code is asked for' };
  }
  if (res.body?.role && res.body.role !== 'admin') return { ok: false, detail: `that account is a ${res.body.role}, not an administrator` };
  return {
    ok: false,
    detail: res.body?.mfaEnrollmentRequired
      ? 'the administrator has not enrolled two-factor: the password alone opened a session'
      : 'the password alone opened an administrator session',
  };
}

async function get(url, init = {}) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init });
  return { status: res.status, headers: res.headers, contentType: res.headers.get('content-type') ?? '', body: await res.text() };
}

const USAGE = `Usage: pnpm ops:security-check --url https://<site> [--skip-ssllabs] [--from-admin-ip] [--skip-admin]

Checks, from outside, what Day 6 lists: the redirect to HTTPS, TLS (locally, and
graded by SSL Labs), the security headers, that the API docs are not served
without a password, which ports answer, and that an administrator's password
alone opens no session. The last check signs in with BAULT_ADMIN_IDENTIFIER and
BAULT_ADMIN_PASSWORD (or asks) and never sends a code.

  --skip-ssllabs   skip the SSL Labs grade (it takes a few minutes; SSLLABS_EMAIL selects its v4 API)
  --from-admin-ip  this machine is ADMIN_IP, so port 22 answering is expected
  --skip-admin     skip the administrator sign-in check`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (hasFlag(argv, '--help')) {
    say(USAGE);
    return 0;
  }
  const base = apiBase(argValue(argv, '--url'));
  const site = new URL(argValue(argv, '--url'));
  const host = site.hostname;
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    say(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  };

  say(`Security check of ${site.origin}`);

  try {
    const plain = await get(`http://${host}/`);
    const location = plain.headers.get('location') ?? '';
    record(
      'HTTP redirects to HTTPS',
      [301, 308].includes(plain.status) && location.startsWith(`https://${host}`),
      `${plain.status} ${location || '(no Location)'}`,
    );
  } catch (e) {
    record('HTTP redirects to HTTPS', false, e.message);
  }

  const modern = await handshake(host, {});
  if (!modern.ok) record('TLS', false, modern.error);
  else {
    const days = Math.floor((Date.parse(modern.cert.valid_to) - Date.now()) / 86_400_000);
    record(
      'TLS certificate',
      modern.authorized && days >= 14,
      modern.authorized ? `${modern.protocol}, valid for ${days} more days` : `not trusted: ${modern.error}`,
    );
  }
  if (!modern.ok) record('TLS 1.0 and 1.1 refused', null, 'not tested: nothing answers TLS on 443');
  else {
    const legacy = await handshake(host, { maxVersion: 'TLSv1.1', minVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' });
    record('TLS 1.0 and 1.1 refused', !legacy.ok, legacy.ok ? `the server accepted ${legacy.protocol}` : 'refused');
  }

  if (hasFlag(argv, '--skip-ssllabs')) record('SSL Labs grade', null, 'skipped (--skip-ssllabs)');
  else {
    try {
      say('      SSL Labs is testing the host; this takes a few minutes…');
      const v = sslLabsVerdict(await sslLabs(host, env));
      record('SSL Labs grade', v.ok, v.detail);
    } catch (e) {
      record('SSL Labs grade', false, `${e.message}. Test by hand at https://www.ssllabs.com/ssltest/ or pass --skip-ssllabs`);
    }
  }

  try {
    const page = await get(`${site.origin}/`);
    const asset = /\/assets\/[\w.-]+\.js/.exec(page.body)?.[0];
    const targets = [
      ['the page', page],
      ...(asset ? [['a script', await get(`${site.origin}${asset}`)]] : []),
      ['the API', await get(`${base}/readyz`)],
    ];
    for (const [what, res] of targets) {
      const g = gradeHeaders(res.headers);
      const notes = [...g.missing.map((m) => `missing ${m}`), ...g.warnings];
      record(`Security headers on ${what}`, g.grade === 'A' || g.grade === 'A+', `grade ${g.grade}${notes.length ? `: ${notes.join('; ')}` : ''}`);
    }
  } catch (e) {
    record('Security headers', false, e.message);
  }

  const docs = [];
  for (const path of DOCS_PATHS) {
    try {
      const res = await get(`${site.origin}${path}`);
      docs.push([path, docsVerdict(res)]);
    } catch (e) {
      docs.push([path, `error: ${e.message}`]);
    }
  }
  const exposed = docs.filter(([, v]) => v === 'exposed' || v.startsWith('error'));
  record(
    'API docs need a password',
    exposed.length === 0,
    exposed.length === 0
      ? docs.some(([, v]) => v === 'password')
        ? 'served only with the password'
        : 'not served at all'
      : `served without a password at ${exposed.map(([p, v]) => (v === 'exposed' ? p : `${p} (${v})`)).join(', ')}`,
  );

  const allowed = new Set([80, 443, ...(hasFlag(argv, '--from-admin-ip') ? [22] : [])]);
  const scan = await openPorts(host);
  const extra = unexpectedPorts(scan.open, allowed);
  const hint =
    extra.includes(22) && !allowed.has(22)
      ? ' If this machine is ADMIN_IP, 22 is the firewall admitting you: rerun with --from-admin-ip, and once from another network (a phone hotspot) to see it closed to everyone else.'
      : '';
  record(
    'Only 80 and 443 answer',
    extra.length === 0,
    `open: ${scan.open.join(', ') || 'none'} (${scan.how}).${extra.length ? ` Unexpected: ${extra.join(', ')}.${hint}` : ''}`,
  );

  if (hasFlag(argv, '--skip-admin')) record('Administrator sign-in needs the code', null, 'skipped (--skip-admin)');
  else {
    try {
      const v = await adminNeedsCode(base, await credentials(env, prompt, 'ADMIN'));
      record('Administrator sign-in needs the code', v.ok, v.detail);
    } catch (e) {
      record('Administrator sign-in needs the code', false, e.message);
    }
  }

  const failed = results.filter((r) => r.ok === false);
  say('');
  say(failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`security-check: ${e.message}\n`);
      process.exit(1);
    },
  );
}
