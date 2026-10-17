import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { SmtpEmailAdapter, createEmailAdapter } from '@bault/adapters';

/**
 * SMTP must not fall back to plaintext.
 *
 * On 587 the connection starts in clear and upgrades with STARTTLS only if the
 * server offers it. Without `requireTLS`, a server that does not offer it, or
 * somebody on the path who strips the offer, gets the SMTP password and every
 * verification and reset link in clear. TLS is required everywhere except in
 * development, which may turn it off for a local mail catcher.
 *
 * A stand-in server that never offers STARTTLS records what it is sent.
 */

type Options = { secure?: boolean; requireTLS?: boolean; tls?: { rejectUnauthorized?: boolean } };

/** What the adapter handed to nodemailer. */
function transportOptions(adapter: unknown): Options {
  expect(adapter).toBeInstanceOf(SmtpEmailAdapter);
  return (adapter as { transport: { options: Options } }).transport.options;
}

const lines: string[] = [];
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((socket) => {
    socket.write('220 catcher.test ESMTP\r\n');
    let buf = '';
    let inData = false;
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          }
          continue;
        }
        const verb = line.split(' ')[0]!.toUpperCase();
        if (verb === 'EHLO') socket.write('250-catcher.test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (verb === 'AUTH') socket.write('235 accepted\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') socket.end('221 bye\r\n');
        else if (verb === 'MAIL' || verb === 'RCPT') socket.write('250 ok\r\n');
        // STARTTLS included: this server, like one whose offer was stripped, has none.
        else socket.write('502 command not implemented\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const smtp = (overrides: Record<string, unknown> = {}) =>
  createEmailAdapter({
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: '127.0.0.1',
    // The stand-in, in place of 587: the same plaintext start and upgrade.
    SMTP_PORT: port,
    SMTP_SECURE: false,
    SMTP_REQUIRE_TLS: true,
    SMTP_USER: 'bault@example.test',
    SMTP_PASSWORD: 'app-password',
    SMTP_FROM: 'Bault <bault@example.test>',
    ...overrides,
  } as Parameters<typeof createEmailAdapter>[0]);

const message = {
  to: 'collector@example.test',
  subject: 'Reset your password',
  template: 'password_reset',
  variables: { link: 'https://app.example.test/#/reset-password?token=secret' },
};

describe('SMTP transport options', () => {
  it('require STARTTLS on 587 outside development', () => {
    for (const NODE_ENV of ['production', 'test']) {
      const options = transportOptions(smtp({ NODE_ENV }));
      expect(options.secure, NODE_ENV).toBe(false);
      expect(options.requireTLS, NODE_ENV).toBe(true);
    }
  });

  it('use implicit TLS on 465', () => {
    expect(transportOptions(smtp({ SMTP_PORT: 465, SMTP_SECURE: true })).secure).toBe(true);
  });

  it('ignore SMTP_REQUIRE_TLS=false outside development', () => {
    expect(transportOptions(smtp({ SMTP_REQUIRE_TLS: false })).requireTLS).toBe(true);
  });

  it('require TLS in development too, unless turned off for a local catcher', () => {
    expect(transportOptions(smtp({ NODE_ENV: 'development' })).requireTLS).toBe(true);
    const catcher = transportOptions(smtp({ NODE_ENV: 'development', SMTP_REQUIRE_TLS: false }));
    expect(catcher.requireTLS).toBe(false);
  });

  it('never skip certificate verification', () => {
    for (const NODE_ENV of ['production', 'development']) {
      expect(transportOptions(smtp({ NODE_ENV })).tls?.rejectUnauthorized).not.toBe(false);
    }
  });
});

describe('a server that does not offer STARTTLS', () => {
  it('gets neither the credentials nor the message outside development', async () => {
    lines.length = 0;
    await expect(smtp().send(message)).rejects.toThrow();
    // It was reached: the refusal is about TLS, not a connection that failed.
    expect(lines.some((l) => /^EHLO/i.test(l))).toBe(true);
    expect(lines.some((l) => /^AUTH/i.test(l))).toBe(false);
    expect(lines.some((l) => /^(MAIL|DATA)/i.test(l))).toBe(false);
  });

  it('is a local catcher in development with SMTP_REQUIRE_TLS=false', async () => {
    lines.length = 0;
    const sent = await smtp({ NODE_ENV: 'development', SMTP_REQUIRE_TLS: false }).send(message);
    expect(sent.providerRef).toBeTruthy();
    expect(lines.some((l) => l.startsWith('DATA'))).toBe(true);
  });
});
