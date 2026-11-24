import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { S3_REQUEST_TIMEOUT_MS, S3StorageAdapter, SandboxStorageAdapter } from '@bault/adapters';

const CONFIG = {
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'eu-central',
  bucket: process.env.STORAGE_BUCKET ?? 'bault-images',
  accessKey: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
};

let storeIsUp = false;

beforeAll(async () => {
  try {
    const probe = await fetch(`${CONFIG.endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    });
    storeIsUp = probe.ok;
  } catch {
    storeIsUp = false;
  }
  if (!storeIsUp) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n  [storage-adapter] SKIPPED the S3 round trip — no object store at ${CONFIG.endpoint}.` +
        `\n  Start one with: docker compose -f infra/docker-compose.yml up -d minio\n`,
    );
  }
});

describe('the storage contract', () => {
  it('round-trips the exact bytes it was given', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);

    const body = Buffer.from(
      Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) % 256),
    );
    const key = `intake/test/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;

    await s3.putObject({ key, body, contentType: 'image/png' });

    const url = await s3.getSignedUrl(key, 120);
    const res = await fetch(url);
    expect(res.status).toBe(200);

    const returned = Buffer.from(await res.arrayBuffer());
    expect(returned.length).toBe(body.length);
    expect(returned.equals(body)).toBe(true);
  });

  it('signs a URL that is readable without credentials and names its expiry', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);
    const key = `intake/test/${Date.now()}-signed.png`;
    await s3.putObject({ key, body: Buffer.from('x'), contentType: 'image/png' });

    const url = await s3.getSignedUrl(key, 300);
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).toContain('X-Amz-Signature=');

    const sentinel = 'sk-this-must-never-be-in-a-url';
    const signed = await new S3StorageAdapter({
      ...CONFIG,
      accessKey: 'ak-public',
      secretKey: sentinel,
    }).getSignedUrl(key, 300);
    expect(signed).toContain('ak-public');
    expect(signed).not.toContain(sentinel);
  });

  it('refuses an unsigned request for the same object', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);
    const key = `intake/test/${Date.now()}-private.png`;
    await s3.putObject({ key, body: Buffer.from('private'), contentType: 'image/png' });

    const res = await fetch(`${CONFIG.endpoint}/${CONFIG.bucket}/${key}`);
    expect(res.ok).toBe(false);
  });

  it('reports a failed upload instead of returning a key for bytes it did not store', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter({ ...CONFIG, bucket: 'bucket-that-does-not-exist' });
    await expect(
      s3.putObject({ key: 'a/b.png', body: Buffer.from('x'), contentType: 'image/png' }),
    ).rejects.toThrow(/Storage upload failed/);
  });

  it('refuses a key with a dot segment instead of signing a path out of the bucket', async () => {
    const s3 = new S3StorageAdapter({ ...CONFIG, endpoint: 'http://127.0.0.1:9' });
    for (const key of ['intake/../other-bucket/x.png', './x.png', 'a/./b.png', '..', 'a/..']) {
      await expect(s3.getSignedUrl(key), key).rejects.toThrow(/segment/);
      await expect(
        s3.putObject({ key, body: Buffer.from('x'), contentType: 'image/png' }),
        key,
      ).rejects.toThrow(/segment/);
    }
    await expect(s3.getSignedUrl('intake/2026/09/receipt.v2.png')).resolves.toContain('receipt.v2.png');
  });

  it('rejects a half-configured adapter at construction, not at first upload', () => {
    expect(() => new S3StorageAdapter({ ...CONFIG, accessKey: '', secretKey: '' })).toThrow(
      /access key/i,
    );
    expect(() => new S3StorageAdapter({ ...CONFIG, bucket: '' })).toThrow(/bucket/i);
  });
});

describe('reading an object back for the worker', () => {
  it('reads the exact bytes it stored', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);
    const body = Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 13 + 5) % 256));
    const key = `parcels/test/${Date.now()}-read.png`;
    await s3.putObject({ key, body, contentType: 'image/png' });
    expect((await s3.getObject(key)).equals(body)).toBe(true);
  });

  it('reports a missing object instead of returning nothing', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);
    await expect(s3.getObject(`parcels/test/${Date.now()}-never-stored.png`)).rejects.toThrow(/Storage read failed/);
  });

  it('refuses a key with a dot segment', async () => {
    const s3 = new S3StorageAdapter({ ...CONFIG, endpoint: 'http://127.0.0.1:9' });
    await expect(s3.getObject('intake/../other-bucket/x.png')).rejects.toThrow(/segment/);
    await expect(new SandboxStorageAdapter().getObject('intake/../x.png')).rejects.toThrow(/segment/);
  });
});

describe('the sandbox adapter', () => {
  it('keeps what it was given in this process only, and a placeholder for anything else', async () => {
    const sandbox = new SandboxStorageAdapter();
    const body = Buffer.from('a label photographed at the bench');
    await sandbox.putObject({ key: 'parcels/2026/09/label.png', body, contentType: 'image/png' });
    expect((await sandbox.getObject('parcels/2026/09/label.png')).equals(body)).toBe(true);
    expect((await new SandboxStorageAdapter().getObject('parcels/2026/09/label.png')).equals(body)).toBe(false);
    expect((await sandbox.getObject('parcels/2026/09/elsewhere.png')).length).toBeGreaterThan(0);
  });

  it('accepts bytes and signs no URL for them', async () => {
    const sandbox = new SandboxStorageAdapter();
    const result = await sandbox.putObject({
      key: 'intake/2026/09/whatever.png',
      body: Buffer.from('a photograph of somebody else’s property'),
      contentType: 'image/png',
    });

    expect(result.key).toBe('intake/2026/09/whatever.png');

    const url = await sandbox.getSignedUrl('intake/2026/09/whatever.png');
    expect(url).not.toContain('X-Amz-Signature');
  });
});

describe('an object store that stops answering', () => {
  it('is given up on after the request time limit, on a read and on an upload', async () => {
    expect(S3_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(S3_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    const held: Socket[] = [];
    const silent = createServer((socket) => {
      held.push(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as AddressInfo;
    try {
      const s3 = new S3StorageAdapter({ ...CONFIG, endpoint: `http://127.0.0.1:${port}`, timeoutMs: 300 });
      const started = Date.now();
      await expect(s3.getObject('items/silent.png')).rejects.toThrow();
      await expect(
        s3.putObject({ key: 'items/silent.png', body: Buffer.from('x'), contentType: 'image/png' }),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      for (const socket of held) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
