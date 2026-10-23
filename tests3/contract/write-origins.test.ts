import { beforeAll, describe, expect, it } from 'vitest';

let csrf: typeof import('../../apps/api/src/shared/csrf/cross-site');

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  csrf = await import('../../apps/api/src/shared/csrf/cross-site');
});

const PREVIEW = ['http://localhost:4173', 'http://127.0.0.1:4173'];

function passes(allowed: ReadonlySet<string>, origin: string): boolean {
  let error: unknown;
  const middleware = csrf.sameOriginWrites(allowed, []);
  middleware(
    { method: 'POST', path: '/api/v1/auth/login', headers: { origin } } as never,
    {} as never,
    (err?: unknown) => {
      error = err;
    },
  );
  return error === undefined;
}

describe('write origins', () => {
  it('allow the preview server in development', () => {
    const allowed = csrf.writeOrigins('http://localhost:5173', '', 'development');
    for (const origin of PREVIEW) expect(passes(allowed, origin), origin).toBe(true);
    expect(passes(allowed, 'http://localhost:5173')).toBe(true);
  });

  it('add nothing in production or under test: the configured list only', () => {
    for (const nodeEnv of ['production', 'test']) {
      const allowed = csrf.writeOrigins(
        'https://app.example.com',
        'https://admin.example.com',
        nodeEnv,
      );
      expect([...allowed].sort()).toEqual(['https://admin.example.com', 'https://app.example.com']);
      for (const origin of PREVIEW)
        expect(passes(allowed, origin), `${nodeEnv} ${origin}`).toBe(false);
    }
  });

  it('allow a tunnel link named in CORS_ORIGINS, and still refuse every other site', () => {
    const allowed = csrf.writeOrigins(
      'http://localhost:5173',
      'https://quiet-fox.trycloudflare.com',
      'development',
    );
    expect(passes(allowed, 'https://quiet-fox.trycloudflare.com')).toBe(true);
    expect(passes(allowed, 'https://other-fox.trycloudflare.com')).toBe(false);
    expect(passes(allowed, 'http://localhost:4174')).toBe(false);
    expect(passes(allowed, 'null')).toBe(false);
  });
});
