import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createDb, type Database } from '../../apps/api/src/db/client';

/**
 * What a failed query leaves in the log and in the error report.
 *
 * drizzle-orm 0.45 wraps a failed query in a `DrizzleQueryError` whose message
 * is the SQL AND ITS PARAMETERS. The parameters are whatever the query was
 * about: an email, a name, an address, a token hash. The exception filter wrote
 * that message to the log and handed the error to Sentry, a third party that
 * keeps it. So the filter logs and reports the query error's code and the SQL
 * without its values, and the scrubber every report passes through removes the
 * parameters from an exception message or a breadcrumb of that shape too.
 *
 * The failures are real: queries forced to fail against the test database,
 * each carrying a recognisable value, handed to the filter with a reporter
 * that records what it is given.
 *
 * Requires a migrated database (the API need not be running).
 */

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { sql } = apiRequire('drizzle-orm') as typeof import('drizzle-orm');
const { scrubErrorEvent } = apiRequire('@bault/adapters') as typeof import('@bault/adapters');

const SECRET = 'leak-canary-7f3a@fixture.bault.test';

let db: Database;
let close: () => Promise<void>;
let filters: typeof import('../../apps/api/src/shared/errors/all-exceptions.filter');

beforeAll(async () => {
  const made = createDb();
  db = made.db;
  close = () => made.pool.end();
  filters = await import('../../apps/api/src/shared/errors/all-exceptions.filter');
});

afterAll(async () => {
  await close();
});

/** What `run` throws, which must be a query failure. */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the query to fail');
}

/** Everything the filter wrote and reported for `exception`. */
async function filtered(exception: unknown) {
  const reported: unknown[] = [];
  const filter = new filters.AllExceptionsFilter((error) => reported.push(error));
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  });
  const req = { method: 'POST', url: '/api/v1/me/profile', originalUrl: '/api/v1/me/profile', headers: {}, body: {} };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) };
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    filter.catch(exception, host as never);
    // The Nest logger writes on the next tick.
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return { status: res.statusCode, body: res.body, log: lines.join(''), reported };
}

/** Every string an error carries, its causes included. */
function everything(error: unknown, depth = 0): string {
  if (depth > 5 || error === null || error === undefined) return '';
  if (typeof error !== 'object') return String(error);
  const e = error as { message?: unknown; stack?: unknown; cause?: unknown };
  let json = '';
  try {
    json = JSON.stringify(error);
  } catch {
    /* circular */
  }
  return [String(e.message ?? ''), String(e.stack ?? ''), json, everything(e.cause, depth + 1)].join('\n');
}

describe('a failed query, in the log and the error report', () => {
  it('logs and reports a server-side query failure by its code, without the values', async () => {
    // division_by_zero, with the canary as a bound parameter.
    const boom = await failure(() => db.execute(sql`select 1 / (length(${SECRET}) - length(${SECRET}))`));
    expect(everything(boom)).toContain(SECRET);

    const out = await filtered(boom);
    expect(out.status).toBe(500);
    expect(out.log).not.toContain(SECRET);
    expect(out.log).toContain('22012');
    expect(out.reported).toHaveLength(1);
    expect(everything(out.reported[0])).not.toContain(SECRET);
    expect(everything(out.reported[0])).toContain('22012');
  });

  it('logs a malformed identifier by its code, without the identifier', async () => {
    // invalid_text_representation: the canary compared against a uuid column.
    const bad = await failure(() => db.execute(sql`select 1 where gen_random_uuid() = ${SECRET}::uuid`));
    const out = await filtered(bad);
    expect(out.status).toBe(400);
    expect(out.log).not.toContain(SECRET);
    expect(out.log).toContain('22P02');
    expect(out.reported).toHaveLength(0);
  });

  it('scrubs the values out of an exception message and a breadcrumb of that shape', async () => {
    const boom = await failure(() => db.execute(sql`select 1 / (length(${SECRET}) - length(${SECRET}))`));
    const event = {
      message: boom.message,
      exception: { values: [{ type: 'DrizzleQueryError', value: boom.message }] },
      breadcrumbs: [{ category: 'console', level: 'error', message: String(boom.stack) }],
    };
    const scrubbed = scrubErrorEvent(event);
    expect(JSON.stringify(scrubbed)).not.toContain(SECRET);
    // What is left still says what failed.
    expect(scrubbed.exception!.values![0]!.value).toContain('Failed query: select 1 / (length($1) - length($2))');
    expect(scrubbed.breadcrumbs![0]!.message).toContain('Failed query');
  });
});
