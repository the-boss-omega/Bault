import { EventEmitter } from 'node:events';
import { beforeAll, describe, it, expect } from 'vitest';

/**
 * What the API tells its operators about a request (step 15).
 *
 * Two gaps, both found by asking "how would we know?":
 *
 *  - A request left NO line at all unless something inside it logged. There was
 *    no status and no duration anywhere, so "the shelf page is slow" and "sign-in
 *    is returning 500s" could only be answered by reproducing them.
 *  - A 500 was logged to stdout and nowhere else. Nobody is paged by stdout.
 *
 * Unit-level: the middleware and the exception filter are driven directly, with
 * the error reporter replaced by a recorder, so this needs no server, no
 * database and no error-tracking account.
 */
type Reported = { error: unknown; request: { method?: string; url?: string } | undefined };

// JSON lines, the way every deployed environment writes them. Set before the
// config is first read; dotenv never overrides a variable that is already set.
process.env.NODE_ENV = 'test';

let logger: typeof import('../../apps/api/src/shared/observability/logger');
let filters: typeof import('../../apps/api/src/shared/errors/all-exceptions.filter');
let common: typeof import('../../apps/api/node_modules/@nestjs/common');

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  logger = await import('../../apps/api/src/shared/observability/logger');
  filters = await import('../../apps/api/src/shared/errors/all-exceptions.filter');
  common = await import('../../apps/api/node_modules/@nestjs/common');
});

/** Every line written to stdout and stderr while `fn` runs. */
async function captureOutput(fn: () => void | Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return lines;
}

function fakeExchange(method: string, url: string, statusCode = 200) {
  const res = Object.assign(new EventEmitter(), {
    statusCode,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    body: undefined as unknown,
    json(body: unknown) {
      this.body = body;
      return this;
    },
  });
  const req = { method, url, originalUrl: url, headers: {}, body: { password: 'hunter2' } };
  return { req, res };
}

describe('the request log', () => {
  it('writes one line per request with its status and how long it took', async () => {
    const { req, res } = fakeExchange('GET', '/api/v1/vault/items?cursor=abc', 200);
    const lines = await captureOutput(async () => {
      logger.requestContext(req as never, res as never, () => undefined);
      await new Promise((r) => setTimeout(r, 15));
      res.emit('finish');
    });
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => 'duration_ms' in l);
    expect(line, lines.join('\n')).toBeTruthy();
    expect(line!.status).toBe(200);
    expect(line!.method).toBe('GET');
    expect(typeof line!.duration_ms).toBe('number');
    expect(line!.duration_ms as number).toBeGreaterThanOrEqual(10);
    expect(line!.level).toBe('info');
    expect(typeof line!.requestId).toBe('string');
    // The query string is left out: on some routes it is where a token travels.
    expect(line!.path).toBe('/api/v1/vault/items');
    expect(JSON.stringify(line)).not.toContain('cursor=abc');
  });

  it('logs a server error at error level', async () => {
    const { req, res } = fakeExchange('POST', '/api/v1/vault/items', 500);
    const lines = await captureOutput(() => {
      logger.requestContext(req as never, res as never, () => undefined);
      res.emit('finish');
    });
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => 'duration_ms' in l);
    expect(line?.level).toBe('error');
    expect(line?.status).toBe(500);
  });
});

describe('the exception filter', () => {
  const run = async (exception: unknown, url = '/api/v1/vault/items') => {
    const reported: Reported[] = [];
    const filter = new filters.AllExceptionsFilter((error, request) => reported.push({ error, request }));
    const { req, res } = fakeExchange('POST', url);
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    };
    await captureOutput(() => filter.catch(exception, host as never));
    return { reported, status: res.statusCode };
  };

  it('reports an unexpected error to the error tracker, with the request it broke', async () => {
    const boom = new Error('unexpected');
    const { reported, status } = await run(boom);
    expect(status).toBe(500);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.error).toBe(boom);
    expect(reported[0]!.request).toMatchObject({ method: 'POST', url: '/api/v1/vault/items' });
  });

  it('reports a 5xx raised on purpose, but not from the readiness probes', async () => {
    expect((await run(new common.ServiceUnavailableException('down'))).reported).toHaveLength(1);
    expect((await run(new common.ServiceUnavailableException('down'), '/api/v1/readyz')).reported).toHaveLength(0);
    expect((await run(new common.ServiceUnavailableException('down'), '/api/v1/readyz/worker')).reported).toHaveLength(0);
  });

  it('does not report what was the caller\'s mistake', async () => {
    expect((await run(new common.NotFoundException('nope'))).reported).toHaveLength(0);
    expect((await run(new common.BadRequestException('bad'))).reported).toHaveLength(0);
    expect((await run(Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }))).reported).toHaveLength(0);
  });
});
