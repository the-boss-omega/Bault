import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * The API's pool must connect through PgBouncer in transaction mode.
 *
 * PgBouncer closes a client that sends a startup parameter it does not know
 * ("unsupported startup parameter: statement_timeout"), and `pg` turns pool
 * options such as `statement_timeout` into exactly such parameters. Every query
 * the API made through the pooler then failed, while CI, which connects to
 * Postgres directly, passed.
 *
 * A stand-in server records the startup message the API's pool sends, the same
 * bytes PgBouncer would judge, and answers with an error. Needs nothing running.
 */

/** What PgBouncer 1.22 accepts without `ignore_startup_parameters`. */
const POOLER_ACCEPTS = new Set([
  'user',
  'database',
  'application_name',
  'client_encoding',
  'DateStyle',
  'TimeZone',
  'standard_conforming_strings',
]);

const SSL_REQUEST = 80877103;

/** An ErrorResponse, so the client gives up at once instead of waiting. */
function errorResponse(message: string): Buffer {
  const body = Buffer.concat([
    Buffer.from('SFATAL\0', 'utf8'),
    Buffer.from('C08P01\0', 'utf8'),
    Buffer.from(`M${message}\0`, 'utf8'),
    Buffer.from('\0', 'utf8'),
  ]);
  const head = Buffer.alloc(5);
  head.write('E', 0, 'utf8');
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

const received: Array<Record<string, string>> = [];
let server: Server;
let url: string;

function onConnection(socket: Socket): void {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8 && buf.length >= buf.readInt32BE(0)) {
      const len = buf.readInt32BE(0);
      const code = buf.readInt32BE(4);
      const message = buf.subarray(8, len);
      buf = buf.subarray(len);
      if (code === SSL_REQUEST) {
        socket.write('N');
        continue;
      }
      const parts = message.toString('utf8').split('\0');
      const params: Record<string, string> = {};
      for (let i = 0; i + 1 < parts.length && parts[i]; i += 2) params[parts[i]!] = parts[i + 1]!;
      received.push(params);
      socket.end(errorResponse('startup recorded by the test'));
      return;
    }
  });
  socket.on('error', () => undefined);
}

beforeAll(async () => {
  server = createServer(onConnection);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  url = `postgres://bault:bault@127.0.0.1:${port}/bault`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the API's database pool", () => {
  it('sends only startup parameters a transaction-mode PgBouncer accepts', async () => {
    vi.resetModules();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      DIRECT_DATABASE_URL: url,
      PAYMENT_PROVIDER: 'sandbox',
      STORAGE_PROVIDER: 'sandbox',
      STORAGE_ENDPOINT: 'http://localhost:9000',
      STORAGE_REGION: 'eu-central',
      STORAGE_BUCKET: 'bault-images',
      STORAGE_ACCESS_KEY: 'k',
      STORAGE_SECRET_KEY: 's',
    });
    const { createDb } = await import('../../apps/api/src/db/client');
    const { pool } = createDb();
    try {
      await expect(pool.query('select 1')).rejects.toThrow(/startup recorded by the test/);
    } finally {
      await pool.end();
    }

    expect(received).toHaveLength(1);
    const startup = received[0]!;
    expect(startup.user).toBe('bault');
    expect(Object.keys(startup).filter((key) => !POOLER_ACCEPTS.has(key))).toEqual([]);
  });
});
