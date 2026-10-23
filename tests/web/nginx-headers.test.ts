import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it("appends to X-Forwarded-For rather than replacing it with the proxy's own address", () => {
    const api = locations(conf).find(({ head }) => head.startsWith('location /api/'))!;
    expect(api.body).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
    expect(api.body).not.toMatch(/X-Forwarded-For\s+\$remote_addr/);
  });
});
