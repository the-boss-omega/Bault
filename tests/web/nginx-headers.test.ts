import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(__dirname, '..', '..');
const WEB = join(ROOT, 'apps', 'web');
const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

function code(conf: string): string {
  return conf
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

function locations(conf: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = [];
  const re = /location\s+[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(conf))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < conf.length && depth > 0) {
      if (conf[i] === '$' && conf[i + 1] === '{') {
        i = conf.indexOf('}', i) + 1;
        continue;
      }
      if (conf[i] === '{') depth += 1;
      if (conf[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({ head: m[0].trim(), body: conf.slice(start, i - 1) });
  }
  return out;
}

describe('web nginx security headers', () => {
  const conf = code(read(WEB, 'nginx.conf'));
  const dockerfile = read(WEB, 'Dockerfile');
  const include = conf.match(/include\s+(\S+security-headers\.conf);/)?.[1];

  it('includes one shared header file at the server level and in every location', () => {
    expect(include, 'nginx.conf includes a security-headers file').toBeDefined();
    const all = locations(conf);
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const { head, body } of all) {
      expect(body, `${head} drops the server-level headers`).toContain(`include ${include};`);
    }
    const serverLevel = all.reduce((rest, { body }) => rest.replace(body, ''), conf);
    expect(serverLevel).toContain(`include ${include};`);
  });

  it('sets no security header in nginx.conf itself, only in the shared file', () => {
    const own = [...conf.matchAll(/add_header\s+(\S+)/g)].map((m) => m[1]);
    expect(own.every((h) => h === 'Cache-Control'), `nginx.conf sets ${own.join(', ')}`).toBe(true);
  });

  it('renders the included file from the template the Dockerfile installs', () => {
    const rendered = include!.replace('/etc/nginx/conf.d/', '/etc/nginx/templates/') + '.template';
    expect(dockerfile).toContain(`nginx-security-headers.conf ${rendered}`);
    expect(dockerfile).toMatch(/nginx-storage-origin\.envsh \/docker-entrypoint\.d\/\S+\.envsh/);
    expect(dockerfile).toMatch(/nginx-error-reports-origin\.envsh \/docker-entrypoint\.d\/\S+\.envsh/);
    expect(dockerfile).toMatch(/NGINX_ENVSUBST_FILTER=.*ERROR_REPORTS_ORIGIN/);
  });

  it('sends CSP, frame and sniffing protection on every response, and the storage origin in the CSP', () => {
    const headers = code(read(WEB, 'nginx-security-headers.conf'));
    for (const name of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      expect(headers, name).toMatch(new RegExp(`add_header ${name} "[^"]+" always;`));
    }
    const csp = headers.match(/Content-Security-Policy "([^"]+)"/)![1]!;
    const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('img-src')).toContain('${STORAGE_PUBLIC_ORIGIN}');
    expect(directive('media-src')).toContain('${STORAGE_PUBLIC_ORIGIN}');
    expect(headers).not.toMatch(/Strict-Transport-Security/i);
    expect(conf).not.toMatch(/Strict-Transport-Security/i);
  });

  it('runs no PayPal script and frames no PayPal page: a cash-in by PayPal leaves for paypal.com and comes back', () => {
    const headers = code(read(WEB, 'nginx-security-headers.conf'));
    const csp = headers.match(/Content-Security-Policy "([^"]+)"/)![1]!;
    const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('connect-src')).toBe("connect-src 'self' ${ERROR_REPORTS_ORIGIN}");
    expect(directive('frame-src')).toBeUndefined();
    expect(directive('child-src')).toBeUndefined();
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(csp).not.toMatch(/paypal/i);

    const index = read(WEB, 'index.html');
    expect(index).not.toMatch(/paypal/i);
  });

  it('lets the page reach only the error-report host named by the DSN it was built with, and none without one', () => {
    const script = join(WEB, 'nginx-error-reports-origin.envsh');
    const origin = (dsn: string) =>
      spawnSync('sh', ['-c', `. "${script}" && printf '%s' "$ERROR_REPORTS_ORIGIN"`], {
        env: { PATH: process.env.PATH, WEB_SENTRY_DSN: dsn },
        encoding: 'utf8',
      });
    expect(origin('').stdout).toBe('');
    expect(origin('https://publickey@o45.ingest.us.sentry.io/678').stdout).toBe('https://o45.ingest.us.sentry.io');
    expect(origin('https://publickey@reports.example.com:8443/9').stdout).toBe('https://reports.example.com:8443');
    for (const bad of ['http://publickey@o45.ingest.sentry.io/1', 'https://k@x.example;script-src *.evil/1', 'nonsense']) {
      const run = origin(bad);
      expect(run.status, bad).not.toBe(0);
      expect(run.stderr).toMatch(/refusing to start/);
    }
  });

  it("appends to X-Forwarded-For rather than replacing it with the proxy's own address", () => {
    const api = locations(conf).find(({ head }) => head.startsWith('location /api/'))!;
    expect(api.body).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
    expect(api.body).not.toMatch(/X-Forwarded-For\s+\$remote_addr/);
  });
});
