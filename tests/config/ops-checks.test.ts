import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  docsVerdict,
  gradeHeaders,
  parseNmap,
  sslLabsVerdict,
  unexpectedPorts,
} from '../../scripts/ops/security-check.mjs';
import { chooser, MIX, percentile, summarize, verdict } from '../../scripts/ops/load-test.mjs';

const ROOT = join(__dirname, '..', '..');

function shippedHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  const nginx = readFileSync(join(ROOT, 'apps', 'web', 'nginx-security-headers.conf'), 'utf8');
  for (const m of nginx.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"/gm)) out[m[1]!.toLowerCase()] = m[2]!;
  const caddy = readFileSync(join(ROOT, 'infra', 'production', 'Caddyfile'), 'utf8');
  const hsts = /Strict-Transport-Security\s+"([^"]+)"/.exec(caddy);
  out['strict-transport-security'] = hsts![1]!;
  return out;
}

describe('scripts/ops/security-check.mjs', () => {
  it('grades the headers Caddy and nginx ship at A, the grade Day 6 asks for', () => {
    const g = gradeHeaders(shippedHeaders());
    expect(g.missing).toEqual([]);
    expect(['A', 'A+']).toContain(g.grade);
  });

  it('drops a grade for each missing header and notes what leaks', () => {
    const all = shippedHeaders();
    const { 'permissions-policy': _p, 'referrer-policy': _r, ...two } = all;
    expect(gradeHeaders(two).grade).toBe('C');
    expect(gradeHeaders(two).missing).toEqual(['referrer-policy', 'permissions-policy']);
    expect(gradeHeaders({}).grade).toBe('F');
    const leaky = gradeHeaders({ ...all, 'x-powered-by': 'Express', server: 'nginx/1.27.3' });
    expect(leaky.warnings.join(' ')).toMatch(/X-Powered-By/);
    expect(leaky.warnings.join(' ')).toMatch(/version/);
    expect(gradeHeaders(new Headers(all)).grade).toBe(gradeHeaders(all).grade);
  });

  it('tells docs behind a password and docs not served from docs anybody can read', () => {
    expect(docsVerdict({ status: 401 })).toBe('password');
    expect(docsVerdict({ status: 404 })).toBe('absent');
    expect(docsVerdict({ status: 200, contentType: 'text/html', body: '<!doctype html><div id="root"></div>' })).toBe('absent');
    expect(docsVerdict({ status: 200, contentType: 'text/html', body: '<div id="swagger-ui"></div>' })).toBe('exposed');
    expect(docsVerdict({ status: 200, contentType: 'application/json', body: '{"openapi":"3.0.0","paths":{}}' })).toBe('exposed');
    expect(docsVerdict({ status: 200, contentType: 'text/yaml', body: 'openapi: 3.0.0\npaths: {}' })).toBe('exposed');
  });

  it('reads open ports from nmap and names the unexpected ones', () => {
    const out = [
      'Nmap scan report for bault.example (203.0.113.7)',
      'PORT    STATE SERVICE',
      '22/tcp  open  ssh',
      '80/tcp  open  http',
      '443/tcp open  https',
      '5432/tcp filtered postgresql',
    ].join('\n');
    expect(parseNmap(out)).toEqual([22, 80, 443]);
    expect(unexpectedPorts([22, 80, 443], new Set([80, 443]))).toEqual([22]);
    expect(unexpectedPorts([22, 80, 443], new Set([22, 80, 443]))).toEqual([]);
  });

  it('passes SSL Labs only at A or A+ on every endpoint', () => {
    expect(sslLabsVerdict({ endpoints: [{ grade: 'A+' }, { grade: 'A' }] }).ok).toBe(true);
    expect(sslLabsVerdict({ endpoints: [{ grade: 'A' }, { grade: 'A-' }] }).ok).toBe(false);
    expect(sslLabsVerdict({ endpoints: [{ grade: 'T' }] }).ok).toBe(false);
    expect(sslLabsVerdict({ endpoints: [] }).ok).toBe(false);
  });
});

describe('scripts/ops/load-test.mjs', () => {
  it('refuses to run unless told the target is staging', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'ops', 'load-test.mjs'), '--url', 'https://bault.example', '--rps', '5'], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/--target staging/);
  });

  it('reports nearest-rank percentiles and the error rate, and fails past the limits', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([], 50)).toBeNull();
    const samples = [
      ...Array.from({ length: 98 }, (_, i) => ({ name: 'browse listings', ms: i + 1, status: 200, ok: true })),
      { name: 'wallet', ms: 5000, status: 500, ok: false },
      { name: 'wallet', ms: 99, status: 429, ok: false },
    ];
    const s = summarize(samples);
    expect(s.overall.count).toBe(100);
    expect(s.overall.errors).toBe(2);
    expect(s.overall.throttled).toBe(1);
    expect(s.overall.p95).toBe(95);
    expect(verdict(s, { maxP95: 1000, maxErrorRate: 0.05 })).toEqual([]);
    expect(verdict(s, { maxP95: 50, maxErrorRate: 0.01 })).toHaveLength(2);
  });

  it('leaves out listing detail when there is no listing to read', () => {
    const none = chooser(MIX, { listings: [] });
    for (let r = 0; r < 1; r += 0.01) expect(none(r).name).not.toBe('listing detail');
    const some = chooser(MIX, { listings: ['x'] });
    const names = new Set(Array.from({ length: 100 }, (_, i) => some(i / 100).name));
    expect(names).toContain('listing detail');
    expect(names).toContain('vault items');
  });
});
